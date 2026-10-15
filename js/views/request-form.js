/* ============================================================
   views/request-form.js — create / amend form + extend/block/reactivate confirm
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);
    const F = window.UI.field;

    function ds() { return window.Store.get().datasets; }
    function plantOptions() { return ds().PLANTS.map(p => ({ value: p.code, label: p.code + ' — ' + p.name })); }
    // plants the current user is assigned to (managed on the Users page); when
    // amending, plants already on the item stay selectable so an amend can never
    // silently drop an existing plant assignment
    function accessiblePlants(payload) {
        const s = window.Store.session();
        const u = (window.Store.get().users || []).find(x => x.name === s.currentUser);
        const codes = new Set((u && u.plants && u.plants.length) ? u.plants : [s.plant]);
        ((payload && payload.plants) || []).forEach(c => codes.add(c));
        if (payload && payload.plant) codes.add(payload.plant);
        return ds().PLANTS.filter(p => codes.has(p.code));
    }

    // manufacturer master data as dropdown options; a value already on the payload
    // (e.g. an amend of an item whose manufacturer was free-typed before the
    // dropdown existed) stays selectable even if it is missing from the list
    function manufacturerOptions(current) {
        const names = (ds().MANUFACTURERS || []).map(m => m.name);
        if (current && names.indexOf(current) === -1) names.push(current);
        return names.sort((a, b) => a.localeCompare(b));
    }

    function storageFieldHtml(plant, value) {
        if (!plant) return F({ label: 'Storage location', name: 'storageLocation', type: 'select', value: '',
                   options: [], required: true, disabled: true, placeholder: 'Select a plant first',
                   hint: 'Storage locations load from the selected plant' });
        let options = window.UI.storageOptionsFor(plant) || [];
        // an amend's saved location may predate the plant's location list —
        // keep it selectable instead of silently blanking the field
        if (value && !options.some(o => (o && o.value !== undefined ? o.value : o) === value)) {
            options = [{ value, label: value + ' — current value' }].concat(options);
        }
        return F({ label: 'Storage location', name: 'storageLocation', type: 'select', value,
                   options, required: true,
                   hint: 'Locations of the selected plant' });
    }

    /* ---------------- entry ---------------- */
    window.Views.requestForm = function (query) {
        let draft = window.Views._draft;
        const type = (draft && draft.type) || (query && query.type) || 'create';
        // refresh-safe: the in-memory draft is gone after a page reload — rebuild
        // the item context from the ?mat= parameter carried in the URL
        if (!draft && query && query.mat && window.Store.materialById(query.mat)) {
            draft = window.Views._draft = { type, materialId: query.mat };
        }
        if (type === 'extend' || type === 'block' || type === 'reactivate') return confirmView(type, draft);
        return editView(type, draft);
    };

    /* ---- supporting documents attached in the form (persisted on the payload) ---- */
    let formDocs = [];
    const DOC_EXT = ['png', 'jpg', 'jpeg', 'pdf', 'svg', 'xls', 'doc', 'docx', 'csv'];
    function renderDocs(root) {
        const list = root.querySelector('#doc-list');
        const count = root.querySelector('#doc-count');
        if (list) list.innerHTML = window.UI.docListHtml(formDocs, { deletable: true });
        if (count) count.textContent = `${formDocs.length} file(s) selected`;
    }

    /* ================= CREATE / AMEND editable form ================= */
    function editView(type, draft) {
        const root = document.getElementById('view');
        let payload;
        let materialId = null;
        // AI-search data is never prefilled — it becomes per-field SUGGESTIONS the
        // requester explicitly accepts (drafts/resubmits keep their real values)
        const suggestions = (draft && draft.analysis && draft.analysis.known && draft.payload && !draft.resubmitId)
            ? Object.assign({}, draft.payload) : null;
        if (suggestions) payload = emptyPayload();
        else if (draft && draft.payload) payload = Object.assign({}, draft.payload);
        else if (draft && draft.materialId) { // amend from item
            const m = window.Store.materialById(draft.materialId);
            materialId = m.id;
            payload = payloadFromMaterial(m);
        } else payload = emptyPayload();
        if (draft && draft.materialId) materialId = draft.materialId;

        // the material group is system-selected from the category's catalog mapping
        if (payload.unspsc) {
            const cs = window.UI.categorySchema(payload.unspsc);
            if (cs && cs.materialGroup) payload.materialGroup = cs.materialGroup;
        }
        // material description defaults from group
        if (payload.materialGroup && !payload.materialDescription) payload.materialDescription = window.UI.groupDesc(payload.materialGroup);

        const aiFilled = false;
        const title = type === 'amend' ? 'Request for amending item' : 'Request for adding new item';

        const categoryOptions = (ds().CATEGORY_ATTRIBUTES || []).map(c => ({ value: c.unspsc, label: c.label + ' — UNSPSC ' + c.unspsc }));

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="back">Material Master</span> › ${esc(title)}</div>
            <div class="page-narrow form-page">
                <div class="req-head rf-head">
                    <div>
                        <div class="req-eyebrow">${type === 'amend' ? 'Amend request' : 'New item request'}</div>
                        <h1 class="req-title">${esc(title)}</h1>
                        <div class="rf-head-sub">Fill in the item data below — mandatory fields are validated when you submit.</div>
                    </div>
                    <div class="req-head-right rf-head-actions">
                        <button class="btn btn-green" id="primary-btn" data-act="submit">${type === 'amend' ? 'Submit amendment' : 'Create request'}</button>
                        <button class="btn btn-green-outline" data-act="draft">Save as draft</button>
                        <button class="btn btn-outline" data-act="back">Cancel</button>
                    </div>
                </div>

                <div id="ai-feedback"></div>

                <form id="req-form">
                    <input type="hidden" name="name" value="${esc(payload.name)}">
                    <input type="hidden" name="unspscLabel" value="${esc(payload.unspscLabel)}">
                    <div class="form-grid">
                        <div class="rf-section"><span class="rf-step">1</span><span class="t">Item identification</span><span class="rule"></span></div>
                        ${F({ label: 'Short name', name: 'shortName', value: payload.shortName, required: true, aiFilled, readonly: true,
                              hint: 'Generated automatically from category, part number & attributes' })}
                        ${F({ label: 'Long description', name: 'longDesc', type: 'textarea', value: payload.longDesc, required: true, aiFilled, span: 3,
                              readonly: true, hint: 'Generated automatically from the item data — not editable' })}
                        <div class="field col-span-3">
                            <label>Item photo</label>
                            <input type="hidden" name="image" id="img-data" value="${esc(payload.image || '')}">
                            <div class="img-upload">
                                <div class="img-preview" id="img-preview">${payload.image ? `<img src="${esc(payload.image)}" alt="">` : '<span class="muted">No image</span>'}</div>
                                <div class="img-upload-controls">
                                    <input type="file" id="img-file" accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp" hidden>
                                    <div style="display:flex;gap:8px;align-items:center">
                                        <button type="button" class="btn btn-outline btn-sm" data-act="choose-img">Choose image</button>
                                        <button type="button" class="btn btn-link ${payload.image ? '' : 'hidden'}" id="img-remove-btn" data-act="remove-img">Remove</button>
                                    </div>
                                    <div class="hint">PNG, JPG, SVG or WebP · max 2 MB. Shown with the item everywhere.</div>
                                </div>
                            </div>
                        </div>
                        <div class="field col-span-3">
                            <label>Supporting documents</label>
                            <div class="hint" style="font-style:italic;margin-bottom:2px">Allowed formats: PNG, JPG, JPEG, PDF, SVG, XLS, DOC, DOCX, CSV. Maximum file size: 10MB</div>
                            <input type="file" id="doc-file" multiple hidden
                                accept=".png,.jpg,.jpeg,.pdf,.svg,.xls,.doc,.docx,.csv">
                            <div class="doc-attach-row">
                                <button type="button" class="btn btn-outline" data-act="attach-doc">Attach File</button>
                                <span class="muted" id="doc-count"></span>
                            </div>
                            <div id="doc-list"></div>
                        </div>

                        <div class="rf-section"><span class="rf-step">2</span><span class="t">Classification</span><span class="rule"></span></div>
                        ${F({ label: 'Category', name: 'unspsc', type: 'select', value: payload.unspsc, options: categoryOptions, required: true, aiFilled, hint: 'Loads the attribute set below', placeholder: 'Select category…' })}
                        ${F({ label: 'UNSPSC code', name: 'unspscMirror', value: payload.unspsc, readonly: true, hint: 'From selected category' })}
                        ${F({ label: 'Material Type', name: 'materialType', value: 'ROH', readonly: true, hint: 'Fixed for Demand Planning' })}
                        ${F({ label: 'Material Description', name: 'materialDescription', value: payload.materialDescription, readonly: true, hint: 'Populated from Material Group' })}
                        ${F({ label: 'Material Group', name: 'materialGroup', value: payload.materialGroup, readonly: true, required: true, hint: 'Selected automatically from the category' })}
                        ${F({ label: 'Part type', name: 'matTypeChoice', type: 'select', value: payload.matTypeChoice, options: ds().MATERIAL_TYPE_CHOICES, required: true, hint: 'OEM / Generic / Engineered / Commercial' })}
                        ${F({ label: 'Manufacturer name', name: 'manufacturer', type: 'select', creatable: 'manufacturer', value: payload.manufacturer, options: manufacturerOptions(payload.manufacturer), placeholder: 'Select manufacturer…', hint: 'Mandatory for OEM · not listed? Type the name and add it' })}
                        ${F({ label: 'Manufacturer part #', name: 'mfrPartNo', value: payload.mfrPartNo, hint: 'Mandatory for OEM' })}
                        ${F({ label: 'Model', name: 'model', value: payload.model, hint: 'Model / series of the item' })}

                        <div class="rf-section"><span class="rf-step">3</span><span class="t">Logistics & planning</span><span class="rule"></span></div>
                        ${F({ label: 'Base unit of measure', name: 'baseUom', type: 'select', value: payload.baseUom, options: ds().UOM, required: true })}
                        <div id="storage-field" style="display:contents">${storageFieldHtml((payload.plants && payload.plants.length ? payload.plants[0] : payload.plant) || '', payload.storageLocation)}</div>
                        ${F({ label: 'MRP type', name: 'mrpType', type: 'select', value: payload.mrpType, options: ds().MRP_TYPES, required: true })}
                        ${F({ label: 'MRP planning enabled?', name: 'mrpEnabled', type: 'radio', value: payload.mrpEnabled, options: ['Yes', 'No'], required: true })}
                        ${F({ label: 'Batch-managed?', name: 'batchManaged', type: 'radio', value: payload.batchManaged, options: ['Yes', 'No'], required: true })}
                        ${F({ label: 'Record type', name: 'recordType', type: 'radio', value: payload.recordType, options: ['Golden record', 'Sourcing record'], required: true })}
                        <div class="field col-span-3"><label class="req-label">${type === 'amend' ? 'Plants' : 'Plant'}<span class="req">*</span> <span class="muted" style="font-weight:400;font-size:12px">${type === 'amend' ? '(plants already on the item cannot be removed)' : '(one plant per request — extend to further plants after creation)'}</span></label>
                            <input type="text" class="form-input plants-filter" id="plants-filter" placeholder="Search plants…">
                            <div class="checkbox-group plants-picker plants-picker-wide" id="plants-picker">
                                ${(() => {
                                    const acc = accessiblePlants(payload);
                                    const cur = (payload.plants && payload.plants.length ? payload.plants : (payload.plant ? [payload.plant] : []));
                                    if (type === 'amend') {
                                        return acc.map(pl => `<label class="checkbox-label"><input type="checkbox" class="rf-plant" value="${pl.code}" ${cur.indexOf(pl.code) !== -1 ? 'checked' : ''}> ${pl.code} — ${esc(pl.name)}</label>`).join('');
                                    }
                                    // new items are created for exactly ONE plant of the requester's
                                    const pre = cur[0] || (acc.length === 1 ? acc[0].code : '');
                                    return acc.map(pl => `<label class="checkbox-label"><input type="radio" name="rf-plant-pick" class="rf-plant" value="${pl.code}" ${pre === pl.code ? 'checked' : ''}> ${pl.code} — ${esc(pl.name)}</label>`).join('');
                                })()}
                            </div>
                            <div class="field-error" data-err="plant"></div>
                        </div>
                    </div>

                    <div class="rf-section" style="margin-top:28px"><span class="rf-step">4</span><span class="t">Technical attributes</span><span class="note">defined by the selected category${aiFilled ? ' · values prefilled by AI' : ''}</span><span class="rule"></span></div>
                    <div class="form-grid" id="attr-zone">${attrZoneInner(payload.unspsc, payload.attributes, payload.recordType === 'Sourcing record')}</div>
                </form>
            </div>`;

        // supporting documents
        formDocs = (payload.documents || []).map(d => Object.assign({}, d));
        renderDocs(root);
        const docInput = root.querySelector('#doc-file');
        if (docInput) docInput.addEventListener('change', e => {
            [...(e.target.files || [])].forEach(f => {
                const ext = (f.name.split('.').pop() || '').toLowerCase();
                if (DOC_EXT.indexOf(ext) === -1) {
                    window.UI.toast({ title: 'Format not allowed', body: `“${f.name}” — allowed formats: ${DOC_EXT.join(', ').toUpperCase()}.`, kind: 'danger' });
                    return;
                }
                if (f.size > 10 * 1024 * 1024) {
                    window.UI.toast({ title: 'File too large', body: `“${f.name}” exceeds the 10MB limit.`, kind: 'danger' });
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    formDocs.push({ name: f.name, size: f.size, type: f.type || '', data: reader.result });
                    renderDocs(root);
                };
                reader.readAsDataURL(f);
            });
            e.target.value = '';
        });
        root.addEventListener('click', e => {
            const del = e.target.closest && e.target.closest('[data-doc-del]');
            if (!del) return;
            formDocs.splice(Number(del.getAttribute('data-doc-del')), 1);
            renderDocs(root);
        });

        // image upload
        const fileInput = root.querySelector('#img-file');
        if (fileInput) fileInput.addEventListener('change', e => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            if (f.size > 2 * 1024 * 1024) { window.UI.toast({ title: 'Image too large', body: 'Please choose an image under 2 MB.', kind: 'danger' }); e.target.value = ''; return; }
            const reader = new FileReader();
            reader.onload = () => setFormImage(root, reader.result);
            reader.readAsDataURL(f);
        });

        // plants picker: filter the checkbox list (checked plants always stay visible)
        const plantsFilter = root.querySelector('#plants-filter');
        if (plantsFilter) plantsFilter.addEventListener('input', () => {
            const q = plantsFilter.value.trim().toLowerCase();
            root.querySelectorAll('#plants-picker .checkbox-label').forEach(lb => {
                const keep = !q || lb.textContent.toLowerCase().indexOf(q) !== -1 || lb.querySelector('input').checked;
                lb.style.display = keep ? '' : 'none';
            });
        });

        // live: first selected plant → storage-location options (keep value if still valid)
        const plantsPicker = root.querySelector('#plants-picker');
        if (plantsPicker) plantsPicker.addEventListener('change', e => {
            if (!e.target.classList || !e.target.classList.contains('rf-plant')) return;
            const first = root.querySelector('.rf-plant:checked');
            const sel = root.querySelector('[name="storageLocation"]');
            const holder = root.querySelector('#storage-field');
            if (holder) holder.innerHTML = storageFieldHtml(first ? first.value : '', sel ? sel.value : '');
        });

        // live: short & long descriptions are never typed — they regenerate from the
        // category, manufacturer/part number and filled technical attributes, in the
        // same MRO structure as the mastered records
        function regenerateDesc() {
            const p = collect();
            if (!p.unspsc) return;   // needs a category to derive the noun/qualifier
            // readable item name for record cards: category + manufacturer + part
            const nameInput = root.querySelector('input[name="name"]');
            if (nameInput && (!nameInput.value || nameInput.getAttribute('data-auto') === '1')) {
                const readable = [p.unspscLabel, [p.manufacturer, p.mfrPartNo].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
                if (readable) { nameInput.value = readable; nameInput.setAttribute('data-auto', '1'); }
            }
            const sd = window.AI.structuredDesc(collect());
            const sn = root.querySelector('[name="shortName"]');
            if (sn && sd.shortName) { sn.value = sd.shortName; sn.classList.add('ai-filled'); }
            const ld = root.querySelector('[name="longDesc"]');
            if (ld && sd.longDesc) { ld.value = sd.longDesc; ld.classList.add('ai-filled'); }
        }
        // any attribute value, manufacturer or part number feeds the descriptions
        ['input', 'change'].forEach(ev => root.addEventListener(ev, (e) => {
            if (e.target.closest && (e.target.closest('#attr-zone') ||
                e.target.name === 'manufacturer' || e.target.name === 'mfrPartNo')) regenerateDesc();
        }));

        /* ---- AI suggestions: shown as per-field chips the user must accept ---- */
        // Part type and Storage location are the requester's own calls — no chips.
        // MRP type / MRP enabled / Batch-managed / Record type are business
        // decisions the requester makes — the AI never suggests them
        const SUGGEST_FIELDS = [
            { name: 'unspsc', label: 'Category' }, { name: 'manufacturer' },
            { name: 'mfrPartNo' }, { name: 'model' }, { name: 'baseUom' }
        ];
        function fieldCurrent(f) {
            if (f.radio) { const r = root.querySelector(`input[name="${f.name}"]:checked`); return r ? r.value : ''; }
            const el = root.querySelector(`[name="${f.name}"]`);
            return el ? el.value : '';
        }
        function fieldDisplay(f, val) {
            const el = root.querySelector(`select[name="${f.name}"]`);
            if (el) { const o = [...el.options].find(x => x.value === String(val)); if (o) return o.textContent.trim(); }
            return String(val);
        }
        function stripUom(attrName, val) {
            const schema = window.UI.categorySchema((root.querySelector('[name="unspsc"]') || {}).value);
            const a = schema && (schema.attributes || []).find(x => x.name === attrName);
            if (a && a.uom) return String(val).replace(new RegExp('\\s*' + a.uom + '\\s*$', 'i'), '').trim();
            return String(val).trim();
        }
        function applySuggestion(name) {
            if (!suggestions) return;
            if (name.indexOf('attr::') === 0) {
                const attrName = name.slice(6);
                const vals = readAttrInputs(root);
                vals[attrName] = suggestions.attributes[attrName];
                root.querySelector('#attr-zone').innerHTML = attrZoneInner(root.querySelector('[name="unspsc"]').value, vals, isSourcing());
            } else {
                const f = SUGGEST_FIELDS.find(x => x.name === name);
                let val = suggestions[name];
                if (name === 'manufacturer' && val) {
                    // the suggested maker may not be in the master list yet — add it
                    // (deduped) so the dropdown can hold the value
                    val = window.UI.addManufacturer(String(val)) || val;
                    window.UI.ssEnsureOption(root.querySelector('select[name="manufacturer"]'), val);
                    suggestions[name] = val;   // canonical casing, so the chip clears once applied
                }
                if (f && f.radio) {
                    const r = root.querySelector(`input[name="${name}"][value="${val}"]`);
                    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
                } else {
                    const el = root.querySelector(`[name="${name}"]`);
                    if (el) {
                        el.value = val;
                        el.classList.add('ai-filled');
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        // refresh the enhanced dropdown's visible label
                        const wrap = el.closest('.search-select');
                        if (wrap) {
                            const lab = wrap.querySelector('.ss-label');
                            if (lab) { lab.textContent = fieldDisplay(f || { name }, val); lab.classList.remove('ss-placeholder'); }
                        }
                    }
                }
            }
            regenerateDesc();
            renderSuggestionChips();
        }
        function renderSuggestionChips() {
            if (!suggestions) return;
            root.querySelectorAll('.ai-suggest').forEach(el => el.remove());
            let remaining = 0;
            const chip = (input, name, display) => {
                const field = input.closest('.field');
                if (!field) return;
                const div = document.createElement('div');
                div.className = 'ai-suggest';
                div.innerHTML = `<span class="as-star">✦</span><span class="as-text"></span><button type="button" class="as-use" data-sfield=""></button>`;
                div.querySelector('.as-text').textContent = 'AI suggests: ' + display;
                const btn = div.querySelector('.as-use');
                btn.textContent = 'Use';
                btn.setAttribute('data-sfield', name);
                field.appendChild(div);
                remaining += 1;
            };
            SUGGEST_FIELDS.forEach(f => {
                const val = suggestions[f.name];
                if (val === undefined || val === null || String(val).trim() === '') return;
                if (String(fieldCurrent(f)) === String(val)) return;
                const input = f.radio ? root.querySelector(`input[name="${f.name}"]`) : root.querySelector(`[name="${f.name}"]`);
                if (input) chip(input, f.name, fieldDisplay(f, val));
            });
            Object.keys(suggestions.attributes || {}).forEach(a => {
                const val = suggestions.attributes[a];
                if (!val || !String(val).trim()) return;
                const input = root.querySelector(`#attr-zone [name="attr::${CSS.escape(a)}"]`);
                if (!input) return;   // attribute set appears once the category is accepted
                if (stripUom(a, input.value) === stripUom(a, val) && input.value !== '') return;
                if (input.value && input.value !== '') return;   // never fight a user-typed value
                chip(input, 'attr::' + a, String(val));
            });
            // top banner with "apply all"
            const box = document.getElementById('ai-feedback');
            box.innerHTML = remaining ? `<div class="banner info"><span class="banner-icon">✦</span><div class="banner-body">
                <div class="banner-title">The AI analysed your search and prepared ${remaining} field suggestion${remaining === 1 ? '' : 's'}</div>
                Nothing is filled in automatically — accept each suggestion under its field, or apply them all at once.</div>
                <div class="banner-actions"><button class="btn btn-black btn-sm" data-act="apply-all-sugg">Apply all suggestions</button></div></div>` : '';
        }
        function applyAllSuggestions() {
            if (!suggestions) return;
            if (suggestions.unspsc && fieldCurrent({ name: 'unspsc' }) !== String(suggestions.unspsc)) applySuggestion('unspsc');
            SUGGEST_FIELDS.filter(f => f.name !== 'unspsc').forEach(f => {
                const v = suggestions[f.name];
                if (v !== undefined && v !== null && String(v).trim() !== '' && String(fieldCurrent(f)) !== String(v)) applySuggestion(f.name);
            });
            if (suggestions.attributes && root.querySelector('[name="unspsc"]').value) {
                const vals = readAttrInputs(root);
                Object.keys(suggestions.attributes).forEach(a => { if (!vals[a]) vals[a] = suggestions.attributes[a]; });
                root.querySelector('#attr-zone').innerHTML = attrZoneInner(root.querySelector('[name="unspsc"]').value, vals, isSourcing());
            }
            regenerateDesc();
            renderSuggestionChips();
        }
        root.addEventListener('click', (e) => {
            const use = e.target.closest('.as-use');
            if (use) applySuggestion(use.getAttribute('data-sfield'));
        });
        // a manually chosen category also reveals the attribute suggestions
        root.addEventListener('change', (e) => { if (suggestions && e.target.name === 'unspsc') setTimeout(renderSuggestionChips, 0); });
        if (suggestions) setTimeout(renderSuggestionChips, 0);

        // live: category → UNSPSC mirror + material group (system-selected) + attribute set
        const isSourcing = () => {
            const r = root.querySelector('input[name="recordType"]:checked');
            return !!r && r.value === 'Sourcing record';
        };
        root.querySelector('[name="unspsc"]').addEventListener('change', e => {
            const unspsc = e.target.value;
            const mirror = root.querySelector('[name="unspscMirror"]'); if (mirror) mirror.value = unspsc;
            const labelInput = root.querySelector('[name="unspscLabel"]');
            const schema = window.UI.categorySchema(unspsc);
            if (labelInput) labelInput.value = schema ? schema.label : '';
            // the material group follows the category's catalog mapping — not user-editable
            const mg = root.querySelector('[name="materialGroup"]');
            if (mg) mg.value = (schema && schema.materialGroup) || '';
            const md = root.querySelector('[name="materialDescription"]');
            if (md) md.value = mg && mg.value ? window.UI.groupDesc(mg.value) : '';
            const current = readAttrInputs(root);
            root.querySelector('#attr-zone').innerHTML = attrZoneInner(unspsc, current, isSourcing());
            regenerateDesc();
        });
        // live: record type → sourcing records need no mandatory technical attributes
        root.querySelectorAll('input[name="recordType"]').forEach(r => r.addEventListener('change', () => {
            const current = readAttrInputs(root);
            root.querySelector('#attr-zone').innerHTML = attrZoneInner(root.querySelector('[name="unspsc"]').value, current, isSourcing());
        }));

        window.UI.bindActions(root, {
            'back': () => history.length > 1 ? history.back() : window.UI.go('#/master'),
            'submit': () => doSubmit(type, materialId, draft),
            'apply-all-sugg': () => applyAllSuggestions(),
            'choose-img': () => { const fi = root.querySelector('#img-file'); if (fi) fi.click(); },
            'attach-doc': () => { const fi = root.querySelector('#doc-file'); if (fi) fi.click(); },
            'remove-img': () => setFormImage(root, ''),
            'draft': () => { const p = collect(); const dr = window.Workflow.createRequest({ type, payload: p, materialId, draft: true, aiFeedback: [] });
                window.UI.toast({ title: 'Saved as draft', body: 'Find it in your Inbox → Drafts.' });
                if (draft && draft.fromBulk) { window.Views.bulkMarkAction(draft.fromBulk.batch, draft.fromBulk.i, 'Draft saved — ' + window.Workflow.reqNo(dr)); window.UI.go('#/bulk/' + draft.fromBulk.batch); return; }
                window.UI.go('#/inbox'); }
        });
    }

    /* ---- typed attribute controls driven by the category schema ----
       attribute: { name, fieldType(Text|Number|Range|Yes/No|List|Date), uom, mandatory, options } */
    function listOptions(a, current) {
        const opts = window.UI.optionList(a.options);
        if (current && opts.indexOf(current) === -1) opts.unshift(current);
        return opts;
    }
    function numPart(v) { const n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.')); return isNaN(n) ? '' : n; }

    function attrField(a, val, forceOptional) {
        const name = 'attr::' + a.name;
        const t = a.fieldType || 'Text';
        const mandatory = a.mandatory && !forceOptional;
        const label = `${esc(a.name)}${a.uom ? ` <span class="attr-uom">(${esc(a.uom.toLowerCase())})</span>` : ''}${mandatory ? '<span class="req">*</span>' : ''}`;
        let control;
        if (t === 'Number') {
            control = `<input class="form-input ai-filled" type="number" step="any" name="${name}" value="${esc(numPart(val))}">`;
        } else if (t === 'Range') {
            const parts = String(val || '').split(/–|—|\.\.|to/i);
            control = `<div class="range-pair">
                <input class="form-input ai-filled" type="number" step="any" name="${name}" placeholder="Min" value="${esc(numPart(parts[0]))}">
                <span class="muted">–</span>
                <input class="form-input ai-filled" type="number" step="any" name="${name}::max" placeholder="Max" value="${esc(numPart(parts[1]))}">
            </div>`;
        } else if (t === 'Yes/No') {
            control = `<select class="form-select ai-filled" name="${name}">
                <option value="">Select…</option>
                <option ${val === 'Yes' ? 'selected' : ''}>Yes</option>
                <option ${val === 'No' ? 'selected' : ''}>No</option></select>`;
        } else if (t === 'List') {
            control = `<select class="form-select ai-filled" name="${name}">
                <option value="">Select…</option>
                ${listOptions(a, String(val || '').trim()).map(o => `<option value="${esc(o)}" ${String(val || '').trim() === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        } else if (t === 'Date') {
            control = `<input class="form-input ai-filled" type="date" name="${name}" value="${esc(val || '')}">`;
        } else {
            control = `<input class="form-input ai-filled" type="text" name="${name}" value="${esc(val || '')}">`;
        }
        return `<div class="field"><label class="${mandatory ? 'req-label' : ''}">${label}</label>${control}<div class="field-error" data-err="${name}"></div></div>`;
    }

    // strip a trailing uom from an AI-prefilled value so typed controls can use it
    function attrValueFor(a, values) {
        let v = values[a.name];
        if (v === undefined || v === null) return '';
        v = String(v).trim();
        if (a.uom && new RegExp('\\s*' + a.uom + '\\s*$', 'i').test(v)) v = v.replace(new RegExp('\\s*' + a.uom + '\\s*$', 'i'), '');
        return v;
    }

    // render attribute inputs for the category's schema (or a hint when none)
    function attrZoneInner(unspsc, values, sourcing) {
        values = values || {};
        const schema = window.UI.categorySchema(unspsc);
        if (schema) {
            // sourcing records don't require technical attributes — render all as optional
            return schema.attributes.map(a => attrField(a, attrValueFor(a, values), sourcing)).join('');
        }
        const extra = Object.keys(values).length
            ? Object.entries(values).map(([k, v]) => F({ label: k, name: 'attr::' + k, value: v, aiFilled: true })).join('')
            : '';
        return `<div class="field col-span-3"><div class="banner info mb-0"><span class="banner-icon">ℹ️</span>
            <div class="banner-body">No predefined attribute set for this category yet. Select a <strong>Category</strong> above to load its attributes${extra ? ', or edit the detected ones below' : ''}. Manage categories &amp; attributes from the <strong>Category catalog</strong>.</div></div></div>${extra}`;
    }
    // set/clear the uploaded item image + preview
    function setFormImage(root, dataUrl) {
        const hidden = root.querySelector('#img-data'); if (hidden) hidden.value = dataUrl || '';
        const prev = root.querySelector('#img-preview');
        if (prev) prev.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="">` : '<span class="muted">No image</span>';
        const rm = root.querySelector('#img-remove-btn'); if (rm) rm.classList.toggle('hidden', !dataUrl);
    }
    // read current attr:: inputs into a values map (range max halves are skipped)
    function readAttrInputs(root) {
        const vals = {};
        root.querySelectorAll('#attr-zone [name^="attr::"]').forEach(el => {
            const n = el.getAttribute('name');
            if (n.indexOf('::max') !== -1) return;
            vals[n.slice(6)] = el.value;
        });
        return vals;
    }

    function collect() {
        const form = document.getElementById('req-form');
        const fd = new FormData(form);
        const p = {};
        for (const [k, v] of fd.entries()) p[k] = v;
        const unspsc = p.unspsc || '';
        const schema = window.UI.categorySchema(unspsc);
        // attributes: schema-aware (typed values, uom appended, ranges combined)
        const attrs = {};
        if (schema) {
            schema.attributes.forEach(a => {
                const t = a.fieldType || 'Text';
                let v = '';
                if (t === 'Range') {
                    const min = String(p['attr::' + a.name] || '').trim();
                    const max = String(p['attr::' + a.name + '::max'] || '').trim();
                    if (min || max) v = (min || '…') + '–' + (max || '…');
                } else {
                    v = String(p['attr::' + a.name] || '').trim();
                }
                if (v && a.uom) v += ' ' + a.uom.toLowerCase();
                if (v) attrs[a.name] = v;
            });
        } else {
            Object.keys(p).forEach(k => {
                if (k.indexOf('attr::') === 0 && k.indexOf('::max') === -1) {
                    const name = k.slice(6);
                    if (String(p[k]).trim()) attrs[name] = p[k];
                }
            });
        }
        const label = (p.unspscLabel && p.unspscLabel.trim()) || (schema ? schema.label : '');
        const shortName = p.shortName || '';
        return {
            name: (p.name && p.name.trim()) || shortName, shortName, longDesc: p.longDesc || '',
            materialType: 'ROH', matTypeChoice: p.matTypeChoice || '',
            manufacturer: p.manufacturer || '', mfrPartNo: p.mfrPartNo || '', model: p.model || '',
            unspsc, unspscLabel: label, category: label,
            materialGroup: p.materialGroup || '', materialDescription: p.materialDescription || '',
            baseUom: p.baseUom || '',
            plants: [...document.querySelectorAll('.rf-plant:checked')].map(cb => cb.value),
            plant: ([...document.querySelectorAll('.rf-plant:checked')].map(cb => cb.value))[0] || '',
            storageLocation: p.storageLocation || '',
            mrpEnabled: p.mrpEnabled || '', batchManaged: p.batchManaged || '', mrpType: p.mrpType || '',
            recordType: p.recordType || '', valuationClass: '',
            attributes: attrs, image: p.image || '',
            documents: formDocs.map(d => Object.assign({}, d))
        };
    }

    function doSubmit(type, materialId, draft) {
        const p = collect();
        // no AI checks on this page — only mandatory-field validation
        const res = window.AI.validate(p);
        // reset field errors
        document.querySelectorAll('.form-input, .form-select, .search-select input[type="hidden"]').forEach(el => el.classList.remove('error'));
        if (!res.ok) {
            res.blocking.forEach(b => { const el = document.querySelector(`[name="${b.field}"]`); if (el) el.classList.add('error'); });
            renderFeedback(res);
            window.UI.toast({ title: 'Cannot submit', body: 'Some mandatory fields are blank. Please complete them.', kind: 'danger' });
            document.getElementById('ai-feedback').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        document.getElementById('ai-feedback').innerHTML = '';
        finalize(type, p, materialId, [], draft);
    }

    function finalize(type, payload, materialId, warnings, draft) {
        // resubmit an existing declined/draft request rather than creating a new one
        if (draft && draft.resubmitId) {
            const req = window.Store.requestById(draft.resubmitId);
            if (req) {
                req.aiFeedback = warnings;
                window.Workflow.resubmit(req, payload);
                window.Views._draft = null;
                window.UI.toast({ title: 'Resubmitted', body: 'Sent to ' + firstStageRole(type) + ' for review.', kind: 'info' });
                window.UI.go('#/request/' + req.id);
                return;
            }
        }
        // an amendment submitted BY the MDM Specialist applies directly — no
        // approval chain; it becomes an instant, logged mdm_amend request
        const effType = (type === 'amend' && window.Store.session().currentRole === 'MDM Specialist') ? 'mdm_amend' : type;
        const req = window.Workflow.createRequest({ type: effType, payload, materialId, aiFeedback: warnings });
        const fromBulk = draft && draft.fromBulk ? draft.fromBulk : null;
        window.Views._draft = null;
        window.UI.toast(effType === 'mdm_amend'
            ? { title: 'Changes applied', body: 'Saved directly to the material record (' + window.Workflow.reqNo(req) + ') — no approval required.', kind: 'info' }
            : { title: 'Request submitted', body: 'Sent to ' + firstStageRole(type) + ' for review.', kind: 'info' });
        if (fromBulk) {
            window.Views.bulkMarkAction(fromBulk.batch, fromBulk.i, 'Created — ' + window.Workflow.reqNo(req));
            window.UI.go('#/bulk/' + fromBulk.batch);
            return;
        }
        window.UI.go('#/request/' + req.id);
    }
    function firstStageRole(type) {
        const st = window.Workflow.stagesFor(type)[0];
        return st ? st.role : 'review';
    }

    // mandatory-field errors only — no AI feedback on this page
    function renderFeedback(res) {
        const box = document.getElementById('ai-feedback');
        box.innerHTML = res.blocking.length
            ? `<div class="banner danger"><span class="banner-icon">🚫</span><div class="banner-body">
                <div class="banner-title">${res.blocking.length} mandatory field(s) must be completed before submitting</div>
                <ul style="margin:6px 0 0 18px">${res.blocking.map(b => `<li>${esc(b.msg)}</li>`).join('')}</ul></div></div>`
            : '';
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* ================= EXTEND / BLOCK / REACTIVATE confirm ================= */
    function cfmRow(label, val, span) {
        return `<div class="def-row ${span ? 'span-2' : ''}"><div class="def-k">${esc(label)}</div><div class="def-v">${esc((val === undefined || val === null || val === '') ? '—' : val)}</div></div>`;
    }
    function confirmView(type, draft) {
        const root = document.getElementById('view');
        const m = draft && draft.materialId ? window.Store.materialById(draft.materialId) : null;
        if (!m) { root.innerHTML = `<div class="page-narrow"><div class="empty-state">No item selected.</div></div>`; return; }
        const s = window.Store.session();
        // extend: the requester picks WHICH of their plants to extend to — only
        // plants they have access to and the item is not already in
        const extendTargets = type === 'extend'
            ? accessiblePlants(null).filter(pl => (m.plants || []).indexOf(pl.code) === -1)
            : [];
        const cfg = {
            extend: { title: 'Request for item extension', cta: 'Submit extension',
                note: `This item exists in plant${m.plants.length > 1 ? 's' : ''} <strong>${esc(m.plants.join(', '))}</strong>. Select the plant to extend it to below — the extension requires MDM Specialist approval before SAP is updated.` },
            block: { title: 'Request to block item (plant level)', cta: 'Submit block request',
                note: `This will request blocking <strong>${esc(m.name)}</strong> at plant <strong>${esc(s.plant)}</strong>. It requires MDM Specialist approval before SAP is updated.` },
            reactivate: { title: 'Request to reactivate item', cta: 'Submit reactivation',
                note: `This will request reactivating the blocked item <strong>${esc(m.name)}</strong> at plant <strong>${esc(s.plant)}</strong>. It requires MDM Specialist approval.` }
        }[type];

        root.innerHTML = `
            <div class="page-narrow">
                <div class="back-link" data-act="back">‹ Back</div>
                <div class="form-header">
                    <div class="form-actions">
                        ${type === 'extend' && !extendTargets.length ? '' : `<button class="btn btn-green" data-act="submit">${cfg.cta}</button>`}
                        <button class="btn btn-outline" data-act="back">Cancel</button>
                    </div>
                </div>
                <h2 class="form-page-title">${esc(cfg.title)}</h2>
                <div class="banner ${type === 'extend' ? 'match' : 'warn'}"><span class="banner-icon">ℹ️</span><div class="banner-body">${cfg.note}</div></div>

                ${type === 'extend' ? (extendTargets.length ? `<div class="result-block"><div class="rb-head">
                    <div><div class="k muted" style="font-size:11px;text-transform:uppercase">Source plant${m.plants.length > 1 ? 's' : ''} (extend from)</div>
                        <div class="rb-title">${m.plants.map(pc => esc(window.UI.plantLabel(pc))).join('<br>')}</div></div>
                    <div style="font-size:22px">→</div>
                    <div style="min-width:320px">${F({ label: 'Target plant (extend to)', name: 'extendPlant', type: 'select',
                        value: '', options: extendTargets.map(pl => ({ value: pl.code, label: pl.code + ' — ' + pl.name })),
                        required: true, placeholder: 'Select plant…', hint: 'Plants you have access to' })}</div>
                </div></div>` : `<div class="banner warn"><span class="banner-icon">⚠️</span><div class="banner-body">
                    This item already exists in all plants you have access to — there is no plant to extend it to.
                    Plant access is managed by the Central team on the User management page.</div></div>`) : ''}

                <div class="panel-card">
                    <div class="pc-title">Item summary</div>
                    <div class="cfm-item">
                        ${m.image ? `<div class="cfm-item-img"><img src="${esc(m.image)}" alt=""></div>` : ''}
                        <div class="def-grid cfm-item-grid">
                            ${cfmRow('Short name', m.shortName)}
                            ${cfmRow('SAP ID', m.sapId)}
                            ${cfmRow('Manufacturer', m.manufacturer)}
                            ${cfmRow('Part #', m.mfrPartNo)}
                            ${cfmRow('Category · UNSPSC', (m.unspscLabel || m.category || '') + (m.unspsc ? ' · ' + m.unspsc : ''))}
                            ${cfmRow('Material group', m.materialGroup ? m.materialGroup + (window.UI.groupDesc(m.materialGroup) ? ' — ' + window.UI.groupDesc(m.materialGroup) : '') : '')}
                            ${cfmRow('Base UoM', m.baseUom)}
                            ${cfmRow('PO unit', m.poUnit)}
                            ${cfmRow('Long description', m.longDesc, true)}
                        </div>
                    </div>
                    <div class="mc-plants cfm-plants"><span class="plants-label">Plant${(m.plants || []).length > 1 ? 's' : ''} - </span>
                        ${(m.plants || []).map(pc => `<span class="plant-chip">${esc(window.UI.plantLabel(pc))}</span>`).join('')}</div>
                    <div class="cfm-attrs">
                        <div class="cfm-attrs-title">Technical attributes</div>
                        ${Object.keys(m.attributes || {}).length
                            ? `<div class="attr-tiles">${Object.entries(m.attributes).map(([k, v]) =>
                                `<div class="attr-tile"><div class="at-k">${esc(k)}</div><div class="at-v">${esc(v)}</div></div>`).join('')}</div>`
                            : '<div class="muted">No attributes.</div>'}
                    </div>
                </div>
            </div>`;

        window.UI.bindActions(root, {
            'back': () => window.UI.go('#/item/' + m.id),
            'submit': () => {
                let requesterPlant;
                if (type === 'extend') {
                    // the target plant is mandatory
                    const sel = root.querySelector('[name="extendPlant"]');
                    requesterPlant = sel ? sel.value : '';
                    if (!requesterPlant) {
                        if (sel) {
                            sel.classList.add('error');
                            const w = sel.closest('.search-select');
                            const t = w && w.querySelector('.ss-toggle');
                            if (t) t.classList.add('error');
                        }
                        const err = root.querySelector('[data-err="extendPlant"]');
                        if (err) err.textContent = 'Please select the plant to extend to.';
                        window.UI.toast({ title: 'Target plant required', body: 'Select the plant to extend this item to.', kind: 'danger' });
                        return;
                    }
                }
                const req = window.Workflow.createRequest({ type, payload: payloadFromMaterial(m), materialId: m.id, requesterPlant });
                const fromBulk = draft && draft.fromBulk ? draft.fromBulk : null;
                window.Views._draft = null;
                window.UI.toast({ title: 'Request submitted', body: 'Sent to MDM Specialist for review.', kind: 'info' });
                if (fromBulk) {
                    window.Views.bulkMarkAction(fromBulk.batch, fromBulk.i, 'Submitted — ' + window.Workflow.reqNo(req));
                    window.UI.go('#/bulk/' + fromBulk.batch);
                    return;
                }
                window.UI.go('#/request/' + req.id);
            }
        });
    }

    /* ---------------- helpers ---------------- */
    function emptyPayload() {
        const s = window.Store.session();
        return { name: '', shortName: '', longDesc: '', materialType: 'ROH', matTypeChoice: '',
            manufacturer: '', mfrPartNo: '', model: '', unspsc: '', unspscLabel: '', category: '', materialGroup: '',
            materialDescription: '', baseUom: '', plants: [s.plant], plant: s.plant, storageLocation: '', mrpEnabled: '',
            batchManaged: '', mrpType: '', recordType: '', valuationClass: '', attributes: {}, image: '' };
    }
    function payloadFromMaterial(m) {
        return {
            name: m.name, shortName: m.shortName, longDesc: m.longDesc, materialType: 'ROH',
            matTypeChoice: m.matTypeChoice, manufacturer: m.manufacturer, mfrPartNo: m.mfrPartNo, model: m.model || '',
            unspsc: m.unspsc, unspscLabel: m.unspscLabel, category: m.category, materialGroup: m.materialGroup,
            materialDescription: window.UI.groupDesc(m.materialGroup),
            baseUom: m.baseUom, poUnit: m.poUnit,
            plants: (m.plants || []).slice(),
            plant: (m.plants && m.plants[0]) || window.Store.session().plant,
            storageLocation: m.storageLocation, mrpEnabled: m.mrpEnabled, batchManaged: m.batchManaged,
            mrpType: m.mrpType, recordType: m.recordType, valuationClass: m.valuationClass,
            attributes: Object.assign({}, m.attributes), image: m.image,
            documents: (m.documents || []).map(d => Object.assign({}, d))
        };
    }
})();
