/**
 * js/drawer-listeners.js
 * Route and backend drawer wiring. Uses classList .active (matching CSS).
 * Data: lastConfig.hosts[host] for config, hostsData.stats[host] for live data.
 */

import { listen, emit } from '../lib/oja.full.esm.js';
import { store }        from './store.js';
import { fmtNum }       from './api.js';

// Drawer helpers — classList .active matches the CSS .drawer.active rule
function openDrawer(id) {
    document.getElementById(id)?.classList.add('active');
    document.getElementById('drawerBackdrop')?.classList.add('active');
}

function closeDrawer(id) {
    document.getElementById(id)?.classList.remove('active');
    if (!document.querySelector('.drawer.active')) {
        document.getElementById('drawerBackdrop')?.classList.remove('active');
    }
}

// Wire close buttons and backdrop via delegation
document.addEventListener('click', e => {
    const closeBtn = e.target.closest('[data-action="close-drawer"]');
    if (closeBtn) { closeDrawer(closeBtn.dataset.target); return; }
    if (e.target.id === 'drawerBackdrop') {
        document.querySelectorAll('.drawer.active').forEach(d => d.classList.remove('active'));
        document.getElementById('drawerBackdrop')?.classList.remove('active');
    }
});

// ─── Route drawer ─────────────────────────────────────────────────────────────
listen('drawer:open-route', ({ host, idx, type }) => {
    const lastConfig = store.get('lastConfig') || {};
    const hostsData  = store.get('hostsData')  || { stats: {} };
    const hostCfg    = lastConfig.hosts?.[host] || {};
    const hostStats  = hostsData.stats?.[host]  || {};

    const item = type === 'proxy' ? hostCfg.proxies?.[idx] : hostCfg.routes?.[idx];
    if (!item) return;

    const itemStats = type === 'proxy'
        ? (hostStats.proxies?.[idx] || {})
        : (hostStats.routes?.[idx]  || {});

    const path = item.path || (item.name ? item.name.replace('*default*', '* (TCP)') : item.protocol || '*');
    const el = id => document.getElementById(id);
    if (el('drawerRoutePath')) el('drawerRoutePath').innerText = path;
    if (el('drawerHostName'))  el('drawerHostName').innerText  = host;

    const body = el('drawerBody');
    if (body) {
        body.innerHTML = buildRouteHTML(host, item, itemStats, type, store.get('certificates') || [], idx);
        body.querySelectorAll('[data-action="open-backend"]').forEach(btn => {
            btn.addEventListener('click', () => emit('drawer:open-backend', {
                host,
                routeIdx:   parseInt(btn.dataset.routeIdx),
                backendIdx: parseInt(btn.dataset.backendIdx),
                type:       btn.dataset.type,
            }));
        });
        body.querySelectorAll('[data-action="copy-url"]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                navigator.clipboard?.writeText(btn.dataset.url).then(() => {
                    const old = btn.innerText; btn.innerText = 'Copied!';
                    setTimeout(() => btn.innerText = old, 2000);
                }).catch(() => {});
            });
        });
    }
    openDrawer('routeDrawer');
});

// ─── Backend drawer ────────────────────────────────────────────────────────────
listen('drawer:open-backend', ({ host, routeIdx, backendIdx, type }) => {
    const lastConfig = store.get('lastConfig') || {};
    const hostsData  = store.get('hostsData')  || { stats: {} };
    const hostCfg    = lastConfig.hosts?.[host] || {};
    const hostStats  = hostsData.stats?.[host]  || {};

    const cfgItem = type === 'proxy'
        ? (hostCfg.proxies?.[routeIdx]?.backends?.[backendIdx]         || {})
        : (hostCfg.routes?.[routeIdx]?.backends?.servers?.[backendIdx] || {});
    const bStat = type === 'proxy'
        ? (hostStats.proxies?.[routeIdx]?.backends?.[backendIdx]        || {})
        : (hostStats.routes?.[routeIdx]?.backends?.[backendIdx]         || {});

    const url = bStat.url || bStat.address || cfgItem.address || 'Unknown';
    const el  = id => document.getElementById(id);
    if (el('backendDrawerTitle')) el('backendDrawerTitle').innerText = 'Backend Activity';
    if (el('backendDrawerUrl'))   el('backendDrawerUrl').innerText   = url;

    const body = el('backendDrawerBody');
    if (body) body.innerHTML = buildBackendHTML(cfgItem, bStat);

    openDrawer('backendDrawer');
});

// ─── Route drawer HTML ────────────────────────────────────────────────────────
function buildRouteHTML(hostname, item, itemStats, type, certificates, routeIdx) {
    const isTCP      = type === 'proxy' || item.protocol === 'tcp';
    const protoClass = isTCP ? 'info' : 'success';
    const protoIcon  = isTCP ? '🔌' : '🌐';
    const protoType  = isTCP ? 'TCP' : 'HTTP';
    let html = '';

    // Web / Git handler
    if (!isTCP && item.web) {
        const git = item.web.git;
        if (git?.enabled === 'on' || git?.enabled === true) {
            const gitStats = store.get('gitStats') || {};
            const gs       = gitStats[git.id] || {};
            const state    = gs.state || 'unknown';
            const commit   = gs.commit ? gs.commit.substring(0, 8) : 'none';
            const sCls     = state === 'healthy' ? 'success' : state === 'unavailable' ? 'warning' : 'error';
            const whUrl    = `${window.location.origin}/.well-known/agbero/webhook/git/${git.id}`;
            html += `<div class="detail-section">
                <div class="detail-title">🐙 Git Deployment</div>
                <div class="handler-card">
                    <span class="handler-icon">📦</span>
                    <div class="handler-info" style="flex:1;">
                        <strong>${git.id}</strong>
                        <span>Branch: ${git.branch || 'main'}</span>
                        <div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                            <span class="badge ${sCls}">State: ${state}</span>
                            <span class="badge info">Commit: ${commit}</span>
                            <span class="badge">Deploys: ${gs.deployments || 0}</span>
                        </div>
                    </div>
                </div>
                <div class="kv-grid" style="margin-top:10px;">
                    <div class="kv-item" style="grid-column:span 2;">
                        <label>Webhook URL</label>
                        <div style="display:flex;gap:10px;align-items:center;">
                            <span class="mono" style="font-size:10px;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;flex:1;overflow-x:auto;">${whUrl}</span>
                            <button class="btn small" data-action="copy-url" data-url="${whUrl}">Copy</button>
                        </div>
                    </div>
                </div>
            </div>`;
        } else if (item.web.root) {
            html += `<div class="detail-section">
                <div class="detail-title">📂 Static File Handler</div>
                <div class="handler-card">
                    <span class="handler-icon">📁</span>
                    <div class="handler-info">
                        <strong>File Server</strong>
                        <span>Root: ${item.web.root}</span>
                        <span>Listing: ${item.web.listing ? 'Enabled' : 'Disabled'}</span>
                        ${item.web.spa ? '<span>SPA mode: on</span>' : ''}
                        ${item.web.markdown?.enabled === 'on' ? '<span>Markdown: on</span>' : ''}
                    </div>
                </div>
            </div>`;
            if (item.web.php?.enabled === 'on') {
                html += `<div class="detail-section">
                    <div class="detail-title">🐘 PHP FastCGI</div>
                    <div class="handler-card">
                        <span class="handler-icon">⚙️</span>
                        <div class="handler-info"><strong>${item.web.php.address || '127.0.0.1:9000'}</strong></div>
                    </div>
                </div>`;
            }
        }
    }

    // Backends
    const configBEs  = item.backends?.servers || [];
    const statBEs    = itemStats.backends     || [];
    const displayBEs = configBEs.length > 0 ? configBEs : statBEs;

    if (displayBEs.length) {
        let beHtml = '';
        displayBEs.forEach((b, bIdx) => {
            const bSt  = statBEs[bIdx]   || {};
            const cfgB = configBEs[bIdx] || {};
            const url  = bSt.url || bSt.address || cfgB.address || '';
            const w    = cfgB.weight !== undefined ? cfgB.weight : 1;
            const has  = !!statBEs[bIdx];
            const hSt  = bSt.health?.status || 'Unknown';
            let dc = 'warn', dt = 'No data';
            if (has) {
                if (!bSt.alive || hSt === 'Dead' || hSt === 'Unhealthy')  { dc = 'down'; dt = hSt !== 'Unknown' ? hSt : 'Dead'; }
                else if (hSt === 'Degraded')                               { dc = 'warn'; dt = 'Degraded'; }
                else if (hSt === 'Healthy')                                { dc = 'ok';   dt = 'Healthy'; }
                else                                                       { dc = bSt.alive ? 'info' : 'down'; dt = bSt.alive ? 'Unverified (Active)' : 'Dead'; }
            }
            const p99  = bSt.latency_us?.p99 ? (bSt.latency_us.p99 / 1000).toFixed(0) + 'ms' : '';
            const inf  = bSt.in_flight  || 0;
            const fail = bSt.failures   || 0;
            const reqs = bSt.total_reqs || 0;
            beHtml += `<div class="drawer-row clickable" data-action="open-backend"
                data-host="${hostname}" data-route-idx="${routeIdx}"
                data-backend-idx="${bIdx}" data-type="${type}">
                <div class="row-left">
                    <span class="dot ${dc}" title="${dt}"></span>
                    <span class="mono">${url}</span>
                    ${inf  > 0 ? `<span class="badge info">⚡ ${inf} in flight</span>` : ''}
                    ${fail > 0 ? `<span class="badge error">⚠️ ${fmtNum(fail)} failures</span>` : ''}
                </div>
                <div class="row-right">
                    ${p99 ? `<span class="badge info">p99: ${p99}</span>` : ''}
                    <span class="badge ${dc === 'ok' ? 'success' : dc === 'warn' ? 'warning' : 'error'}">W: ${w}</span>
                    <span class="badge" style="background:var(--text-mute);">${fmtNum(reqs)} reqs</span>
                </div>
            </div>`;
        });

        const lb = (item.backends?.strategy || 'round_robin').split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
        const hc = item.health_check;
        let hcHtml = '<div class="kv-item"><label>Health Check</label><div><span class="badge error">Not Configured</span></div></div>';
        if (hc?.enabled === 'on') {
            hcHtml = `<div class="kv-item"><label>Health Check</label><div><span class="badge success">${hc.path || '/health'} | ${hc.interval || '10s'} | ${hc.timeout || '5s'}</span></div></div>`;
        }
        const cb = item.circuit_breaker;
        let cbHtml = '';
        if (cb?.enabled === 'on') {
            cbHtml = `<div class="kv-item"><label>Circuit Breaker</label><div><span class="badge warning">${cb.threshold || 5} fails → ${cb.duration || '30s'}</span></div></div>`;
        }
        const to = item.timeouts || {};
        const fmt_to = v => v ? v : 'inherit';

        html += `<div class="detail-section">
            <div class="detail-title">
                <span class="badge ${protoClass}" style="margin-right:8px;">${protoIcon} ${protoType}</span>
                Upstreams &amp; Load Balancing
            </div>
            ${beHtml}
            <div class="kv-grid" style="margin-top:15px;">
                <div class="kv-item"><label>Strategy</label><div><span class="badge success">${lb}</span></div></div>
                ${hcHtml}${cbHtml}
                <div class="kv-item"><label>Read Timeout</label><div>${fmt_to(to.read)}</div></div>
                <div class="kv-item"><label>Write Timeout</label><div>${fmt_to(to.write)}</div></div>
                <div class="kv-item"><label>Idle Timeout</label><div>${fmt_to(to.idle)}</div></div>
            </div>
        </div>`;

        // HTTP features
        if (!isTCP) {
            let featHtml = '';
            const comp = item.compression_config || {};
            if (comp.enabled === 'on') featHtml += `<div class="kv-item"><label>Compression</label><div><span class="badge info">${comp.type || 'gzip'} (lvl ${comp.level || 'auto'})</span></div></div>`;
            const rl = item.rate_limit;
            if (rl?.enabled === 'on') {
                const r = rl.rule || {};
                featHtml += `<div class="kv-item"><label>Rate Limit</label><div><span class="badge warning">${r.requests || 0} / ${r.window || '1m'} (${r.key || 'ip'})</span></div></div>`;
            }
            if (item.cors?.enabled === 'on') featHtml += `<div class="kv-item"><label>CORS</label><div><span class="badge info">${(item.cors.allowed_origins || []).join(', ') || '*'}</span></div></div>`;
            if (item.strip_prefixes?.length) featHtml += `<div class="kv-item"><label>Strip Prefix</label><div>${item.strip_prefixes.map(p => `<span class="badge">${p}</span>`).join(' ')}</div></div>`;
            if (item.wasm?.enabled === 'on') featHtml += `<div class="kv-item"><label>WASM</label><div><span class="badge info">${item.wasm.module?.split('/').pop() || 'filter.wasm'}</span></div></div>`;
            if (item.headers?.enabled === 'on') {
                const rh = item.headers.request || {}, rs = item.headers.response || {};
                const n = [rh.set, rh.add, rs.set, rs.add].filter(Boolean).reduce((a, o) => a + Object.keys(o).length, 0)
                        + (rh.remove?.length || 0) + (rs.remove?.length || 0);
                if (n) featHtml += `<div class="kv-item"><label>Header Rules</label><div><span class="badge info">${n} modifications</span></div></div>`;
            }
            if (featHtml) html += `<div class="detail-section"><div class="detail-title">⚙️ HTTP Features</div><div class="kv-grid">${featHtml}</div></div>`;
        }
    }

    // TLS certs
    const hostCerts = certificates.filter(c => c.host === hostname);
    if (hostCerts.length) {
        html += `<div class="detail-section"><div class="detail-title">🔐 TLS Certificates</div><div class="cert-grid">
            ${hostCerts.map(cert => {
                let cls = 'success', txt = `${cert.daysLeft}d`;
                if (cert.daysLeft < 0) { cls = 'error'; txt = 'Expired'; }
                else if (cert.daysLeft < 7) { cls = 'warning'; txt = `${cert.daysLeft}d left`; }
                return `<div class="cert-card">
                    <div class="cert-domain">${cert.host}</div>
                    <div class="cert-expiry"><span>${cert.issuer || "Let's Encrypt"}</span><span class="badge ${cls}">${txt}</span></div>
                    <div style="font-size:9px;color:var(--text-mute);margin-top:4px;">${new Date(cert.expiry).toLocaleDateString()}</div>
                </div>`;
            }).join('')}
        </div></div>`;
    }

    // Auth
    if (!isTCP) {
        let authHtml = '';
        if (item.basic_auth?.enabled === 'on')   authHtml += `<div class="mw-card security"><div class="mw-head">Basic Auth</div><div class="mw-body">${item.basic_auth.users?.length || 0} users</div><div class="mw-sub">Realm: ${item.basic_auth.realm || 'Restricted'}</div></div>`;
        if (item.jwt_auth?.enabled === 'on')     authHtml += `<div class="mw-card security"><div class="mw-head">JWT Auth</div><div class="mw-body">${item.jwt_auth.issuer || 'No issuer'}</div><div class="mw-sub">Audience: ${item.jwt_auth.audience || 'any'}</div></div>`;
        if (item.oauth?.enabled === 'on')        authHtml += `<div class="mw-card security"><div class="mw-head">OAuth</div><div class="mw-body">${item.oauth.provider || 'OIDC'}</div><div class="mw-sub">${(item.oauth.scopes || []).join(', ')}</div></div>`;
        if (item.forward_auth?.enabled === 'on') authHtml += `<div class="mw-card security"><div class="mw-head">Forward Auth</div><div class="mw-body">${item.forward_auth.name || ''}</div><div class="mw-sub">${item.forward_auth.url || ''}</div></div>`;
        if (authHtml) html += `<div class="detail-section"><div class="detail-title">🔑 Authentication</div><div class="mw-grid">${authHtml}</div></div>`;
    }

    html += `<div class="detail-section"><div class="detail-title">📜 Source (read-only)</div><div class="code-box" style="max-height:200px;"><pre>${JSON.stringify(item, null, 2)}</pre></div></div>`;
    return html;
}

// ─── Backend drawer HTML ──────────────────────────────────────────────────────
function buildBackendHTML(cfg, bStat) {
    const p    = us => us ? (us / 1000).toFixed(1) + 'ms' : '—';
    const lat  = bStat.latency_us || {};
    const h    = bStat.health     || {};
    const hScore    = h.score || (bStat.alive ? 100 : 0);
    const stateText = h.status || (bStat.alive ? 'Unverified (Active)' : 'Dead');
    const scoreColor = hScore > 80 ? 'var(--success)' : hScore > 50 ? 'var(--warning)' : 'var(--danger)';
    const lastOk    = h.last_success ? new Date(h.last_success).toLocaleString() : 'Never';
    const lastFail  = h.last_failure ? new Date(h.last_failure).toLocaleString() : 'None';
    const downHtml  = h.downtime ? `<div class="kv-item"><label>Downtime</label><div><span class="badge error">${h.downtime}</span></div></div>` : '';

    let criteriaHtml = '';
    if (cfg.criteria?.source_ips?.length || cfg.criteria?.headers) {
        criteriaHtml = `<div class="detail-section"><div class="detail-title">🎯 Routing Criteria</div><div class="kv-grid">
            <div class="kv-item"><label>Source IPs</label><div>${cfg.criteria.source_ips?.join(', ') || 'Any'}</div></div>
            <div class="kv-item"><label>Headers</label><div>${cfg.criteria.headers ? JSON.stringify(cfg.criteria.headers) : 'None'}</div></div>
        </div></div>`;
    }

    return `
    <div class="detail-section">
        <div class="detail-title">🏥 Predictive Health</div>
        <div class="health-gauge">
            <div class="gauge-circle" style="background:${scoreColor}">${hScore}</div>
            <div class="gauge-info">
                <div class="gauge-status">${stateText}</div>
                <div class="gauge-sub">Consecutive Fails: ${h.consecutive_failures || 0}</div>
            </div>
        </div>
        <div class="kv-grid">
            <div class="kv-item"><label>Last Success</label><div>${lastOk}</div></div>
            <div class="kv-item"><label>Last Failure</label><div>${lastFail}</div></div>
            ${downHtml}
        </div>
    </div>
    <div class="detail-section">
        <div class="detail-title">📊 Traffic &amp; Latency</div>
        <div class="kv-grid" style="margin-bottom:15px;">
            <div class="kv-item"><label>Total Requests</label><div>${fmtNum(bStat.total_reqs || 0)}</div></div>
            <div class="kv-item"><label>Active / In-Flight</label><div><span class="badge info">${bStat.in_flight || 0}</span></div></div>
            <div class="kv-item"><label>Total Failures</label><div>${bStat.failures > 0 ? `<span class="badge error">${fmtNum(bStat.failures)}</span>` : '0'}</div></div>
            <div class="kv-item"><label>Configured Weight</label><div>${cfg.weight || 1}</div></div>
        </div>
        <div class="handler-card" style="display:grid;grid-template-columns:repeat(4,1fr);text-align:center;padding:10px 15px;gap:5px;">
            <div><div style="font-size:9px;color:var(--text-mute);text-transform:uppercase;">Avg</div><div style="font-size:12px;font-family:monospace;margin-top:2px;color:var(--fg);">${p(lat.avg_us)}</div></div>
            <div><div style="font-size:9px;color:var(--text-mute);text-transform:uppercase;">p50</div><div style="font-size:12px;font-family:monospace;margin-top:2px;color:var(--fg);">${p(lat.p50)}</div></div>
            <div><div style="font-size:9px;color:var(--text-mute);text-transform:uppercase;">p90</div><div style="font-size:12px;font-family:monospace;margin-top:2px;color:var(--warning);">${p(lat.p90)}</div></div>
            <div><div style="font-size:9px;color:var(--text-mute);text-transform:uppercase;">p99</div><div style="font-size:12px;font-family:monospace;margin-top:2px;color:var(--danger);">${p(lat.p99)}</div></div>
        </div>
    </div>
    ${criteriaHtml}
    <div class="detail-section"><div class="detail-title">📜 Backend Config</div><div class="code-box" style="max-height:150px;"><pre>${JSON.stringify(cfg, null, 2)}</pre></div></div>`;
}
