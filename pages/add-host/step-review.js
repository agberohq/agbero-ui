/**
 * pages/add-host/step-review.js — Review & submit step.
 */
import { emit, notify } from '../../lib/oja.full.esm.js';

export default async function({ find, on, onUnmount, ready, props, inject }) {
    const { api, hcl: hclMod, hostBuilder } = inject('app');
    const { formatHCL } = hclMod;
    const { wizard } = props;

    const hintEl = find('#wzReviewHint');
    const modeEl = find('#wzReviewMode');
    const ta     = find('#wzReviewJson');

    if (hintEl) hintEl.textContent = 'Review your configuration before creating. You can edit the JSON directly if needed.';

    try {
        const draft  = wizard.draftGet();
        const routes = wizard.getRoutes();
        const config = hostBuilder.buildHostConfig({ ...draft, routes });
        if (ta)     ta.value = JSON.stringify(config, null, 2);
        if (modeEl) modeEl.textContent = 'JSON';
    } catch (err) {
        if (ta) ta.value = JSON.stringify({ error: 'Could not build config: ' + err.message }, null, 2);
    }

    on('#wzFormatJsonBtn', 'click', () => {
        if (!ta) return;
        try { ta.value = JSON.stringify(JSON.parse(ta.value || '{}'), null, 2); }
        catch (e) { notify.show('Invalid JSON: ' + e.message, 'error'); }
    });

    on('#wzSubmitBtn', 'click', async (e, btn) => {
        const errBox = find('#submitErrorBox');
        if (errBox) { errBox.classList.remove('visible'); errBox.textContent = ''; }
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
            const raw    = (ta?.value || '').trim();
            const config = JSON.parse(raw || '{}');
            const first  = Array.isArray(config.domains) ? config.domains[0] : (config.domain || '');
            const domain = (wizard.draftGet('domain') || first || '').trim().toLowerCase();
            if (!domain) throw new Error('Domain is required');
            const result = await api.addHost(domain, config);
            if (result?.error) throw new Error(result.error);
            notify.show(domain + ' created successfully', 'success');
            emit('wizard:submit-success', { domain });
        } catch (err) {
            btn.disabled = false; btn.textContent = 'Create Host';
            emit('wizard:submit-error', {});
            if (errBox) { errBox.textContent = err.message || 'Failed to create host — check your configuration'; errBox.classList.add('visible'); }
        }
    });

    onUnmount(() => {});
    ready();
}