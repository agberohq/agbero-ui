/**
 * pages/add-host/step-review.js — Review & submit step.
 */
import { emit, notify } from '../../lib/oja.full.esm.js';

export default async function({ find, on, onUnmount, ready, props, inject }) {
    const { api, hcl: hclMod, hostBuilder } = inject('app');
    const { formatHCL } = hclMod;
    const { wizard } = props;

    const isAdvanced = wizard.draftGet('host_type') === 'advanced';
    const hintEl=find('#wzReviewHint'), modeEl=find('#wzReviewMode'), ta=find('#wzReviewJson');

    if(hintEl) hintEl.textContent = isAdvanced ? 'Write the complete host config as HCL or JSON. HCL supports comments and is the native format.' : 'Review your configuration before creating. You can edit the JSON directly if needed.';

    if(!isAdvanced){
        try {
            const draft=wizard.draftGet(), routes=wizard.getRoutes();
            const config = hostBuilder.buildHostConfig({ ...draft, routes });
            if(ta)ta.value=JSON.stringify(config,null,2);
            if(modeEl)modeEl.textContent='JSON';
        } catch(err){ if(ta)ta.value=JSON.stringify({error:'Could not build config: '+err.message},null,2); }
    } else {
        if(ta)ta.value=wizard.draftGet('raw_json')||'';
        if(modeEl)modeEl.textContent='HCL or JSON';
        ta?.addEventListener('input', e=>wizard.draftSet('raw_json', e.target.value));
    }

    function _isHCL(text){const t=text.trimStart();return !t.startsWith('{')&&!t.startsWith('[');}

    on('#wzFormatJsonBtn', 'click', () => {
        if(!ta)return;
        const raw=(ta.value||'').trim();
        if(_isHCL(raw)){try{ta.value=formatHCL(raw);}catch(e){notify.show('HCL format error: '+e.message,'error');}}
        else{try{ta.value=JSON.stringify(JSON.parse(raw),null,2);}catch(e){notify.show('Invalid JSON: '+e.message,'error');}}
    });

    on('#wzSubmitBtn', 'click', async (e, btn) => {
        const errBox=find('#submitErrorBox');
        if(errBox){errBox.classList.remove('visible');errBox.textContent='';}
        btn.disabled=true; btn.textContent='Creating…';
        try {
            const raw=(ta?.value||'').trim();
            let domain, result;
            if(isAdvanced&&_isHCL(raw)){
                const block=raw.match(/domains\s*=\s*\[([^\]]*)\]/s);
                const all=block?[...block[1].matchAll(/"([^"]+)"/g)].map(m=>m[1].trim().toLowerCase()):[];
                domain=(all[0]||wizard.draftGet('domain')||'').trim().toLowerCase();
                if(!domain)throw new Error('Domain is required — add  domains = ["example.com"]  to your HCL');
                result=await api.addHostHCL(raw);
            } else {
                const config=JSON.parse(raw||'{}');
                const first=Array.isArray(config.domains)?config.domains[0]:(config.domain||'');
                domain=(wizard.draftGet('domain')||first||'').trim().toLowerCase();
                if(!domain)throw new Error('Domain is required');
                result=await api.addHost(domain, config);
            }
            if(result?.error)throw new Error(result.error);
            notify.show(domain+' created successfully','success');
            emit('wizard:submit-success',{domain});
        } catch(err){
            btn.disabled=false; btn.textContent='Create Host';
            emit('wizard:submit-error',{});
            if(errBox){errBox.textContent=err.message||'Failed to create host — check your configuration';errBox.classList.add('visible');}
        }
    });

    onUnmount(()=>{});
    ready();
}
