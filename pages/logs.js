/**
 * pages/logs.js — Logs page.
 */
export default async function({ find, findAll, on, onUnmount, ready, inject }) {
    const { store, api, oja } = inject('app');
    const { ui } = oja;

    const ICON_PAUSE  = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    const ICON_RESUME = `<polygon points="5 3 19 12 5 21 5 3"/>`;

    let paused = false, filter = store.get('logFilter') || 'ALL', logs = [], pollTimer = null, isAllExpanded = false;
    let searchTerm = '';

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
        if (!logs.length) {
            el.innerHTML = `<div style="color:var(--text-mute);text-align:center;padding:40px;"><span style="display:block;font-size:24px;margin-bottom:10px;">📭</span>No logs yet. Waiting for traffic...</div>`;
            return;
        }
        // Apply level filter then search filter
        const term = searchTerm.toLowerCase();
        const filtered = logs.filter(l => {
            const { lvl, full } = parseEntry(l);
            if (filter !== 'ALL' && lvl !== filter) return false;
            if (term && !full.toLowerCase().includes(term) && !JSON.stringify(l).toLowerCase().includes(term)) return false;
            return true;
        });
        if (!filtered.length) {
            el.innerHTML = `<div style="color:var(--text-mute);text-align:center;padding:20px;">No ${searchTerm ? `results for "${searchTerm}"` : filter + ' logs'}</div>`;
            return;
        }
        el.innerHTML = filtered.map(l => {
            const { lvl, ts, full, fields } = parseEntry(l);
            const color   = lvl === 'ERROR' ? 'var(--danger)' : lvl === 'WARN' ? 'var(--warning)' : 'var(--text-mute)';
            const hasJson = Object.keys(fields).length > 0;
            // Highlight search term
            const highlightedFull = term
                ? full.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                    m => `<mark style="background:var(--warning);color:#000;border-radius:2px;padding:0 1px;">${m}</mark>`)
                : full;
            const jsonToggle = hasJson ? `<details class="log-details"${isAllExpanded ? ' open' : ''}><summary class="log-json-toggle">{…}</summary><div class="log-json-body"><pre>${JSON.stringify(fields, null, 2)}</pre></div></details>` : '';
            return `<div class="log-entry"><span class="log-ts">${ts}</span><span class="log-lvl" style="color:${color};">${lvl}</span><span class="log-msg">${highlightedFull} ${jsonToggle}</span></div>`;
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

    // Show skeleton on first paint before fetch completes
    const logsList = find('#logsList');
    if (logsList && !logs.length) {
        logsList.innerHTML = `<div class="loading-rows" style="padding:8px 0;">
            <div class="loading-row"></div><div class="loading-row"></div>
            <div class="loading-row"></div><div class="loading-row"></div>
        </div>`;
    }

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
    // Phase 7 #50 — search
    on('#logsSearch', 'input', (e, inp) => {
        searchTerm = inp.value.trim();
        const clearBtn = find('#logsSearchClear');
        if (clearBtn) clearBtn.style.display = searchTerm ? '' : 'none';
        renderLogs();
    });
    on('#logsSearchClear', 'click', () => {
        const inp = find('#logsSearch');
        if (inp) { inp.value = ''; inp.focus(); }
        searchTerm = '';
        const clearBtn = find('#logsSearchClear');
        if (clearBtn) clearBtn.style.display = 'none';
        renderLogs();
    });
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
