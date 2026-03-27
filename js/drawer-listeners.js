/**
 * js/drawer-listeners.js
 *
 * Route and backend drawer wiring.
 *
 * TYPE MAP (from alaye Go structs):
 *   Enabled fields → "on" | "off" | "unknown"   — check === 'on'
 *   bool fields    → true | false                — check === true
 *   These are DIFFERENT. Never mix them.
 *
 *   Enabled:  all .enabled, protected, unsafe, toc, highlight.enabled
 *   bool:     web.listing, web.spa, web.no_cache, host.compression,
 *             cors.allow_credentials, health_check.accelerated_probing,
 *             health_check.synthetic_when_idle, rate_limit.ignore_global,
 *             firewall.ignore_global, forward_auth.allow_private
 */

import { listen, emit, on, clipboard, notify, query, queryAll } from '../lib/oja.full.esm.js';
import { store } from './store.js';
import { fmtNum } from './api.js';

// ── Enabled helper ────────────────────────────────────────────────────────────
// Only returns true for Enabled fields serialised as "on".
// Do NOT use for plain bool fields.
const isOn = v => v === 'on';

// ── Drawer open / close ───────────────────────────────────────────────────────

function openDrawer(id) {
    query('#' + id)?.classList.add('active');
    query('#drawerBackdrop')?.classList.add('active');
}

function closeDrawer(id) {
    query('#' + id)?.classList.remove('active');
    if (!query('.drawer.active')) {
        query('#drawerBackdrop')?.classList.remove('active');
    }
}

on('[data-action="close-drawer"]', 'click', (e, btn) => closeDrawer(btn.dataset.target));

on('#drawerBackdrop', 'click', () => {
    queryAll('.drawer.active').forEach(d => d.classList.remove('active'));
    query('#drawerBackdrop')?.classList.remove('active');
});

on('#drawerPerfBtn', 'click', (e, btn) => {
    const hostname = btn.dataset.hostname || query('#drawerHostName')?.dataset.host;
    if (hostname) emit('perf:open', { hostname });
});

// ── Delegated interactions ────────────────────────────────────────────────────

on('[data-action="open-backend"]', 'click', (e, btn) => {
    emit('drawer:open-backend', {
        host:       btn.dataset.host,
        routeIdx:   parseInt(btn.dataset.routeIdx),
        backendIdx: parseInt(btn.dataset.backendIdx),
        type:       btn.dataset.type,
    });
});

on('[data-action="copy-url"]', 'click', (e, btn) => {
    e.stopPropagation();
    clipboard.write(btn.dataset.url)
        .then(() => notify.show('Copied', 'success'))
        .catch(() => {});
});

// ── Listen for drawer open events ─────────────────────────────────────────────

listen('drawer:open-route', ({ host, idx, type }) => {
    const hostCfg   = (store.get('lastConfig') || {}).hosts?.[host]          || {};
    const hostStats = (store.get('hostsData')  || { stats: {} }).stats?.[host] || {};

    const item      = type === 'proxy' ? hostCfg.proxies?.[idx]  : hostCfg.routes?.[idx];
    if (!item) return;
    const itemStats = type === 'proxy' ? hostStats.proxies?.[idx] : hostStats.routes?.[idx];

    const path = item.path || (item.name ? item.name.replace('*default*', '* (TCP)') : item.protocol || '*');
    const el   = query('#drawerRoutePath');
    const hn   = query('#drawerHostName');
    if (el) el.innerText = path;
    if (hn) {
        hn.dataset.host = host;
        const textNode = [...hn.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.textContent = host + ' ';
        else hn.firstChild && (hn.firstChild.textContent = host + ' ');
    }

    const body = query('#drawerBody');
    if (body) body.innerHTML = buildRouteHTML(host, item, itemStats || {}, type, store.get('certificates') || [], idx);

    openDrawer('routeDrawer');
});

listen('drawer:open-backend', ({ host, routeIdx, backendIdx, type }) => {
    const hostCfg   = (store.get('lastConfig') || {}).hosts?.[host]          || {};
    const hostStats = (store.get('hostsData')  || { stats: {} }).stats?.[host] || {};

    const cfgItem = type === 'proxy'
        ? (hostCfg.proxies?.[routeIdx]?.backends?.[backendIdx]         || {})
        : (hostCfg.routes?.[routeIdx]?.backends?.servers?.[backendIdx] || {});
    const bStat = type === 'proxy'
        ? (hostStats.proxies?.[routeIdx]?.backends?.[backendIdx]        || {})
        : (hostStats.routes?.[routeIdx]?.backends?.[backendIdx]         || {});

    const url = bStat.url || bStat.address || cfgItem.address || 'Unknown';
    const titleEl = query('#backendDrawerTitle');
    const urlEl   = query('#backendDrawerUrl');
    if (titleEl) titleEl.innerText = 'Backend Activity';
    if (urlEl)   urlEl.innerText   = url;

    const body = query('#backendDrawerBody');
    if (body) body.innerHTML = buildBackendHTML(cfgItem, bStat);

    openDrawer('backendDrawer');
});

// ── HTML builders ─────────────────────────────────────────────────────────────

function section(title, content) {
    if (!content || content.trim() === '') return '';
    return `<div class="detail-section">
        <div class="detail-title">${title}</div>
        ${content}
    </div>`;
}

function kvGrid(pairs) {
    const items = pairs
        .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false && v !== 0)
        .map(([label, value]) =>
            `<div class="kv-item"><label>${label}</label><div>${value}</div></div>`
        ).join('');
    if (!items) return '';
    return `<div class="kv-grid">${items}</div>`;
}

function badge(text, cls = '') {
    return `<span class="badge ${cls}">${text}</span>`;
}

// ── Web section ───────────────────────────────────────────────────────────────

function webSection(web) {
    if (!web || !isOn(web.enabled)) return '';

    const pairs = [];

    if (web.root)     pairs.push(['Root',    `<code>${web.root}</code>`]);
    if (web.index?.length) pairs.push(['Index',   web.index.map(i => `<code>${i}</code>`).join(' ')]);

    // bool fields
    if (web.listing)  pairs.push(['Listing',  badge('Enabled', 'success')]);
    if (web.spa)      pairs.push(['SPA Mode', badge('On', 'info')]);
    if (web.no_cache) pairs.push(['Cache',    badge('Disabled', 'warning')]);

    // Markdown — Enabled type
    const md = web.markdown;
    if (isOn(md?.enabled)) {
        const mdParts = [badge(md.view === 'browse' ? 'Browse Mode' : 'Website Mode', 'info')];
        if (isOn(md.toc))     mdParts.push(badge('TOC', ''));
        if (isOn(md.unsafe))  mdParts.push(badge('Unsafe HTML', 'warning'));
        if (isOn(md.highlight?.enabled)) mdParts.push(badge('Highlight: ' + (md.highlight.theme || 'default'), ''));
        pairs.push(['Markdown', mdParts.join(' ')]);
    }

    // PHP — Enabled type
    if (isOn(web.php?.enabled)) {
        pairs.push(['PHP', badge(web.php.address || '127.0.0.1:9000', 'info')]);
    }

    const icon = web.markdown?.view === 'browse' ? '📖' : (isOn(web.git?.enabled) ? '🐙' : '📂');
    const title = isOn(web.git?.enabled) ? 'Git Deployment' : 'Static File Server';

    return section(`${icon} ${title}`, kvGrid(pairs));
}

// ── Git section ───────────────────────────────────────────────────────────────

function gitSection(git, hostname) {
    if (!isOn(git?.enabled)) return '';
    const gitStats = store.get('gitStats') || {};
    const gs       = gitStats[git.id]      || {};
    const state    = gs.state  || 'unknown';
    const commit   = gs.commit ? gs.commit.substring(0, 8) : 'none';
    const sCls     = state === 'healthy' ? 'success' : state === 'unavailable' ? 'warning' : 'error';
    const whUrl    = `${window.location.origin}/.well-known/agbero/webhook/git/${git.id}`;

    const pairs = [
        ['ID',       `<code>${git.id}</code>`],
        ['URL',      `<a href="${git.url}" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all;">${git.url}</a>`],
        ['Branch',   git.branch || badge('default', '')],
        ['Interval', git.interval && git.interval !== '0s' ? git.interval : badge('webhook only', '')],
        ['State',    badge(state, sCls)],
        ['Commit',   commit !== 'none' ? `<code>${commit}</code>` : badge('none yet', 'warning')],
        ['Deploys',  gs.deployments || 0],
    ];

    if (git.sub_dir) pairs.push(['Sub Dir', `<code>${git.sub_dir}</code>`]);
    if (isOn(git.auth?.type)) pairs.push(['Auth', badge(git.auth.type, 'info')]);

    const whHtml = `<div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
        <code style="font-size:10px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;flex:1;overflow-x:auto;white-space:nowrap;">${whUrl}</code>
        <button class="btn small" data-action="copy-url" data-url="${whUrl}" style="flex-shrink:0;">Copy</button>
    </div>`;

    return section('🐙 Git Deployment', kvGrid(pairs) + `<div style="margin-top:8px;"><label style="font-size:10px;color:var(--text-mute);text-transform:uppercase;letter-spacing:.5px;">Webhook URL</label>${whHtml}</div>`);
}

// ── Serverless section ────────────────────────────────────────────────────────

function serverlessSection(serverless) {
    if (!isOn(serverless?.enabled)) return '';
    const workers = serverless.workers || [];
    const rests   = serverless.rests   || [];
    if (!workers.length && !rests.length) return '';

    let html = '';

    if (workers.length) {
        html += `<div style="margin-bottom:8px;"><strong style="font-size:11px;">Workers (${workers.length})</strong></div>`;
        html += workers.map(w => `
            <div class="handler-card" style="margin-bottom:6px;">
                <span class="handler-icon">⚙️</span>
                <div class="handler-info">
                    <strong>${w.name}</strong>
                    <span><code>${(w.command || []).join(' ')}</code></span>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
                        ${w.background ? badge('background', 'info') : ''}
                        ${w.run_once   ? badge('run once', '') : ''}
                        ${w.restart    ? badge('restart: ' + w.restart, '') : ''}
                        ${w.schedule   ? badge('cron: ' + w.schedule, 'warning') : ''}
                    </div>
                </div>
            </div>`).join('');
    }

    if (rests.length) {
        html += `<div style="margin:8px 0 4px;"><strong style="font-size:11px;">REST Proxies (${rests.length})</strong></div>`;
        html += rests.map(r => `
            <div class="handler-card" style="margin-bottom:6px;">
                <span class="handler-icon">🔌</span>
                <div class="handler-info">
                    <strong>${r.name}</strong>
                    <span>${r.method || 'GET'} <a href="${r.url}" target="_blank" rel="noopener" style="color:var(--accent);">${r.url}</a></span>
                    ${r.timeout && r.timeout !== '0s' ? `<span>Timeout: ${r.timeout}</span>` : ''}
                </div>
            </div>`).join('');
    }

    return section('⚡ Serverless', html);
}

// ── Upstreams section ─────────────────────────────────────────────────────────

function backendRow(b, cfgB, bStat, hostname, routeIdx, bIdx, type) {
    const url  = bStat.url || bStat.address || cfgB.address || '';
    const w    = cfgB.weight !== undefined ? cfgB.weight : 1;
    const has  = !!bStat.url || !!bStat.address;
    const hSt  = bStat.health?.status || 'Unknown';

    let dc = 'warn', dt = 'No data';
    if (has) {
        if      (!bStat.alive || hSt === 'Dead' || hSt === 'Unhealthy') { dc = 'down'; dt = hSt !== 'Unknown' ? hSt : 'Dead'; }
        else if (hSt === 'Degraded')                                     { dc = 'warn'; dt = 'Degraded'; }
        else if (hSt === 'Healthy')                                      { dc = 'ok';   dt = 'Healthy'; }
        else                                                             { dc = bStat.alive ? 'info' : 'down'; dt = bStat.alive ? 'Unverified' : 'Dead'; }
    }

    const p99  = bStat.latency_us?.p99 ? (bStat.latency_us.p99 / 1000).toFixed(0) + 'ms' : '';
    const inf  = bStat.in_flight  || 0;
    const fail = bStat.failures   || 0;
    const reqs = bStat.total_reqs || 0;
    const wCls = dc === 'ok' ? 'success' : dc === 'warn' ? 'warning' : 'error';

    return `<div class="drawer-row clickable" data-action="open-backend"
            data-host="${hostname}" data-route-idx="${routeIdx}"
            data-backend-idx="${bIdx}" data-type="${type}">
        <div class="drawer-row-top">
            <div class="row-left">
                <span class="dot ${dc}" title="${dt}"></span>
                <span class="mono row-url">${url}</span>
            </div>
            <div class="row-right">
                ${inf  > 0 ? `<span class="be-tag be-tag-warn">⚡ ${inf} in flight</span>` : ''}
                ${fail > 0 ? `<span class="be-tag be-tag-danger">⚠️ ${fmtNum(fail)} fails</span>` : ''}
            </div>
        </div>
        <div class="drawer-row-bottom">
            ${p99 ? `<span class="be-tag be-tag-info">p99: ${p99}</span>` : ''}
            <span class="be-tag be-tag-${wCls}">W: ${w}</span>
            <span class="be-tag">${fmtNum(reqs)} reqs</span>
        </div>
    </div>`;
}

function upstreamsSection(hostname, item, itemStats, routeIdx, type) {
    const configBEs  = item.backends?.servers || [];
    const statBEs    = itemStats.backends     || [];
    const displayBEs = configBEs.length > 0 ? configBEs : statBEs;
    if (!displayBEs.length) return '';

    const rows = displayBEs.map((b, bIdx) =>
        backendRow(b, configBEs[bIdx] || {}, statBEs[bIdx] || {}, hostname, routeIdx, bIdx, type)
    ).join('');

    const lb      = (item.backends?.strategy || 'round_robin')
        .split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const hc      = item.health_check;
    const cb      = item.circuit_breaker;
    const to      = item.timeouts || {};
    const isTCP   = type === 'proxy' || item.protocol === 'tcp';
    const protoLabel = isTCP ? '🔌 TCP' : '🌐 HTTP';

    const hcBadge = isOn(hc?.enabled)
        ? badge(`${hc.path || '/health'} · ${hc.interval || '10s'} · ${hc.timeout || '5s'}`, 'success')
        : badge('Not configured', 'error');

    const pairs = [
        ['Strategy',      badge(lb, 'success')],
        ['Health Check',  hcBadge],
        ...(isOn(cb?.enabled) ? [['Circuit Breaker', badge(`${cb.threshold || 5} fails → ${cb.duration || '30s'}`, 'warning')]] : []),
        ...(isOn(to?.enabled) && to.request && to.request !== '0s' ? [['Timeout', to.request]] : []),
    ];

    return section(
        `${badge(protoLabel, isTCP ? 'info' : 'success')} Upstreams & Load Balancing`,
        rows + kvGrid(pairs)
    );
}

// ── HTTP Features section — exhaustive ────────────────────────────────────────

function httpFeaturesSection(item) {
    const pairs = [];

    // Compression — Enabled type
    const comp = item.compression_config || {};
    if (isOn(comp.enabled))
        pairs.push(['Compression', badge(`${comp.type || 'gzip'} lvl ${comp.level || 'auto'}`, 'info')]);

    // Rate limit — Enabled type
    const rl = item.rate_limit;
    if (isOn(rl?.enabled)) {
        const r = rl.rule || {};
        const ruleLabel = isOn(r.enabled)
            ? `${fmtNum(r.requests)} / ${r.window || '1m'} · key: ${r.key || 'ip'}`
            : (rl.use_policy ? `policy: ${rl.use_policy}` : 'configured');
        pairs.push(['Rate Limit', badge(ruleLabel, 'warning')]);
        if (rl.ignore_global) pairs.push(['Rate Global', badge('Ignored', 'warning')]); // bool
    }

    // CORS — Enabled type
    if (isOn(item.cors?.enabled)) {
        const origins = (item.cors.allowed_origins || []).join(', ') || '*';
        pairs.push(['CORS Origins', origins]);
        if (item.cors.allow_credentials) pairs.push(['CORS Credentials', badge('Allowed', 'warning')]); // bool
    }

    // Cache — Enabled type
    if (isOn(item.cache?.enabled))
        pairs.push(['Cache', badge(`${item.cache.driver || 'memory'} · ${item.cache.ttl || '60s'}`, 'success')]);

    // WASM — Enabled type
    if (isOn(item.wasm?.enabled))
        pairs.push(['WASM', badge(item.wasm.module?.split('/').pop() || 'filter.wasm', 'info')]);

    // Headers — Enabled type
    if (isOn(item.headers?.enabled)) {
        const rh = item.headers.request || {}, rs = item.headers.response || {};
        const n  = [rh.set, rh.add, rs.set, rs.add].filter(Boolean)
                .reduce((a, o) => a + Object.keys(o).length, 0)
            + (rh.remove?.length || 0) + (rs.remove?.length || 0);
        if (n) pairs.push(['Headers', badge(n + ' rules', 'info')]);
    }

    // Firewall — Enabled type
    if (isOn(item.firewall?.enabled)) {
        const rules = item.firewall.apply_rules?.length || 0;
        pairs.push(['Firewall', badge(rules ? `${rules} rules` : 'global rules', 'error')]);
    }

    // IP Filter — plain array (no Enabled field)
    if (item.allowed_ips?.length)
        pairs.push(['IP Filter', badge(`${item.allowed_ips.length} allowed`, 'warning')]);

    // Strip prefixes — plain array
    if (item.strip_prefixes?.length)
        pairs.push(['Strip Prefix', item.strip_prefixes.map(p => badge(p, '')).join(' ')]);

    // Rewrites — plain array
    if (item.rewrites?.length)
        pairs.push(['Rewrites', badge(`${item.rewrites.length} rules`, 'info')]);

    // Fallback — Enabled type
    if (isOn(item.fallback?.enabled)) {
        const fb = item.fallback;
        const label = fb.type === 'redirect' ? `→ ${fb.redirect_url}` :
            fb.type === 'proxy'    ? `proxy: ${fb.proxy_url}` :
                fb.type === 'static'   ? `${fb.status_code || 200}` : fb.type || 'on';
        pairs.push(['Fallback', badge(label, 'info')]);
    }

    // Timeouts — Enabled type
    if (isOn(item.timeouts?.enabled) && item.timeouts.request && item.timeouts.request !== '0s')
        pairs.push(['Timeout', item.timeouts.request]);

    // Circuit breaker — Enabled type (also shown in upstreams, but repeat here for visibility)
    if (isOn(item.circuit_breaker?.enabled))
        pairs.push(['Circuit Breaker', badge(`${item.circuit_breaker.threshold} fails → ${item.circuit_breaker.duration}`, 'warning')]);

    // Health check summary — Enabled type
    if (isOn(item.health_check?.enabled)) {
        const hc = item.health_check;
        pairs.push(['Health Check', badge(`${hc.method || 'GET'} ${hc.path} · ${hc.interval}`, 'success')]);
        if (hc.accelerated_probing) pairs.push(['Probing', badge('Accelerated', 'info')]); // bool
    }

    // Env vars
    if (item.env && Object.keys(item.env).length)
        pairs.push(['Env Vars', badge(Object.keys(item.env).length + ' set', 'info')]);

    return pairs.length ? section('⚙️ HTTP Features', kvGrid(pairs)) : '';
}

// ── Auth section ──────────────────────────────────────────────────────────────

function authSection(item) {
    const cards = [];
    // All .enabled fields are Enabled type → check === 'on'
    if (isOn(item.basic_auth?.enabled))
        cards.push(['Basic Auth',   `${item.basic_auth.users?.length || 0} users`, `Realm: ${item.basic_auth.realm || 'Restricted'}`]);
    if (isOn(item.jwt_auth?.enabled))
        cards.push(['JWT Auth',     item.jwt_auth.issuer || 'No issuer', `Audience: ${item.jwt_auth.audience || 'any'}`]);
    if (isOn(item.oauth?.enabled))
        cards.push(['OAuth',        item.oauth.provider || 'OIDC', (item.oauth.scopes || []).join(', ')]);
    if (isOn(item.forward_auth?.enabled))
        cards.push(['Forward Auth', item.forward_auth.name || '', item.forward_auth.url || '']);
    if (!cards.length) return '';

    const html = cards.map(([head, body, sub]) =>
        `<div class="mw-card security">
            <div class="mw-head">${head}</div>
            <div class="mw-body">${body}</div>
            <div class="mw-sub">${sub}</div>
        </div>`
    ).join('');
    return section('🔑 Authentication', `<div class="mw-grid">${html}</div>`);
}

// ── Certs section ─────────────────────────────────────────────────────────────

function certsSection(certificates, hostname) {
    const hostCerts = certificates.filter(c => c.host === hostname);
    if (!hostCerts.length) return '';

    const cards = hostCerts.map(cert => {
        let cls = 'success', txt = cert.daysLeft + 'd';
        if      (cert.daysLeft < 0) { cls = 'error';   txt = 'Expired'; }
        else if (cert.daysLeft < 7) { cls = 'warning'; txt = cert.daysLeft + 'd left'; }
        return `<div class="cert-card">
            <div class="cert-domain">${cert.host}</div>
            <div class="cert-expiry">
                <span>${cert.issuer || "Let's Encrypt"}</span>
                ${badge(txt, cls)}
            </div>
            <div style="font-size:9px;color:var(--text-mute);margin-top:4px;">
                ${new Date(cert.expiry).toLocaleDateString()}
            </div>
        </div>`;
    }).join('');
    return section('🔐 TLS Certificates', `<div class="cert-grid">${cards}</div>`);
}

function rawSection(title, obj, maxHeight = '200px') {
    return section(title,
        `<div class="code-box" style="max-height:${maxHeight};overflow:auto;">
            <pre style="margin:0;font-size:11px;">${JSON.stringify(obj, null, 2)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
        </div>`
    );
}

// ── Top-level route builder ───────────────────────────────────────────────────

function buildRouteHTML(hostname, item, itemStats, type, certificates, routeIdx) {
    const isTCP = type === 'proxy' || item.protocol === 'tcp';
    const parts = [];

    if (!isTCP && item.web) {
        // Show git section if git is on
        if (isOn(item.web.git?.enabled)) {
            parts.push(gitSection(item.web.git, hostname));
        }
        // Always show web section if web.enabled = 'on' (shows root, index, flags)
        if (isOn(item.web.enabled)) {
            parts.push(webSection(item.web));
        }
    }

    // Serverless — can coexist with git
    if (!isTCP) {
        parts.push(serverlessSection(item.serverless));
    }

    // Upstreams
    parts.push(upstreamsSection(hostname, item, itemStats, routeIdx, type));

    // HTTP features (exhaustive)
    if (!isTCP) {
        parts.push(httpFeaturesSection(item));
        parts.push(authSection(item));
    }

    // TLS certs
    parts.push(certsSection(certificates, hostname));

    // Raw source
    parts.push(rawSection('📜 Source (read-only)', item));

    return parts.filter(Boolean).join('');
}

// ── Backend detail drawer ─────────────────────────────────────────────────────

function buildBackendHTML(cfg, bStat) {
    const p       = us => us ? (us / 1000).toFixed(1) + 'ms' : '—';
    const lat     = bStat.latency_us || {};
    const h       = bStat.health     || {};
    const hScore  = h.score || (bStat.alive ? 100 : 0);
    const state   = h.status || (bStat.alive ? 'Unverified' : 'Dead');
    const sColor  = hScore > 80 ? 'var(--success)' : hScore > 50 ? 'var(--warning)' : 'var(--danger)';
    const lastOk  = h.last_success ? new Date(h.last_success).toLocaleString() : 'Never';
    const lastFail= h.last_failure ? new Date(h.last_failure).toLocaleString() : 'None';

    const healthSec = section('🏥 Predictive Health', `
        <div class="health-gauge">
            <div class="gauge-circle" style="background:${sColor}">${hScore}</div>
            <div class="gauge-info">
                <div class="gauge-status">${state}</div>
                <div class="gauge-sub">Consecutive Fails: ${h.consecutive_failures || 0}</div>
            </div>
        </div>` +
        kvGrid([
            ['Last Success', lastOk],
            ['Last Failure', lastFail],
            ...(h.downtime ? [['Downtime', badge(h.downtime, 'error')]] : []),
        ])
    );

    const latCard = `
        <div class="handler-card" style="display:grid;grid-template-columns:repeat(4,1fr);text-align:center;padding:10px 15px;gap:5px;">
            ${['Avg','p50','p90','p99'].map((label, i) => {
        const val   = p([lat.avg_us, lat.p50, lat.p90, lat.p99][i]);
        const color = i < 2 ? 'var(--fg)' : i === 2 ? 'var(--warning)' : 'var(--danger)';
        return `<div>
                    <div style="font-size:9px;color:var(--text-mute);text-transform:uppercase;">${label}</div>
                    <div style="font-size:12px;font-family:monospace;margin-top:2px;color:${color};">${val}</div>
                </div>`;
    }).join('')}
        </div>`;

    const trafficSec = section('📊 Traffic & Latency',
        kvGrid([
            ['Total Requests', fmtNum(bStat.total_reqs || 0)],
            ['In-Flight',      badge(bStat.in_flight || 0, 'info')],
            ['Failures',       bStat.failures > 0 ? badge(fmtNum(bStat.failures), 'error') : '0'],
            ['Weight',         cfg.weight || 1],
        ]) + latCard
    );

    const critSec = (cfg.criteria?.source_ips?.length || cfg.criteria?.headers)
        ? section('🎯 Routing Criteria', kvGrid([
            ['Source IPs', cfg.criteria.source_ips?.join(', ') || 'Any'],
            ['Headers',    cfg.criteria.headers ? JSON.stringify(cfg.criteria.headers) : 'None'],
        ]))
        : '';

    return [healthSec, trafficSec, critSec, rawSection('📜 Backend Config', cfg, '150px')]
        .filter(Boolean).join('');
}