/**
 * js/login.js — 2-token login state machine
 *
 * Flow per backend admin.go:
 *   Step 1: POST /login {username, password}
 *     → 200: full token immediately (no challenges)
 *     → 202: pre-auth token + requirements[] (challenge_required)
 *   Step 2: POST /login/challenge  Authorization: Bearer <pre-auth-token>
 *     body: { keeper_passphrase?, totp? }
 *     → 200: full token
 *
 * requirements can contain: "keeper_unlock", "totp"
 * Both may be required — the UI collects them on one challenge screen.
 */
import { listen, on, emit, modal, query } from '../lib/oja.full.esm.js';
import { store, setCredentials, clearCredentials, isLoggedIn, setHost, getHost } from './store.js';
import { login, loginChallenge, fetchStatus } from './api.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _preAuthToken  = null;   // stored in memory only, never localStorage
let _requirements  = [];     // ["keeper_unlock", "totp"]
let _pendingUser   = '';     // username from step 1

// ── Reset to step 1 ───────────────────────────────────────────────────────────
export function _loginReset() {
    _preAuthToken = null;
    _requirements = [];
    _pendingUser  = '';

    _show('#loginForm');
    _hide('#loginChallengeForm');

    const errEl = query('#loginError');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    const totpIn = query('#totp');
    if (totpIn) totpIn.value = '';
    const passIn = query('#keeperPassphraseInput');
    if (passIn) passIn.value = '';
}

function _show(sel) { const el = query(sel); if (el) el.style.display = ''; }
function _hide(sel) { const el = query(sel); if (el) el.style.display = 'none'; }
function _err(msg)  {
    const el = query('#loginError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function _clearErr() {
    const el = query('#loginError');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// Show the challenge step with only the fields needed
function _showChallenge(requirements) {
    _hide('#loginForm');

    // Show keeper field only if required
    const keeperRow = query('#challengeKeeperRow');
    if (keeperRow) keeperRow.style.display = requirements.includes('keeper_unlock') ? '' : 'none';

    // Show TOTP field only if required
    const totpRow = query('#challengeTOTPRow');
    if (totpRow) totpRow.style.display = requirements.includes('totp') ? '' : 'none';

    _show('#loginChallengeForm');

    // Focus first required field
    if (requirements.includes('keeper_unlock')) {
        requestAnimationFrame(() => query('#keeperPassphraseInput')?.focus());
    } else if (requirements.includes('totp')) {
        requestAnimationFrame(() => query('#totp')?.focus());
    }
}

export function updateNodeDisplay() {
    const h = getHost();
    query('#targetHostBtn')?.setAttribute('data-host', h || 'local');
    const nd = query('#loginNodeDisplay');
    if (nd) nd.textContent = h || 'local';
    const ni = query('#loginTargetHost');
    if (ni) ni.value = h || '';
}

export async function checkServerStatus() {
    const circle = query('#loginServerDotCircle');
    const label  = query('#loginServerDotLabel');
    if (!circle) return;
    try {
        const status = await fetchStatus();
        if (status) {
            circle.style.background = 'var(--success)';
            if (label) label.textContent = 'reachable';
        } else {
            circle.style.background = 'var(--danger)';
            if (label) label.textContent = 'unreachable';
        }
    } catch {
        circle.style.background = 'var(--danger)';
        if (label) label.textContent = 'unreachable';
    }
}

export function initLogin() {
    // ── Node edit ─────────────────────────────────────────────────────────────
    on('#loginEditNodeBtn', 'click', () => {
        const el = query('#loginNodeEdit');
        if (el) el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
        checkServerStatus();
    });
    on('#loginResetHostBtn', 'click', () => {
        setHost(''); updateNodeDisplay();
        const edit = query('#loginNodeEdit');
        if (edit) edit.style.display = 'none';
        checkServerStatus();
    });
    on('#loginSaveHostBtn', 'click', () => {
        const val = query('#loginTargetHost')?.value?.trim() || '';
        setHost(val); updateNodeDisplay();
        const edit = query('#loginNodeEdit');
        if (edit) edit.style.display = 'none';
        checkServerStatus();
    });

    // ── TOTP auto-submit when 6 digits entered ────────────────────────────────
    on('#totp', 'input', (e, el) => {
        el.value = el.value.replace(/\D/g, '').slice(0, 6);
        if (el.value.length === 6 && _preAuthToken) {
            query('#loginChallengeForm')?.requestSubmit();
        }
    });

    // ── Step 1: username + password ───────────────────────────────────────────
    on('#loginForm', 'submit', async (e) => {
        e.preventDefault();
        _clearErr();

        const username = query('#username')?.value?.trim() || '';
        const password = query('#password')?.value || '';
        if (!username || !password) { _err('Username and password are required'); return; }

        const btn = query('#loginForm [type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

        try {
            const result = await login(username, password);

            if (result.challenge) {
                // 202 — need to solve challenges
                _preAuthToken = result.token;
                _requirements = result.requirements;
                _pendingUser  = username;
                if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
                _showChallenge(_requirements);
            } else {
                // 200 — full token, done
                if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
                _onSuccess(result.token, result.expires);
            }
        } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
            _err(err.message || 'Login failed');
        }
    });

    // ── Step 2: challenge (keeper passphrase + TOTP) ──────────────────────────
    on('#loginChallengeForm', 'submit', async (e) => {
        e.preventDefault();
        _clearErr();
        if (!_preAuthToken) { _loginReset(); return; }

        const keeperPass = query('#keeperPassphraseInput')?.value || '';
        const totpCode   = query('#totp')?.value?.trim() || '';

        // Validate required fields
        if (_requirements.includes('keeper_unlock') && !keeperPass) {
            _err('Keeper passphrase is required'); return;
        }
        if (_requirements.includes('totp') && totpCode.length !== 6) {
            _err('Enter the 6-digit authenticator code'); return;
        }

        const btn = query('#loginChallengeForm [type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

        try {
            const result = await loginChallenge(_preAuthToken, {
                keeper_passphrase: keeperPass,
                totp:              totpCode,
            });
            _preAuthToken = null; // wipe from memory
            if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
            _onSuccess(result.token, result.expires);
        } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
            _err(err.message || 'Verification failed');
        }
    });

    // Back button on challenge step
    on('#loginChallengeBack', 'click', () => {
        _preAuthToken = null;
        _requirements = [];
        _loginReset();
        requestAnimationFrame(() => query('#username')?.focus());
    });

    // Close → reset
    listen('modal:close', ({ id }) => {
        if (id === 'loginModal') _loginReset();
    });
}

function _onSuccess(token, expires) {
    setCredentials('jwt', token);
    store.set('auth.isLoggedIn', true);
    emit('auth:login:success', { token });
    modal.closeAll();
    _loginReset();
}
