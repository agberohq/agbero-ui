/**
 * pages/dashboard.js — Dashboard page.
 */
import { emit, listen, chart, countdown } from '../lib/oja.full.esm.js';

export default async function({ find, findAll, on, onUnmount, ready, inject }) {
    const { store, api, utils, oja } = inject('app');
    const { modal } = oja;

    let mainChart = null;
    let unsub     = null;

    function buildTimeGradient(n) {
        return Array.from({ length: n }, (_, i) => {
            const t = i / Math.max(n - 1, 1);
            return `rgba(59,130,246,${(0.18 + t * 0.82).toFixed(2)})`;
        });
    }

    function fmtReqs(n) {
        if (!n) return '0';
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
        return String(n);
    }

    function _openCertDetail(cert) {
        const titleEl = find('#certDetailTitle');
        const bodyEl  = find('#certDetailBody');
        if (!titleEl || !bodyEl) return;
        titleEl.textContent = cert.domain;
        const expiry  = cert.expires_at ? new Date(cert.expires_at).toLocaleString() : '—';
        const color   = countdown.daysColor(cert.days_left);
        const label   = countdown.daysLabel(cert.days_left);
        bodyEl.innerHTML = [
            ['Domain',   cert.domain],
            ['File',     cert.file || '—'],
            ['Expires',  expiry],
            ['Status',   `<span style="color:${color};font-family:var(--font-mono);">${label}</span>`],
            ['Expired',  cert.is_expired ? '<span style="color:var(--danger);">Yes</span>' : 'No'],
        ].map(([k,v]) => `<div class="detail-row"><span class="detail-label">${k}</span><span class="detail-value">${v}</span></div>`).join('');
        modal.open('certDetailModal');
    }

    function renderCerts(certs) {
        const el  = find('#certBriefing');
        const sum = find('#certSummary');
        if (!el) return;
        if (!certs || !certs.length) {
            el.innerHTML = '<div class="brief-empty">No certificates tracked</div>';
            if (sum) sum.textContent = '';
            return;
        }
        const sorted   = [...certs].sort((a, b) => (a.days_left ?? Infinity) - (b.days_left ?? Infinity));
        const expiring = sorted.filter(c => c.days_left !== null && c.days_left < 30).length;
        if (sum) sum.textContent = expiring > 0 ? `${expiring} expiring soon` : `${certs.length} managed`;
        el.innerHTML = sorted.slice(0, 5).map(cert => {
            const color = countdown.daysColor(cert.days_left);
            const label = countdown.daysLabel(cert.days_left);
            return `<div class="brief-row brief-row-clickable" data-cert="${encodeURIComponent(JSON.stringify(cert))}">
                <span class="dot" style="background:${color};flex-shrink:0;"></span>
                <span class="brief-row-main">${cert.domain}</span>
                <span class="brief-row-sub" style="color:${color};font-family:var(--font-mono);">${label}</span>
                <span class="brief-row-arrow">›</span>
            </div>`;
        }).join('');
        el.querySelectorAll('[data-cert]').forEach(row =>
            row.addEventListener('click', () => _openCertDetail(JSON.parse(decodeURIComponent(row.dataset.cert))))
        );
    }

    function renderTopHosts(hosts) {
        const el  = find('#hostBriefing');
        const sub = find('#hostBriefSub');
        if (!el) return;
        const entries = Object.entries(hosts || {})
            .map(([name, h]) => ({ name, reqs: h.total_reqs || 0 }))
            .filter(h => h.reqs > 0)
            .sort((a, b) => b.reqs - a.reqs);
        if (sub) sub.textContent = entries.length ? `${entries.length} hosts` : '';
        if (!entries.length) { el.innerHTML = '<div class="brief-empty">No traffic yet</div>'; return; }
        const maxReqs = entries[0].reqs;
        el.innerHTML = entries.slice(0, 5).map((h, i) => {
            const pct  = maxReqs > 0 ? Math.round((h.reqs / maxReqs) * 100) : 0;
            const rank = i === 0 ? 'var(--accent)' : i === 1 ? 'var(--info)' : 'var(--border)';
            return `<div class="brief-row" data-hostname="${h.name}" style="flex-direction:column;align-items:stretch;gap:4px;cursor:pointer;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="brief-row-main">${h.name}</span>
                    <span class="brief-row-sub" style="font-family:var(--font-mono);">${fmtReqs(h.reqs)}</span>
                </div>
                <div style="height:2px;background:var(--border);border-radius:1px;overflow:hidden;">
                    <div style="width:${pct}%;height:100%;background:${rank};transition:width 0.4s;"></div>
                </div>
            </div>`;
        }).join('');
    }

    function renderErrorHotspots(hosts) {
        const el  = find('#errorBriefing');
        const sub = find('#errorBriefSub');
        if (!el) return;
        const hotspots = [];
        for (const [hostname, h] of Object.entries(hosts || {})) {
            for (const route of (h.routes || [])) {
                for (const b of (route.backends || [])) {
                    if ((b.failures || 0) > 0) hotspots.push({ url: b.url || '?', host: hostname, failures: b.failures, alive: b.alive });
                }
            }
        }
        hotspots.sort((a, b) => b.failures - a.failures);
        const totalErrors = hotspots.reduce((s, h) => s + h.failures, 0);
        if (sub) sub.textContent = totalErrors > 0 ? `${fmtReqs(totalErrors)} total` : '';
        if (!hotspots.length) { el.innerHTML = '<div class="brief-empty" style="color:var(--success);">✓ No errors recorded</div>'; return; }
        el.innerHTML = hotspots.slice(0, 5).map(h => {
            const dot = h.alive ? 'warn' : 'down';
            return `<div class="brief-row">
                <span class="dot ${dot}" style="flex-shrink:0;"></span>
                <span class="brief-row-main">${h.url}</span>
                <span class="brief-row-sub" style="color:var(--danger);font-family:var(--font-mono);">${fmtReqs(h.failures)} fail</span>
            </div>`;
        }).join('');
    }

    function _openGitDetail(id, s) {
        const titleEl = find('#gitDetailTitle');
        const bodyEl  = find('#gitDetailBody');
        if (!titleEl || !bodyEl) return;
        titleEl.textContent = id;
        const status    = s.status || s.state || 'unknown';
        const isHealthy = status === 'healthy' || status === 'ok';
        const isFailed  = status === 'failed'  || status === 'error';
        const dotColor  = isHealthy ? 'var(--success)' : isFailed ? 'var(--danger)' : 'var(--warning)';
        bodyEl.innerHTML = [
            ['ID',          id],
            ['Status',      `<span style="color:${dotColor};font-family:var(--font-mono);">${status}</span>`],
            ['Branch',      s.branch  || '—'],
            ['Commit',      s.commit  ? `<span style="font-family:var(--font-mono);">${s.commit.slice(0,12)}</span>` : '—'],
            ['Deployments', s.deployments ?? '—'],
            ['Last check',  s.last_check ? new Date(s.last_check).toLocaleString() : '—'],
            ['Error',       s.error ? `<span style="color:var(--danger);">${s.error}</span>` : '—'],
        ].map(([k,v]) => `<div class="detail-row"><span class="detail-label">${k}</span><span class="detail-value">${v}</span></div>`).join('');
        modal.open('gitDetailModal');
    }

    function renderGitDeploys(gitStats) {
        const el  = find('#gitBriefing');
        const sub = find('#gitBriefSub');
        if (!el) return;
        const entries = Object.entries(gitStats || {});
        if (!entries.length) { el.innerHTML = '<div class="brief-empty">No git deploys configured</div>'; if (sub) sub.textContent = ''; return; }
        if (sub) sub.textContent = `${entries.length} deploy${entries.length !== 1 ? 's' : ''}`;
        el.innerHTML = entries.map(([id, s]) => {
            const status    = s.status || s.state || 'unknown';
            const isHealthy = status === 'healthy' || status === 'ok';
            const isFailed  = status === 'failed'  || status === 'error';
            const dotCls    = isHealthy ? 'ok' : isFailed ? 'down' : 'warn';
            const meta      = [s.branch ? `@${s.branch}` : '', s.commit ? s.commit.slice(0,7) : ''].filter(Boolean).join(' · ');
            return `<div class="brief-row brief-row-clickable" data-git-id="${id}" data-git="${encodeURIComponent(JSON.stringify(s))}">
                <span class="dot ${dotCls}" style="flex-shrink:0;"></span>
                <div style="flex:1;min-width:0;">
                    <div class="brief-row-main">${id}</div>
                    ${meta ? `<div style="font-size:10px;color:var(--text-mute);font-family:var(--font-mono);">${meta}</div>` : ''}
                </div>
                <span class="brief-row-sub" style="font-family:var(--font-mono);">${status}</span>
                <span class="brief-row-arrow">›</span>
            </div>`;
        }).join('');
        el.querySelectorAll('[data-git-id]').forEach(row =>
            row.addEventListener('click', () => _openGitDetail(row.dataset.gitId, JSON.parse(decodeURIComponent(row.dataset.git))))
        );
    }

    function renderNotifications(hosts, certs) {
        const listEl  = find('#notifList');
        const countEl = find('#notifCount');
        const panel   = find('#notifPanel');
        if (!listEl) return;

        const items = [];

        (certs || []).forEach(c => {
            if (c.days_left === null || c.days_left === undefined) return;
            if (c.is_expired || c.days_left < 0)
                items.push({ sev: 'danger',  icon: '🔒', msg: `Certificate expired`, sub: c.domain });
            else if (c.days_left < 7)
                items.push({ sev: 'warning', icon: '⏰', msg: `Certificate expiring in ${countdown.daysLabel(c.days_left)}`, sub: c.domain });
        });

        let tReqs = 0, tErrs = 0;
        for (const h of Object.values(hosts || {})) {
            tReqs += h.total_reqs || 0;
            (h.routes || []).forEach(r => (r.backends || []).forEach(b => tErrs += b.failures || 0));
        }
        if (tReqs > 50 && tErrs / tReqs > 0.05)
            items.push({ sev: 'danger', icon: '📈', msg: `High error rate: ${((tErrs/tReqs)*100).toFixed(1)}%`, sub: `${tErrs} of ${fmtReqs(tReqs)} requests failed` });

        for (const [hostname, h] of Object.entries(hosts || {})) {
            for (const route of (h.routes || [])) {
                for (const b of (route.backends || [])) {
                    if (b.alive === false)
                        items.push({ sev: 'warning', icon: '⚠️', msg: `Dead backend`, sub: `${b.url || b.address || '?'} on ${hostname}` });
                }
            }
        }

        if (countEl) {
            if (items.length) { countEl.textContent = items.length; countEl.style.display = ''; }
            else countEl.style.display = 'none';
        }

        if (panel) {
            const hasDanger = items.some(i => i.sev === 'danger');
            panel.style.borderColor = hasDanger ? 'rgba(255,59,48,0.3)' : items.length ? 'rgba(245,166,35,0.3)' : '';
        }

        if (!items.length) {
            listEl.innerHTML = '<div class="notif-empty">No alerts — everything looks healthy ✓</div>';
            return;
        }

        items.sort((a, b) => a.sev === 'danger' ? -1 : 1);
        listEl.innerHTML = items.map(item => `
            <div class="notif-item notif-${item.sev}">
                <span class="notif-item-icon">${item.icon}</span>
                <div class="notif-item-body">
                    <span class="notif-item-msg">${item.msg}</span>
                    ${item.sub ? `<span class="notif-item-sub">${item.sub}</span>` : ''}
                </div>
            </div>`).join('');
    }

    function refreshChart(history) {
        const h    = history || store.get('metricsHistory') || { all: [], http: [], tcp: [] };
        const key  = store.get('activeChart') || 'all';
        const vals = [...(h[key] || [])];
        if (vals.length === 0) vals.push(0);
        if (!mainChart) {
            mainChart = chart.bar('#responseGraph', vals, {
                unit: 'ms', warnAt: 500,
                colors: buildTimeGradient(vals.length),
                label: key.toUpperCase(),
            });
        } else {
            mainChart.update(vals, { colors: buildTimeGradient(vals.length), label: key.toUpperCase() });
        }
    }

    function processMetrics(payload) {
        const hosts   = payload.hosts || {};
        const version = store.get('sys.version') || '';
        let hc = 0, rc = 0, tReqs = 0, tErrs = 0;
        for (const h of Object.values(hosts)) {
            hc++; rc += (h.routes || []).length + (h.proxies || []).length;
            tReqs += h.total_reqs || 0;
            (h.routes  || []).forEach(r => (r.backends || []).forEach(b => tErrs += b.failures || 0));
            (h.proxies || []).forEach(p => (p.backends || []).forEach(b => tErrs += b.failures || 0));
        }
        const metaEl = find('#welcomeMeta');
        if (metaEl) metaEl.textContent = [version, payload.system?.uptime || '', `${hc} host${hc !== 1 ? 's' : ''}`, `${rc} route${rc !== 1 ? 's' : ''}`].filter(Boolean).join(' · ');
        const bar = find('#globalHealthBar');
        if (bar) {
            const errPct  = tReqs > 0 ? (tErrs / tReqs) * 100 : 0;
            const succPct = Math.max(0, 100 - errPct);
            bar.innerHTML = `<div class="hb-seg hb-ok" style="width:${succPct}%"></div><div class="hb-seg hb-err" style="width:${errPct}%"></div>`;
            const errText = find('#errorRateText');
            if (errText) errText.textContent = `${tReqs > 0 ? ((tErrs / tReqs) * 100).toFixed(1) : '0.0'}% errors`;
        }
        const timeEl = find('#lastUpdatedText');
        if (timeEl) timeEl.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        renderCerts(store.get('certificates') || []);
        renderTopHosts(hosts);
        renderErrorHotspots(hosts);
        renderGitDeploys(payload.git || store.get('gitStats') || {});
        renderNotifications(hosts, store.get('certificates') || []);
        const hist   = payload.history || store.get('metricsHistory') || {};
        const httpEl = find('#latencyHttpText');
        const tcpEl  = find('#latencyTcpText');
        if (httpEl) httpEl.textContent = hist.http?.length ? `HTTP p99 ${hist.http[hist.http.length-1].toFixed(0)}ms` : '';
        if (tcpEl)  tcpEl.textContent  = hist.tcp?.length  ? `TCP p99 ${hist.tcp[hist.tcp.length-1].toFixed(0)}ms`   : '';
        refreshChart(payload.history);
    }

    // Boot
    const welEl = find('#welcomeName');
    if (welEl) {
        try { const { auth } = inject('app').oja; const user = auth.session.user(); welEl.textContent = (user?.user || user?.sub || 'ADMIN').toUpperCase(); }
        catch { welEl.textContent = 'ADMIN'; }
    }

    renderCerts(store.get('certificates') || []);
    renderNotifications((store.get('hostsData') || {}).stats || {}, store.get('certificates') || []);
    const cachedHistory = store.get('metricsHistory');
    if (cachedHistory) refreshChart(cachedHistory);
    const cachedSystem = store.get('lastUptime')?.system;
    if (cachedSystem) {
        const metaEl = find('#welcomeMeta');
        if (metaEl && metaEl.textContent === '—') {
            metaEl.textContent = [store.get('sys.version') || '', cachedSystem.uptime || ''].filter(Boolean).join(' · ');
        }
    }

    unsub = listen('metrics:updated', processMetrics);

    // Health bar expand/collapse
    on('#healthBarRow', 'click', () => {
        const detail  = find('#healthDetail');
        const icon    = find('#healthSection .health-bar-expand-icon');
        if (!detail) return;
        const open = detail.style.display !== 'none';
        detail.style.display = open ? 'none' : 'block';
        if (icon) icon.style.transform = open ? '' : 'rotate(90deg)';
        if (!open) _renderHealthDetail();
    });

    function _renderHealthDetail() {
        const grid   = find('#healthDetailGrid');
        if (!grid) return;
        const uptime = store.get('lastUptime') || {};
        const sys    = uptime.system || {};
        const hosts  = (store.get('hostsData') || {}).stats || {};
        let totalReqs = 0, totalErrs = 0, deadBEs = 0, aliveBEs = 0;
        for (const h of Object.values(hosts)) {
            totalReqs += h.total_reqs || 0;
            (h.routes || []).forEach(r => (r.backends || []).forEach(b => {
                totalErrs += b.failures || 0;
                if (b.alive === false) deadBEs++; else aliveBEs++;
            }));
        }
        const rows = [
            ['Uptime',       sys.uptime       || '—'],
            ['Goroutines',   sys.num_goroutine || '—'],
            ['Memory',       sys.mem_rss ? utils.formatBytes(sys.mem_rss) : '—'],
            ['Total Requests', fmtReqs(totalReqs)],
            ['Total Errors',   fmtReqs(totalErrs)],
            ['Live Backends',  String(aliveBEs)],
            ['Dead Backends',  deadBEs > 0 ? `<span style="color:var(--danger);">${deadBEs}</span>` : '0'],
        ];
        grid.innerHTML = rows.map(([k,v]) =>
            `<div class="detail-row"><span class="detail-label">${k}</span><span class="detail-value">${v}</span></div>`
        ).join('');
    }

    on('#hostBriefing', 'click', (e) => {
        const row = e.target.closest('[data-hostname]');
        if (!row) return;
        emit('drawer:open-route', { host: row.dataset.hostname, idx: 0, type: 'route' });
    });

    on('#hostBriefing', 'contextmenu', (e) => {
        const row = e.target.closest('[data-hostname]');
        if (!row) return;
        e.preventDefault();
        const domain = row.dataset.hostname;
        const { clickmenu } = inject('app').oja;
        clickmenu.show(e.clientX, e.clientY, [
            { label: 'Go to host',   icon: '🔗', action: () => { store.set('searchTerm', domain); emit('app:navigate', { path: '/hosts' }); } },
            { label: 'Performance',  icon: '📈', action: () => emit('perf:open', { hostname: domain }) },
            { separator: true },
            { label: 'Edit config',  icon: '✏️', action: () => { store.set('searchTerm', domain); emit('app:navigate', { path: '/hosts' }); setTimeout(() => emit('host:open-edit', { domain }), 150); } },
        ]);
    });

    on('.chart-tab', 'click', (e) => {
        const tab = e.target.closest('.chart-tab');
        if (!tab) return;
        findAll('.chart-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        store.set('activeChart', tab.dataset.type);
        refreshChart();
    });

    onUnmount(() => {
        if (unsub) unsub();
        mainChart?.destroy?.();
        mainChart = null;
        unsub = null;
    });

    ready();
}
