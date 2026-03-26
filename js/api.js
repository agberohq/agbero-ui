/**
 * js/api.js
 *
 * Thin wrapper around Oja's Api class.
 * All HTTP goes through one Api instance — token, offline detection,
 * and error normalisation are handled by Oja, not by hand.
 *
 * The module also exports pure data helpers (parseCertificates, fmtNum…)
 * that have no dependency on the Api instance.
 */

import { Api } from '../lib/oja.full.esm.js';
import { getHost } from './store.js';

// ── Singleton Api instance ────────────────────────────────────────────────────
// Re-created whenever setHost() changes the target node (see reinitApi below).

let _api = null;

function _makeApi() {
    const base = getHost() || window.location.origin;
    return new Api({ base, timeout: 15000 });
}

function getApi() {
    if (!_api) _api = _makeApi();
    return _api;
}

/**
 * Call after setHost() to point all future requests at the new node.
 * The caller is responsible for re-authenticating if needed.
 */
export function reinitApi() {
    _api = _makeApi();
}

/**
 * Set the bearer token on the shared Api instance.
 * Called from store.js setCredentials().
 */
export function apiSetToken(token) {
    getApi().setToken(token);
}

/**
 * Clear auth from the shared Api instance.
 * Called from store.js clearCredentials().
 */
export function apiClearToken() {
    getApi().clearAuth();
}

// ── HTTP helpers — thin typed wrappers ────────────────────────────────────────

export async function fetchUptime()            {
    console.log('[agbero/api] GET /uptime');
    const r = await getApi().get('/uptime');
    console.log('[agbero/api] /uptime response:', r ? 'ok' : 'null');
    return r;
}
export async function fetchConfig()            {
    console.log('[agbero/api] GET /config');
    const r = await getApi().get('/config');
    console.log('[agbero/api] /config response:', r ? 'ok' : 'null');
    return r;
}
export async function fetchFirewall()          { return getApi().get('/firewall'); }

export async function fetchTelemetry(host, range) {
    return getApi().get(`/telemetry/history?host=${encodeURIComponent(host)}&range=${range}`);
}

export async function fetchLogs(lines) {
    return getApi().get(`/logs?lines=${lines}`);
}

export async function addFirewallRule(body) {
    return getApi().post('/firewall', body);
}

export async function deleteFirewallRule(ip) {
    return getApi().delete(`/firewall?ip=${encodeURIComponent(ip)}`);
}

export async function broadcastClusterRoute(body) {
    return getApi().post('/cluster/route', body);
}

export async function checkHostExists(domain) {
    // Returns true if domain already exists, false if 404, throws on other errors.
    const base = getHost() || window.location.origin;
    const token = getApi()._token;
    const headers = { 'Accept': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(`${base}/api/hosts/${encodeURIComponent(domain)}`, { headers });
    if (res.status === 404) return false;
    if (res.ok) return true;
    return false;
}

export async function addHost(domain, config) {
    return getApi().post('/api/hosts', { domain, config });
}

export async function addHostHCL(hclText) {
    // Send raw HCL — backend detects non-JSON content-type and parses as HCL.
    return getApi().post('/api/hosts', hclText, {
        raw: true,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
}

export async function getHostHCL(domain) {
    // Returns raw HCL string for a domain.
    const base = getHost() || window.location.origin;
    const token = getApi()._token;
    const headers = { 'Accept': 'application/hcl' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(`${base}/api/hosts/${encodeURIComponent(domain)}?format=hcl`, { headers });
    if (!res.ok) return null;
    return res.text();
}

export async function setupTOTP() {
    return getApi().post('/api/totp/setup', {});
}

export async function getTOTPQRUrl(username) {
    const base = getHost() || window.location.origin;
    return `${base}/api/totp/${encodeURIComponent(username)}/qr.svg`;
}

export async function keeperUnlock(passphrase) {
    return getApi().post('/api/keeper/unlock', { passphrase });
}

export async function keeperLock() {
    return getApi().post('/api/keeper/lock', {});
}

export async function keeperList() {
    return getApi().get('/api/keeper/secrets');
}

export async function keeperSet(key, value) {
    return getApi().post('/api/keeper/secrets', { key, value });
}

export async function keeperDelete(key) {
    // chi path param — use fetch directly
    const base = getHost() || window.location.origin;
    const token = getApi()._token;
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(`${base}/api/keeper/secrets/${encodeURIComponent(key)}`, {
        method: 'DELETE', headers,
    });
    if (!res.ok) return null;
    return res.json();
}

export async function generateSecret(action, opts = {}) {
    return getApi().post('/api/secrets', { action, ...opts });
}

export async function deleteHost(domain) {
    return getApi().delete(`/api/hosts?domain=${encodeURIComponent(domain)}`);
}

/**
 * Login is handled separately — it does not use the authenticated Api instance
 * because credentials are not yet set at call time.
 */
export async function fetchStatus() {
    // Unauthenticated — returns { status, auth, totp } booleans as strings.
    const base = getHost() || window.location.origin;
    try {
        const res = await fetch(base + '/status');
        if (!res.ok) return null;
        const data = await res.json();
        // Convert string booleans from the Go handler
        return {
            auth: data.auth === 'true',
            totp: data.totp === 'true',
        };
    } catch { return null; }
}

export async function login(username, password, totp = '') {
    const base = getHost() || window.location.origin;
    const body = { username, password };
    if (totp) body.totp = totp;
    try {
        const res = await fetch(base + '/login', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
            // Surface the error message from the server for the UI
            const text = await res.text().catch(() => '');
            const err = new Error(text.trim() || 'Login failed');
            err.status = res.status;
            throw err;
        }
        const data = await res.json();
        if (!data.type && data.token) data.type = 'jwt';
        return data;
    } catch (err) {
        if (!err.status) console.error('[agbero/api] login: fetch error:', err);
        throw err;
    }
}

// ── Pure data helpers ─────────────────────────────────────────────────────────

export function parseCertificates(hosts) {
    const certs = [];
    for (const [host, cfg] of Object.entries(hosts || {})) {
        if (cfg.tls?.expiry) {
            const exp      = new Date(cfg.tls.expiry);
            const daysLeft = Math.floor((exp - Date.now()) / 86400000);
            certs.push({ host, expiry: cfg.tls.expiry, daysLeft, issuer: cfg.tls.issuer || "Let's Encrypt" });
        }
    }
    return certs;
}

export function parseJWTExpiry(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp ? payload.exp * 1000 : null;
    } catch { return null; }
}

export function fmtNum(n) {
    if (n === undefined || n === null) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

export function formatBytes(b) {
    if (!b) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}