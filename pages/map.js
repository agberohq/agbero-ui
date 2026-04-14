/**
 * pages/map.js — Map / route graph page.
 */
import { listen, emit } from '../lib/oja.full.esm.js';

export default async function({ find, on, onUnmount, ready, inject }) {
    const { store, api } = inject('app');
    let graph = null, paused = true, pollTimer = null;

    async function loadGraphDeps() {
        if (window.RouteGraph) return;
        await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://d3js.org/d3.v7.min.js'; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
        await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'js/graph.js'; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
    }

    function hideLoading() { const el = find('#mapLoading'); if (el) el.style.display = 'none'; }
    function showEmpty() {
        hideLoading();
        const el = find('#graphContainer');
        if (el) el.innerHTML = `<div class="empty-state" style="margin-top:80px;"><span>🗺️ No routes configured</span><span>Add a host to see the route graph</span><button class="btn primary small" style="margin-top:12px;" id="mapAddHostBtn">+ Add Host</button></div>`;
        on('#mapAddHostBtn', 'click', () => emit('app:navigate', { path: '/add-host' }));
    }

    function buildNodeInfo(node) {
        const rows = [];
        const add  = (label, val) => { if (val !== undefined && val !== null && val !== '') rows.push(`<div style="margin-bottom:8px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-mute);margin-bottom:2px;">${label}</div><div style="font-family:var(--font-mono);font-size:11px;color:var(--fg);word-break:break-all;">${val}</div></div>`); };
        add('Type', node.type); add('ID', node.id); add('Status', node.alive === false ? '❌ Dead' : node.alive === true ? '✅ Alive' : '—'); add('Protocol', node.protocol); add('Path', node.path); add('Strategy', node.strategy);
        if (node.latency_us) { add('p50', node.latency_us.p50 ? (node.latency_us.p50/1000).toFixed(1)+'ms' : null); add('p99', node.latency_us.p99 ? (node.latency_us.p99/1000).toFixed(1)+'ms' : null); add('Reqs', node.latency_us.count); }
        if (node.health) { add('Health Score', node.health.score); add('Health Status', node.health.status); if (node.health.consecutive_failures > 0) add('Consec. Fails', node.health.consecutive_failures); }
        if (node.type === 'host') { const hStat = (store.get('hostsData')?.stats?.[node.id]) || {}; add('Total Reqs', hStat.total_reqs); rows.push(`<button class="btn small" data-action="perf-node" data-hostname="${node.id}" style="margin-top:8px;">📈 Perf History</button>`); }
        return rows.join('') || '<div style="color:var(--text-mute);">No data</div>';
    }

    async function refresh() {
        if (!graph) return;
        const config = store.get('lastConfig') || await api.fetchConfig();
        const uptime = await api.fetchUptime();
        if (!config || !uptime) return;
        if (Object.keys(config.hosts || {}).length === 0) { showEmpty(); return; }
        graph.render(config, uptime.hosts || {});
        hideLoading();
    }

    async function init() {
        try { await loadGraphDeps(); }
        catch (err) { hideLoading(); const el = find('#graphContainer'); if (el) el.innerHTML = `<div class="empty-state" style="margin-top:60px;">⚠️ Failed to load graph: ${err.message}</div>`; return; }
        graph = new RouteGraph('graphContainer');
        graph._onClick = function(d) {
            if (d.type === 'route'   && d.meta) emit('drawer:open-route',   { host: d.meta.hostname, idx: d.meta.routeIdx, type: d.meta.routeType });
            if (d.type === 'backend' && d.meta) emit('drawer:open-backend', { host: d.meta.hostname, routeIdx: d.meta.routeIdx, backendIdx: d.meta.backendIdx, type: d.meta.routeType });
            if (d.type === 'host'    && d.meta) emit('perf:open', { hostname: d.meta.hostname });
        };
        graph.onNodeClick = function(node) {
            const panel = find('#mapInfoPanel'), titleEl = find('#mapInfoTitle'), bodyEl = find('#mapInfoBody');
            if (!panel || !titleEl || !bodyEl) return;
            titleEl.textContent = node.label || node.id || 'Node';
            bodyEl.innerHTML    = buildNodeInfo(node);
            panel.style.display = 'block';
        };
        await refresh();
    }

    on('[data-action="perf-node"]', 'click', (e, btn) => { emit('perf:open', { hostname: btn.dataset.hostname }); });
    init();

    const unsub = listen('metrics:updated', ({ hosts }) => {
        if (paused || !graph) return;
        const config = store.get('lastConfig');
        if (config) { if (typeof graph.update === 'function') graph.update(config, hosts || {}); else graph.render(config, hosts || {}); }
    });

    on('#mapPauseBtn', 'click', (e, el) => { paused = !paused; if (el) el.textContent = paused ? 'Resume Updates' : 'Pause Updates'; if (!paused) refresh(); });
    on('#resetZoomBtn', 'click', () => graph?.resetZoom());
    on('#mapInfoClose', 'click', () => { const p = find('#mapInfoPanel'); if (p) p.style.display = 'none'; });

    pollTimer = setInterval(() => { if (!paused) refresh(); }, 30_000);
    onUnmount(() => { unsub?.(); if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } });
    ready();
}
