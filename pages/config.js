/**
 * pages/config.js — Config page.
 * Phase 5: API server, security/firewall details, rate limit rules,
 *          gossip/cluster, logging backends.
 * Phase 6: collapse/accordion via <details>, collapse from oja not needed
 *          since native <details> provides the pattern cleanly.
 */
export default async function({ find, on, onUnmount, ready, inject }) {
    const { store, api, hcl: hclMod, utils, oja } = inject('app');
    const { highlightHCL, formatHCL, HCL_CSS } = hclMod;
    const { formatBytes, fmtNum, isOn } = utils;
    const { ui, clipboard, notify, pagination, tabs } = oja;

    if (!document.getElementById('hcl-theme')) {
        const s = document.createElement('style');
        s.id = 'hcl-theme';
        s.textContent = HCL_CSS;
        document.head.appendChild(s);
    }

    let _prevConfig = null, _currConfig = null, _allHosts = {},
        _rawFormat = 'json', _rawExpanded = false, _globalObj = null;

    const _hostsPg = pagination({ pageSize: 10, onPageChange: () => renderHostsSummary(_allHosts) });
    _hostsPg.mount(find('#configHostsPager'));

    const set = (id, v) => { const e = find('#' + id); if (e) e.innerText = v ?? '—'; };

    // Helpers

    function formatUptime(val) {
        if (!val) return '—';
        if (typeof val === 'string') return val;
        const seconds = parseInt(val, 10);
        if (isNaN(seconds)) return String(val);
        const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
        return [d > 0 && `${d}d`, h > 0 && `${h}h`, m > 0 && `${m}m`].filter(Boolean).join(' ') || '<1m';
    }

    function countBackends(host) {
        let n = 0;
        (host.routes  || []).forEach(r => n += r.backends?.servers?.length || 0);
        (host.proxies || []).forEach(p => n += p.backends?.length || 0);
        return n;
    }

    function getRouteCount(hosts) {
        let n = 0;
        Object.values(hosts || {}).forEach(h => { n += (h.routes?.length || 0) + (h.proxies?.length || 0); });
        return n;
    }

    function getTLSCount(hosts) {
        let n = 0;
        Object.values(hosts || {}).forEach(h => { if (h.tls?.mode && h.tls.mode !== 'none') n++; });
        return n;
    }

    function detailItem(label, value) {
        return `<div class="config-detail-item"><div class="config-detail-label">${label}</div><div class="config-detail-value">${value}</div></div>`;
    }

    function badge(text, cls = '') {
        return `<span class="badge ${cls}">${text}</span>`;
    }

    // Render functions

    function renderConfigMetrics(config, uptime) {
        const g = config.global || {}, sys = uptime?.system || {}, hosts = config.hosts || {};
        set('configHttpPort',  g.bind?.http?.[0]?.replace(':', '')  || '80');
        set('configHttpsPort', g.bind?.https?.[0]?.replace(':', '') || '443');
        set('configVersion',   'v' + (g.version || '?'));
        set('configBuild',     g.build || 'dev');
        set('configLogLevel',  (g.logging?.level || 'info').toUpperCase());
        set('configHostCount', fmtNum(Object.keys(hosts).length));
        set('configRouteCount',fmtNum(getRouteCount(hosts)));
        set('configTlsCount',  fmtNum(getTLSCount(hosts)));
        set('configNodeId',    sys.node_id || g.node_id || 'standalone');
        set('configHostname',  sys.hostname || window.location.hostname);
        set('configPid',       sys.pid || '—');
        set('configStartTime', sys.start_time ? new Date(sys.start_time).toLocaleString() : '—');
        const titleEl = find('#configPageTitle');
        if (titleEl) titleEl.innerHTML = `Configuration Overview <span style="font-size:14px;color:var(--text-mute);margin-left:10px;">v${g.version || '?'} (${g.build || 'dev'})</span>`;
    }

    function renderGlobalSettings(g) {
        const el = find('#configGlobalDetails');
        if (!el || !g) return;
        const trusted = g.security?.trusted_proxies || [];
        el.innerHTML = [
            ['Environment',    g.development ? badge('development', 'warning') : badge('production', 'success')],
            ['Admin Email',    g.lets_encrypt?.email || '—'],
            ['Max Header',     g.general?.max_header_bytes ? formatBytes(g.general.max_header_bytes) : '—'],
            ['Trusted Proxies',trusted.length > 0 ? trusted.length + ' configured' : 'none'],
            ['Read Timeout',   g.timeouts?.read   || '—'],
            ['Write Timeout',  g.timeouts?.write  || '—'],
            ['Idle Timeout',   g.timeouts?.idle   || '—'],
            ['Redirect',       g.bind?.redirect === 'on' ? badge('HTTP → HTTPS', 'info') : '—'],
        ].map(([l, v]) => detailItem(l, v)).join('');
    }

    // Phase 5 #32 — API server
    function renderApiSection(g) {
        const api  = g?.api;
        const sect = find('#configApiSection');
        if (!sect) return;
        if (!api || !isOn(api.enabled) || !api.address) {
            sect.style.display = 'none';
            return;
        }
        sect.style.display = '';
        const el = find('#configApiDetails');
        if (!el) return;
        el.innerHTML = [
            ['Address',     `<code class="mono">${api.address}</code>`],
            ['Allowed IPs', (api.allowed_ips || []).length ? api.allowed_ips.map(ip => `<code>${ip}</code>`).join(' ') : badge('any', 'warning')],
        ].map(([l, v]) => detailItem(l, v)).join('');
    }

    // Phase 5 #33 — Security & Firewall
    function renderSecuritySection(g) {
        const sec = g?.security;
        const fw  = sec?.firewall;
        const el  = find('#configSecurityDetails');
        const actEl = find('#configFirewallActions');
        if (!el) return;

        const items = [];
        if (sec) {
            items.push(['Security',        isOn(sec.enabled) ? badge('Enabled', 'success') : badge('Disabled', '')]);
            if (sec.trusted_proxies?.length) {
                items.push(['Trusted Proxies', sec.trusted_proxies.map(ip => `<code>${ip}</code>`).join(' ')]);
            }
        }
        if (fw) {
            items.push(['Firewall',        isOn(fw.enabled) ? badge('Enabled', 'success') : badge('Disabled', '')]);
            if (isOn(fw.enabled)) {
                items.push(['Mode',        fw.mode ? badge(fw.mode, fw.mode === 'active' ? 'success' : 'warning') : '—']);
                items.push(['Inspect Body',fw.inspect_body ? badge('Yes', 'warning') : 'No']);
                if (fw.max_inspect_bytes)
                    items.push(['Max Inspect', formatBytes(fw.max_inspect_bytes)]);
                if (fw.inspect_content_types?.length)
                    items.push(['Content Types', fw.inspect_content_types.map(t => `<code style="font-size:10px;">${t}</code>`).join(' ')]);
                if (fw.defaults) {
                    items.push(['Default Dynamic', fw.defaults.dynamic?.action ? badge(fw.defaults.dynamic.action, '') : '—']);
                    items.push(['Default Static',  fw.defaults.static?.action  ? badge(fw.defaults.static.action,  '') : '—']);
                }
            }
        }
        const keeper = sec?.keeper;
        if (keeper) {
            items.push(['Secret Store', isOn(keeper.enabled) ? badge('Enabled', 'success') : badge('Disabled', '')]);
            if (keeper.auto_lock && keeper.auto_lock !== '0s')
                items.push(['Auto-lock', keeper.auto_lock]);
            if (isOn(keeper.audit)) items.push(['Audit', badge('On', 'info')]);
        }
        el.innerHTML = items.map(([l, v]) => detailItem(l, v)).join('') || detailItem('Status', 'Not configured');

        // Named firewall actions
        if (actEl && fw?.actions?.length) {
            actEl.innerHTML = `<div style="font-size:11px;font-weight:500;color:var(--text-mute);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Named Actions</div>` +
                `<div class="config-details-grid">` +
                fw.actions.map(a => detailItem(
                    `<code>${a.name}</code>`,
                    [
                        badge(a.mitigation || 'add', ''),
                        a.response?.status_code ? `HTTP ${a.response.status_code}` : '',
                        a.response?.body_template ? `<code style="font-size:10px;">${a.response.body_template.slice(0,40)}</code>` : '',
                    ].filter(Boolean).join(' ')
                )).join('') +
                `</div>`;
        } else if (actEl) {
            actEl.innerHTML = '';
        }
    }

    // Phase 5 #34 — Rate limit rules table
    function renderRateLimitSection(g) {
        const el  = find('#configRateLimitDetails');
        const rl  = g?.rateLimits;
        if (!el) return;
        if (!rl || !isOn(rl.enabled)) {
            el.innerHTML = `<div style="color:var(--text-mute);font-size:12px;padding:4px 0;">Rate limiting disabled.</div>`;
            return;
        }
        const summary = [
            detailItem('Status',      badge('Enabled', 'success')),
            detailItem('TTL',         rl.ttl || '—'),
            detailItem('Max Entries', fmtNum(rl.max_entries || 0)),
        ].join('');

        const rules = rl.rules || [];
        const rulesHtml = rules.length
            ? `<div style="margin-top:12px;">
                <div style="font-size:11px;font-weight:500;color:var(--text-mute);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Rules (${rules.length})</div>
                <div class="table-responsive">
                <table class="config-hosts-table">
                    <thead><tr><th>Name</th><th>Prefixes</th><th>Methods</th><th>Limit</th><th>Window</th><th>Burst</th><th>Key</th></tr></thead>
                    <tbody>
                        ${rules.map(r => `<tr>
                            <td class="mono" style="font-size:11px;">${r.name || '—'}</td>
                            <td style="font-size:11px;">${(r.prefixes || []).map(p => `<code>${p}</code>`).join(' ') || '*'}</td>
                            <td style="font-size:11px;">${(r.methods  || []).join(', ') || 'ALL'}</td>
                            <td class="mono">${fmtNum(r.requests || 0)}</td>
                            <td class="mono">${r.window || '—'}</td>
                            <td class="mono">${fmtNum(r.burst || 0)}</td>
                            <td>${r.key ? badge(r.key, '') : '—'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                </div>
               </div>`
            : `<div style="color:var(--text-mute);font-size:12px;margin-top:8px;">No rules defined — global rate limiting enabled but no rules configured.</div>`;

        el.innerHTML = `<div class="config-details-grid">${summary}</div>${rulesHtml}`;
    }

    // Phase 5 #35 — Gossip / Cluster
    function renderGossipSection(g) {
        const el     = find('#configGossipDetails');
        const gossip = g?.gossip;
        if (!el) return;
        if (!gossip || !isOn(gossip.enabled)) {
            el.innerHTML = detailItem('Status', badge('Disabled', ''));
            return;
        }
        el.innerHTML = [
            ['Status',       badge('Enabled', 'success')],
            ['Port',         gossip.port || '7946'],
            ['Seeds',        (gossip.seeds || []).length
                ? gossip.seeds.map(s => `<code>${s}</code>`).join(' ')
                : badge('none', 'warning')],
            ['TTL',          gossip.ttl ? gossip.ttl + 's' : '—'],
            ['Shared State', gossip.shared_state?.driver ? badge(gossip.shared_state.driver, 'info') : 'memory'],
        ].map(([l, v]) => detailItem(l, v)).join('');
    }

    // Phase 5 #36 — Logging
    function renderLoggingSection(g) {
        const el  = find('#configLoggingDetails');
        const log = g?.logging;
        if (!el || !log) return;
        const items = [
            ['Enabled',      isOn(log.enabled) ? badge('Yes', 'success') : badge('No', '')],
            ['Level',        log.level ? badge(log.level, log.level === 'error' ? 'error' : log.level === 'warn' ? 'warning' : 'info') : '—'],
            ['Dedup',        isOn(log.deduplicate) ? badge('On', 'info') : 'Off'],
            ['Bot Checker',  isOn(log.bot_checker) ? badge('On', 'info') : 'Off'],
            ['Truncate',     isOn(log.truncate) ? badge('On', '') : 'Off'],
        ];
        if (isOn(log.file?.enabled)) {
            items.push(['File Path',  `<code style="font-size:10px;word-break:break-all;">${log.file.path || '—'}</code>`]);
            items.push(['Rotate Size',log.file.rotate_size ? formatBytes(log.file.rotate_size) : '—']);
            items.push(['Batch Size', fmtNum(log.file.batch_size || 0)]);
        }
        if (isOn(log.victoria?.enabled)) {
            items.push(['Victoria URL',   `<code style="font-size:10px;">${log.victoria.URL || '—'}</code>`]);
            items.push(['Victoria Batch', fmtNum(log.victoria.batch_size || 0)]);
        }
        if (isOn(log.prometheus?.enabled)) {
            items.push(['Prometheus', badge('Enabled', 'success')]);
            items.push(['Metrics Path', `<code>${log.prometheus.path || '/metrics'}</code>`]);
        }
        if (log.skip?.length) {
            items.push(['Skip Paths', log.skip.map(p => `<code style="font-size:10px;">${p}</code>`).join(' ')]);
        }
        el.innerHTML = items.map(([l, v]) => detailItem(l, v)).join('');
    }

    function renderTlsSummary(certificates, config) {
        const el = find('#configTlsSummary');
        if (!el) return;
        const total    = certificates.length;
        const valid    = certificates.filter(c => c.days_left > 0).length;
        const expiring = certificates.filter(c => c.days_left > 0 && c.days_left < 7).length;
        const expired  = certificates.filter(c => c.days_left !== null && c.days_left <= 0).length;
        el.innerHTML = [
            ['Total',        total],
            ['Valid',        badge(valid, 'success')],
            ['Expiring Soon',badge(expiring, expiring > 0 ? 'warning' : '')],
            ['Expired',      badge(expired,  expired  > 0 ? 'error'   : '')],
        ].map(([l, v]) => detailItem(l, v)).join('');
        const noteEl = find('#configTlsNote');
        if (noteEl && config.global?.lets_encrypt) {
            const le = config.global.lets_encrypt;
            noteEl.innerHTML = `<span class="config-note-text">🔒 Auto-TLS: ${le.email || 'No email'} | Staging: ${isOn(le.staging) ? badge('On', 'warning') : 'Off'}</span>`;
        }
    }

    function renderRuntimeSettings(uptime) {
        const el = find('#configRuntimeDetails');
        if (!el || !uptime?.system) return;
        const sys = uptime.system;
        el.innerHTML = [
            ['PID',         sys.pid         || '—'],
            ['Uptime',      formatUptime(sys.uptime)],
            ['Start Time',  sys.start_time  ? new Date(sys.start_time).toLocaleString() : '—'],
            ['Goroutines',  fmtNum(sys.num_goroutine || 0)],
            ['CPU Cores',   sys.num_cpu     || '—'],
            ['Go Heap',     formatBytes(sys.mem_rss   || 0)],
            ['Alloc',       formatBytes(sys.mem_alloc || 0)],
            ['OS Mem Used', formatBytes(sys.mem_used  || 0)],
            ['OS Mem Total',formatBytes(sys.mem_total_os || 0)],
        ].map(([l, v]) => detailItem(l, v)).join('');
    }

    function renderFeatureFlags(config) {
        const el = find('#configFeatures');
        if (!el) return;
        const features = [];
        const g = config.global || {};
        if (g.development)                               features.push({ name: 'Dev Mode',          icon: '🔧' });
        if (isOn(g.lets_encrypt?.enabled))               features.push({ name: 'Auto TLS',           icon: '🔐' });
        if (isOn(g.gossip?.enabled))                     features.push({ name: 'Clustering',         icon: '🌐' });
        if (g.security?.trusted_proxies?.length)         features.push({ name: 'Trusted Proxies',    icon: '🛡️' });
        if (isOn(g.security?.firewall?.enabled))         features.push({ name: 'WAF',                icon: '🔥' });
        if (isOn(g.rateLimits?.enabled))                 features.push({ name: 'Rate Limiting',      icon: '🚦' });
        if (isOn(g.logging?.victoria?.enabled))          features.push({ name: 'Victoria Metrics',   icon: '📈' });
        if (isOn(g.logging?.prometheus?.enabled))        features.push({ name: 'Prometheus',          icon: '📊' });
        if (isOn(g.api?.enabled))                        features.push({ name: 'API Server',         icon: '🔌' });
        if (g.bind?.redirect === 'on')                   features.push({ name: 'HTTP→HTTPS Redirect', icon: '↩️' });
        let hasWasm = false, hasAuth = false, hasComp = false, hasWorker = false, hasReplay = false;
        Object.values(config.hosts || {}).forEach(host => {
            (host.routes || []).forEach(r => {
                if (isOn(r.wasm?.enabled))       hasWasm   = true;
                if (isOn(r.basic_auth?.enabled) || isOn(r.jwt_auth?.enabled)) hasAuth = true;
                if (isOn(r.compression?.enabled))hasComp   = true;
                if ((r.serverless?.workers || []).length) hasWorker = true;
                if ((r.serverless?.replay  || []).length) hasReplay = true;
            });
        });
        if (hasWasm)   features.push({ name: 'WASM Filters',   icon: '⚡' });
        if (hasAuth)   features.push({ name: 'Route Auth',     icon: '🔑' });
        if (hasComp)   features.push({ name: 'Compression',    icon: '🗜️' });
        if (hasWorker) features.push({ name: 'Workers',        icon: '⚙️' });
        if (hasReplay) features.push({ name: 'Replay Proxies', icon: '🔌' });
        if (!features.length) { el.innerHTML = '<div class="empty-state">No special features enabled</div>'; return; }
        el.innerHTML = features.map(f =>
            `<div class="feature-item">
                <span class="feature-icon">${f.icon}</span>
                <span class="feature-name">${f.name}</span>
                <span class="feature-status success">✓</span>
            </div>`
        ).join('');
    }

    function renderHostsSummary(hosts) {
        _allHosts = hosts || {};
        const tbody = find('#configHostsBody');
        if (!tbody) return;
        const entries = Object.entries(_allHosts);
        if (!entries.length) {
            tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No hosts configured</div></td></tr>';
            _hostsPg.updateTotal(0);
            return;
        }
        _hostsPg.updateTotal(entries.length);
        const page = _hostsPg.slice(entries);
        tbody.innerHTML = page.map(([hostname, host]) => {
            const routeCount   = (host.routes?.length || 0) + (host.proxies?.length || 0);
            const backendCount = countBackends(host);
            const tlsMode      = host.tls?.mode || 'none';
            const tlsCls       = tlsMode === 'none' ? 'error' : tlsMode.includes('local') ? 'warning' : 'success';
            const tlsTxt       = tlsMode === 'none' ? 'No TLS' : tlsMode.includes('local') ? 'Local' : 'Auto';
            const domains      = (host.domains || []).slice(0, 2).join(', ') + (host.domains?.length > 2 ? '…' : '');
            const maxBody      = host.limits?.max_body_size ? formatBytes(host.limits.max_body_size) : '';
            return `<tr>
                <td class="mono">${hostname}${maxBody ? `<span style="font-size:10px;color:var(--text-mute);margin-left:6px;">max ${maxBody}</span>` : ''}</td>
                <td>${routeCount}</td>
                <td>${backendCount}</td>
                <td><span class="badge ${tlsCls}">${tlsTxt}</span></td>
                <td style="font-size:11px;">${domains}</td>
            </tr>`;
        }).join('');
    }

    function renderGitSection(gitStats) {
        const section = find('#configGitSection');
        const details = find('#configGitDetails');
        if (!section || !details) return;
        const entries = Object.entries(gitStats || {});
        if (!entries.length) { section.style.display = 'none'; return; }
        section.style.display = '';
        details.innerHTML = entries.map(([id, gs]) => {
            const cls    = gs.state === 'healthy' ? 'success' : gs.state === 'unavailable' ? 'warning' : 'error';
            const commit = gs.commit ? gs.commit.substring(0, 8) : '—';
            return detailItem(id, `<span class="badge ${cls}">${gs.state || 'unknown'}</span><span class="mono" style="font-size:10px;margin-left:4px;">${commit}</span><span style="color:var(--text-mute);font-size:10px;"> · ${gs.deployments || 0} deploys</span>`);
        }).join('');
    }

    function _jsonToHCLHint(obj, indent = 0) {
        if (!obj || typeof obj !== 'object') return String(obj ?? '');
        const pad = '  '.repeat(indent), lines = [];
        for (const [k, v] of Object.entries(obj)) {
            if (v === null || v === undefined) continue;
            const key = k.replace(/-/g, '_');
            if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
                lines.push(`${pad}${key} {`);
                lines.push(_jsonToHCLHint(v, indent + 1));
                lines.push(`${pad}}`);
            } else if (Array.isArray(v)) {
                const vals = v.map(x => typeof x === 'string' ? `"${x}"` : String(x));
                lines.push(`${pad}${key} = [${vals.join(', ')}]`);
            } else if (typeof v === 'string') {
                lines.push(`${pad}${key} = "${v}"`);
            } else {
                lines.push(`${pad}${key} = ${v}`);
            }
        }
        return lines.join('\n');
    }

    function _refreshRaw() {
        const el = find('#configContent');
        if (!el || !_globalObj) return;
        if (_rawFormat === 'hcl') {
            el.innerHTML = highlightHCL(_jsonToHCLHint(_globalObj));
        } else {
            const json = JSON.stringify(_globalObj, null, 2);
            el.innerHTML = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    }

    function renderRawConfig(config) {
        _globalObj = config?.global || config;
        _refreshRaw();
    }

    function renderAll(config, uptime) {
        if (!config || config.__offline) return;
        _prevConfig  = _currConfig;
        _currConfig  = config;
        const g      = config.global || {};
        renderConfigMetrics(config, uptime);
        renderGlobalSettings(g);
        renderApiSection(g);
        renderSecuritySection(g);
        renderRateLimitSection(g);
        renderGossipSection(g);
        renderLoggingSection(g);
        renderTlsSummary(store.get('certificates') || [], config);
        renderRuntimeSettings(uptime);
        renderFeatureFlags(config);
        renderHostsSummary(config.hosts);
        renderGitSection(uptime?.git || store.get('gitStats') || {});
        renderRawConfig(config);
    }

    // Data loading

    async function refresh() {
        const btn = find('#configRefreshBtn');
        ui.btn.loading(btn, '⟳ Loading…');
        const [config, uptime] = await Promise.all([api.fetchConfig(), api.fetchUptime()]);
        ui.btn.reset(btn);
        if (config && !config.__offline && !config.__unauthorized) {
            store.set('lastConfig', config);
            store.set('lastUptime', uptime);
            if (uptime?.git) store.set('gitStats', uptime.git);
        }
        renderAll(config, uptime);
    }

    const cachedConfig = store.get('lastConfig');
    const cachedUptime = store.get('lastUptime');
    if (cachedConfig) renderAll(cachedConfig, cachedUptime);
    else refresh();

    // Event wiring

    on('#configRefreshBtn', 'click', refresh);

    tabs.render(find('#configFormatTabs'), [{ key: 'json', label: 'JSON' }, { key: 'hcl', label: 'HCL' }], {
        active: 'json', variant: 'pill',
        onChange: (key) => { _rawFormat = key; _refreshRaw(); },
    });

    on('#configCopyBtn', 'click', () => {
        const text = find('#configContent')?.innerText || '';
        clipboard.write(text).then(() => notify.show('Copied', 'success')).catch(() => notify.show('Copy failed', 'error'));
    });

    on('#configExpandBtn', 'click', (e, btn) => {
        const box = find('#configContent');
        if (!box) return;
        _rawExpanded = !_rawExpanded;
        box.style.maxHeight = _rawExpanded ? 'none' : '360px';
        if (btn) btn.textContent = _rawExpanded ? '↕️ Collapse' : '↕️ Expand';
    });

    on('#configDiffBtn', 'click', () => {
        const section = find('#configDiffSection');
        const diffEl  = find('#configDiff');
        if (!section || !diffEl) return;
        if (section.open) { section.open = false; return; }
        if (!_prevConfig || !_currConfig) {
            diffEl.textContent = 'Refresh once more to compare with previous version.';
        } else {
            const oldStr = JSON.stringify(_prevConfig, null, 2).split('\n');
            const newStr = JSON.stringify(_currConfig, null, 2).split('\n');
            if (oldStr.join('') === newStr.join('')) {
                diffEl.textContent = 'No changes detected.';
            } else {
                let out = '';
                for (let i = 0; i < Math.max(oldStr.length, newStr.length); i++) {
                    if (oldStr[i] !== newStr[i]) {
                        if (oldStr[i]) out += `- ${oldStr[i]}\n`;
                        if (newStr[i]) out += `+ ${newStr[i]}\n`;
                    } else {
                        out += `  ${oldStr[i]}\n`;
                    }
                }
                diffEl.textContent = out;
            }
        }
        section.open = true;
    });

    ready();
}
