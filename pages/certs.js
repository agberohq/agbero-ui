/**
 * pages/certs.js — Certificates page.
 */
import { listen, emit, notify, ui, countdown } from '../lib/oja.full.esm.js';

export default async function({ find, on, onUnmount, ready, inject }) {
    const { store, api } = inject('app');
    const _certCountdowns = new Map();

    function _destroyCertCountdowns() { for (const h of _certCountdowns.values()) h.destroy(); _certCountdowns.clear(); }

    function emptyRow(html) { return `<tr><td colspan="4" style="padding:24px;"><div class="empty-state">${html}</div></td></tr>`; }

    function certRow(c) {
        const daysLeft = c.days_left;
        const expired  = c.is_expired || (daysLeft !== null && daysLeft < 0);
        const expiry   = c.expires_at ? new Date(c.expires_at).toLocaleDateString([], { year:'numeric', month:'short', day:'numeric' }) : '—';
        const color    = countdown.daysColor(daysLeft);
        const useLive  = !expired && daysLeft !== null && daysLeft < 30 && c.expires_at;
        const cdId     = `cert-cd-${c.domain}`;
        const label    = expired
            ? '<span style="color:var(--danger);font-family:var(--font-mono);font-size:12px;">Expired</span>'
            : useLive
                ? `<span id="${cdId}" style="color:${color};font-family:var(--font-mono);font-size:12px;"></span>`
                : `<span style="color:${color};font-family:var(--font-mono);font-size:12px;">${countdown.daysLabel(daysLeft)}</span>`;
        return `<tr>
            <td class="mono" style="font-size:12px;">${c.domain}</td>
            <td class="hide-mobile mono" style="font-size:11px;color:var(--text-mute);">${c.file}</td>
            <td>${label}<span style="font-size:11px;color:var(--text-mute);margin-left:6px;">${expiry}</span></td>
            <td><button class="btn small certs-delete-btn" data-domain="${c.domain}" style="color:var(--danger);border-color:rgba(255,59,48,0.4);">Delete</button></td>
        </tr>`;
    }

    function _attachCertCountdowns(parsed) {
        _destroyCertCountdowns();
        for (const c of parsed) {
            if (!c.is_expired && c.days_left !== null && c.days_left < 30 && c.expires_at) {
                const el = document.getElementById(`cert-cd-${c.domain}`);
                if (!el) continue;
                const handle = countdown.attach(el, new Date(c.expires_at).getTime(), {
                    format(ms) {
                        if (ms <= 0) return 'Expiring…';
                        const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1_000);
                        if (d > 0) return `${d}d ${h}h ${m}m`;
                        if (h > 0) return `${h}h ${m}m ${s}s`;
                        return `${m}m ${s}s`;
                    },
                });
                _certCountdowns.set(c.domain, handle);
            }
        }
    }

    function render(parsed) {
        const tbody   = find('#certsTable');
        const countEl = find('#certsCount');
        if (!tbody) return;
        _destroyCertCountdowns();
        if (!parsed) { tbody.innerHTML = emptyRow('⚠️ Could not load certificates'); if (countEl) countEl.textContent = '—'; return; }
        if (countEl) countEl.textContent = String(parsed.length);
        if (!parsed.length) { tbody.innerHTML = emptyRow('<span>📜 No custom certificates</span><span>Agbero manages Let\'s Encrypt certificates automatically.</span>'); return; }
        tbody.innerHTML = parsed.map(certRow).join('');
        requestAnimationFrame(() => _attachCertCountdowns(parsed));
    }

    async function refresh() {
        const btn  = find('#certsRefreshBtn');
        if (btn) ui.btn.loading(btn, '…');
        const data = await api.fetchCerts();
        if (btn) ui.btn.reset(btn);
        const parsed = data ? api.parseCertificates(data) : null;
        if (parsed) store.set('certificates', parsed);
        render(parsed);
    }

    function _populateDomainList() {
        const dl = find('#certDomainList');
        if (!dl) return;
        const domains = Object.keys((store.get('lastConfig') || {}).hosts || {});
        dl.innerHTML = domains.map(d => `<option value="${d}">`).join('');
    }

    on('#certsUploadBtn', 'click', () => { _populateDomainList(); find('#certsUploadForm').style.display = ''; find('#certDomain')?.focus(); });
    on('#certsUploadCancelBtn', 'click', () => {
        find('#certsUploadForm').style.display  = 'none';
        find('#certDomain').value = ''; find('#certPem').value = ''; find('#certKey').value = '';
        find('#certsUploadError').style.display = 'none';
    });

    on('#certsUploadSaveBtn', 'click', async (e, btn) => {
        const domain = (find('#certDomain').value  || '').trim();
        const cert   = (find('#certPem').value     || '').trim();
        const key    = (find('#certKey').value     || '').trim();
        const errEl  = find('#certsUploadError');
        errEl.style.display = 'none';
        if (!domain) { errEl.textContent = 'Domain is required';       errEl.style.display = 'block'; return; }
        if (!cert)   { errEl.textContent = 'Certificate PEM required'; errEl.style.display = 'block'; return; }
        if (!key)    { errEl.textContent = 'Private key PEM required'; errEl.style.display = 'block'; return; }
        ui.btn.loading(btn, 'Uploading…');
        const res = await api.uploadCert(domain, cert, key);
        ui.btn.reset(btn);
        if (res?.status === 'ok') {
            notify.show(`Certificate for ${domain} applied`, 'success');
            find('#certsUploadForm').style.display = 'none';
            find('#certDomain').value = ''; find('#certPem').value = ''; find('#certKey').value = '';
            refresh();
        } else { errEl.textContent = res?.error || res?.message || 'Upload failed'; errEl.style.display = 'block'; }
    });

    on('.certs-delete-btn', 'click', (e, btn) => {
        const domain = btn?.dataset.domain;
        if (!domain) return;
        emit('app:strict-delete', {
            message:    `Delete the certificate for <strong>${domain}</strong>?`,
            targetText: domain,
            onConfirm:  async (otpCode) => {
                const res = await api.deleteCert(domain, otpCode);
                if (res?.status === 'ok' || !res?.error) { notify.show(`Certificate for ${domain} deleted`, 'success'); refresh(); }
                else notify.show(res?.error || 'Delete failed', 'error');
            },
        });
    });

    on('#certPemFile', 'change', (e, inp) => {
        const file = inp.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { const ta = find('#certPem'); if (ta) ta.value = ev.target.result; };
        reader.readAsText(file);
    });

    on('#certKeyFile', 'change', (e, inp) => {
        const file = inp.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { const ta = find('#certKey'); if (ta) ta.value = ev.target.result; };
        reader.readAsText(file);
    });

    const unsubRefresh = listen('certs:refresh', refresh);
    refresh();

    onUnmount(() => { unsubRefresh(); _destroyCertCountdowns(); });
    ready();
}
