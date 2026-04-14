/**
 * pages/logs.js — Logs page.
 */
import { ui } from '../lib/oja.full.esm.js';

export default async function({ find, findAll, on, onUnmount, ready, inject }) {
    const { store, api } = inject('app');

    const ICON_PAUSE  = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    const ICON_RESUME = `<polygon points="5 3 19 12 5 21 5 3"/>`;

    let paused = false, filter = store.get('logFilter') || 'ALL', logs = [], pollTimer = null, isAllExpanded = false;

    function parseEntry(l) {
        let lvl = 'INFO', msg = '', ts = '', fields = {};
        if (typeof l === 'string') {
            try { const p = JSON.parse(l); lvl = p.lvl||p.level||'INFO'; msg = p.msg||p.message||l; ts = p.ts||p.time||''; fields = p.fields ? {...p.fields} : {}; } catch { msg = l; }
        } else if (l && typeof l === 'object') {
            lvl = l.lvl||l.level||'INFO'; msg = l.msg||l.message||''; ts = l.ts||l.time||''; fields = l.fields ? {...l.fields} : {};
        }
        if (ts?.includes('T')) ts = ts.split('T')[1]?.split('.')[0] || ts;
        let full = msg;
        if (fields.method && fields.path) { full += ` ${fields.method} ${fields.path}`; delete fields.method; delete fields.path; }
        if (fields.status)   { full += ` [${fields.status}]`; delete fields.status; }
        if (fields.duration) { full += ` (${(fields.duration / 1e6).toFixed(2)}ms)`; delete fields.duration; }
        return { lvl, ts, full, fields };
    }

    function renderLogs() {
        const el = find('#logsList');
        if (!el) return;
        if (!logs.length) { el.innerHTML = `<div style="color:var(--text-mute);text-align:center;padding:40px;"><span style="display:block;font-size:24px;margin-bottom:10px;">📭</span>No logs yet. Waiting for traffic...</div>`; return; }
        const filtered = logs.filter(l => filter === 'ALL' || parseEntry(l).lvl === filter);
        if (!filtered.length) { el.innerHTML = `<div style="color:var(--text-mute);text-align:center;padding:20px;">No ${filter} logs</div>`; return; }
        el.innerHTML = filtered.map(l => {
            const { lvl, ts, full, fields } = parseEntry(l);
            const color   = lvl === 'ERROR' ? 'var(--danger)' : lvl === 'WARN' ? 'var(--warning)' : 'var(--text-mute)';
            const hasJson = Object.keys(fields).length > 0;
            const jsonToggle = hasJson ? `<details class="log-details"${isAllExpanded ? ' open' : ''}><summary class="log-json-toggle">{…}</summary><div class="log-json-body"><pre>${JSON.stringify(fields, null, 2)}</pre></div></details>` : '';
            return `<div class="log-entry"><span class="log-ts">${ts}</span><span class="log-lvl" style="color:${color};">${lvl}</span><span class="log-msg">${full} ${jsonToggle}</span></div>`;
        }).join('');
    }

    async function fetchAndRender() {
        if (paused) return;
        const lines = find('#logsTailSelect')?.value || '100';
        const data  = await api.fetchLogs(lines);
        if (data && Array.isArray(data)) { logs = [...data].reverse(); renderLogs(); }
    }

    async function exportLogs() {
        const btn   = find('#logsExportBtn');
        const lines = find('#logsTailSelect')?.value || '100';
        ui.btn.loading(btn);
        const data = await api.fetchLogs(lines);
        if (!data || !Array.isArray(data)) { ui.btn.reset(btn); return; }
        const out  = data.map(l => { if (typeof l === 'string') { try { return JSON.parse(l); } catch { return { raw: l }; } } return l; });
        const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
        const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `agbero-logs-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json` });
        a.click(); URL.revokeObjectURL(a.href);
        ui.btn.done(btn, '✓');
    }

    findAll('.chip').forEach(c => c.classList.remove('active'));
    const activeChip = find(`.chip[data-level="${filter}"]`);
    if (activeChip) activeChip.classList.add('active');
    fetchAndRender();
    pollTimer = setInterval(fetchAndRender, 2000);

    on('#logsPauseBtn', 'click', (e, btn) => {
        paused = !paused;
        if (btn) btn.title = paused ? 'Resume live updates' : 'Pause live updates';
        const svg = find('#logsPauseIcon');
        if (svg) svg.innerHTML = paused ? ICON_RESUME : ICON_PAUSE;
    });
    on('#logsExpandAllBtn',   'click', () => { isAllExpanded = true;  findAll('.log-details').forEach(el => el.open = true);  });
    on('#logsCollapseAllBtn', 'click', () => { isAllExpanded = false; findAll('.log-details').forEach(el => el.open = false); });
    on('#logsExportBtn',  'click', exportLogs);
    on('#logsClearBtn',   'click', () => { logs = []; renderLogs(); });
    on('#logsTailSelect', 'change', fetchAndRender);
    on('.chip', 'click', (e, chip) => {
        findAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        filter = chip.dataset.level;
        store.set('logFilter', filter);
        renderLogs();
    });

    onUnmount(() => { if (pollTimer) clearInterval(pollTimer); paused = false; logs = []; });
    ready();
}
