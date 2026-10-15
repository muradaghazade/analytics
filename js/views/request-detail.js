/* ============================================================
   views/request-detail.js — request review + role-specific actions
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);

    /* ---- definition cards ---- */
    function defRow(label, val, span) {
        return `<div class="def-row ${span ? 'span-2' : ''}"><div class="def-k">${esc(label)}</div><div class="def-v">${esc((val === undefined || val === null || val === '') ? '—' : val)}</div></div>`;
    }
    function defCard(title, rowsHtml) {
        return `<div class="panel-card"><div class="pc-title">${esc(title)}</div><div class="def-grid">${rowsHtml}</div></div>`;
    }

    function dataCards(p) {
        const attrs = Object.entries(p.attributes || {});
        return `
            ${defCard('Item identification',
                defRow('Short name', p.shortName) +
                defRow('Material Type', p.materialType || 'ROH') +
                defRow('Long description', p.longDesc, true))}
            ${defCard('Classification',
                defRow('Material Group', p.materialGroup ? p.materialGroup + ' — ' + window.UI.groupDesc(p.materialGroup) : '') +
                defRow('Material Description', p.materialDescription || window.UI.groupDesc(p.materialGroup)) +
                defRow('Category · UNSPSC', p.unspsc ? (p.unspscLabel || '') + ' · ' + p.unspsc : '') +
                defRow('Part type', p.matTypeChoice) +
                defRow('Manufacturer', p.manufacturer) +
                defRow('Manufacturer part #', p.mfrPartNo) +
                defRow('Model', p.model))}
            ${defCard('Logistics & planning',
                defRow('Plants', (p.plants && p.plants.length) ? p.plants.map(pc => window.UI.plantLabel(pc)).join(', ') : (p.plant ? window.UI.plantLabel(p.plant) : '')) +
                defRow('Storage location', p.storageLocation) +
                defRow('Base UoM', p.baseUom) +
                defRow('PO unit', p.poUnit && p.poUnitFactor ? `${p.poUnit} — 1 ${p.poUnit} = ${p.poUnitFactor} ${p.baseUom || ''}` : p.poUnit) +
                defRow('MRP planning enabled', p.mrpEnabled) +
                defRow('Batch-managed', p.batchManaged) +
                defRow('MRP type', p.mrpType) +
                defRow('Record type', p.recordType) +
                defRow('Valuation class', p.valuationClass ? p.valuationClass + ' — ' + window.UI.valuationDesc(p.valuationClass) : ''))}
            ${attrs.length ? defCard('Technical attributes', attrs.map(([k, v]) => defRow(k, v)).join('')) : ''}
            ${(p.documents && p.documents.length) ? `<div class="panel-card"><div class="pc-title">Supporting documents</div>${window.UI.docListHtml(p.documents)}</div>` : ''}
            ${p.inventory ? `<div class="panel-card"><div class="pc-title">Inventory planning</div>${window.UI.inventoryRows(p.inventory)}</div>` : ''}`;
    }

    /* ---- new-category request: read-only proposal cards ---- */
    function categoryCards(p) {
        const attrs = p.catAttributes || [];
        return `
            ${defCard('Proposed category',
                defRow('Category name', p.categoryName) +
                defRow('UNSPSC code', p.unspsc) +
                (p.materialGroup ? defRow('Material group', p.materialGroup + (window.UI.groupDesc(p.materialGroup) ? ' — ' + window.UI.groupDesc(p.materialGroup) : '')) : '') +
                (p.sourceText ? defRow('Searched item', p.sourceText, true) : ''))}
            <div class="panel-card"><div class="pc-title">Proposed attributes</div>
                ${attrs.length ? `<table class="data-table attr-table">
                    <thead><tr><th>Attribute name</th><th>Field type</th><th>Measured in</th><th>Mandatory</th><th>List values</th></tr></thead>
                    <tbody>${attrs.map(a => `<tr>
                        <td style="font-weight:600">${esc(a.name)}</td><td>${esc(a.fieldType || 'Text')}</td>
                        <td>${esc(a.uom || '—')}</td><td>${a.mandatory ? 'Yes' : 'No'}</td><td>${esc(a.options || '—')}</td>
                    </tr>`).join('')}</tbody></table>` : '<div class="muted">No attributes proposed.</div>'}
            </div>`;
    }

    // MDM editable fields — every payload field except inventory planning
    // (which belongs to the Inventory team stage) and the Accounting-owned
    // valuation class is editable here, technical attribute values included.
    // PO unit options follow the (editable) base UoM — only dimension-compatible
    // units are offered; a saved incompatible value stays selectable so it is
    // corrected consciously rather than silently dropped
    function mdmPoUnitFieldHtml(baseUom, value) {
        let options = window.UI.poUnitOptionsFor(baseUom);
        if (value && options.indexOf(value) === -1) {
            options = [{ value, label: value + ' — current value' }].concat(options);
        }
        return window.UI.field({ label: 'PO unit', name: 'poUnit', type: 'select', value,
            required: true, options, hint: 'Unit of measure for purchasing — assigned by MDM' });
    }
    function mdmStorageFieldHtml(plant, value) {
        let options = window.UI.storageOptionsFor(plant) || [];
        // a saved location missing from the plant's list stays selectable —
        // otherwise the dropdown silently blanks the item's current value
        if (value && !options.some(o => (o && o.value !== undefined ? o.value : o) === value)) {
            options = [{ value, label: value + ' — current value' }].concat(options);
        }
        return window.UI.field({ label: 'Storage location', name: 'storageLocation', type: 'select', value,
            required: true, options, hint: 'Locations of the first selected plant' });
    }
    function editableGrid(p, req) {
        const F = window.UI.field, ds = window.Store.get().datasets;
        // plants the REQUESTER can hold this item in (their assignment on the
        // Users page), plus any plant already on the payload
        const requester = (window.Store.get().users || []).find(u => u.name === (req && req.requesterUser));
        const plantCodes = new Set((requester && requester.plants && requester.plants.length) ? requester.plants : []);
        ((p.plants && p.plants.length) ? p.plants : (p.plant ? [p.plant] : [])).forEach(c => plantCodes.add(c));
        if (!plantCodes.size && req) plantCodes.add(req.requesterPlant);
        const plantChoices = (ds.PLANTS || []).filter(pl => plantCodes.has(pl.code));
        const selPlants = (p.plants && p.plants.length) ? p.plants : (p.plant ? [p.plant] : []);
        const manuNames = (ds.MANUFACTURERS || []).map(m => m.name);
        if (p.manufacturer && manuNames.indexOf(p.manufacturer) === -1) manuNames.push(p.manufacturer);
        return `<div class="form-grid" id="mdm-edit">
            ${F({ label: 'Short name', name: 'shortName', value: p.shortName, span: 2, required: true })}
            ${F({ label: 'Long description', name: 'longDesc', type: 'textarea', value: p.longDesc, span: 3, required: true })}
            ${F({ label: 'Material Group', name: 'materialGroup', type: 'select', value: p.materialGroup, required: true, options: ds.MATERIAL_GROUPS.map(g => ({ value: g.code, label: g.code + ' — ' + g.desc })) })}
            ${(() => {
                // Category as a catalog dropdown (like the create form) — picking
                // one updates the UNSPSC mirror and the material group
                const cats = ds.CATEGORY_ATTRIBUTES || [];
                const catOpts = cats.map(c => ({ value: c.unspsc, label: c.label + ' — ' + c.unspsc }));
                if (p.unspsc && !cats.some(c => c.unspsc === p.unspsc)) {
                    catOpts.unshift({ value: p.unspsc, label: (p.unspscLabel || 'Current category') + ' — ' + p.unspsc });
                }
                return F({ label: 'Category', name: 'unspscSel', type: 'select', value: p.unspsc, required: true,
                    options: catOpts, hint: 'From the category catalog — sets UNSPSC & material group' });
            })()}
            ${F({ label: 'UNSPSC code', name: 'unspsc', value: p.unspsc, readonly: true, hint: 'Fixed by the item’s category — not editable' })}
            <input type="hidden" name="unspscLabel" value="${window.UI.esc(p.unspscLabel || '')}">
            <input type="hidden" name="category" value="${window.UI.esc(p.category || p.unspscLabel || '')}">
            ${F({ label: 'Manufacturer', name: 'manufacturer', type: 'select', creatable: 'manufacturer', value: p.manufacturer, options: manuNames.sort((a, b) => a.localeCompare(b)), placeholder: 'Select manufacturer…', hint: 'Mandatory for OEM' })}
            ${F({ label: 'Manufacturer part #', name: 'mfrPartNo', value: p.mfrPartNo, hint: 'Mandatory for OEM' })}
            ${F({ label: 'Model', name: 'model', value: p.model, hint: 'Model / series of the item' })}
            ${F({ label: 'Part type', name: 'matTypeChoice', type: 'select', value: p.matTypeChoice, required: true, options: ds.MATERIAL_TYPE_CHOICES })}
            ${F({ label: 'Base UoM', name: 'baseUom', type: 'select', value: p.baseUom, required: true, options: ds.UOM })}
            <div id="mdm-pounit-holder" style="display:contents">${mdmPoUnitFieldHtml(p.baseUom, p.poUnit)}</div>
            ${F({ label: 'PO unit conversion', name: 'poUnitFactor', value: p.poUnitFactor, required: true,
                hint: p.poUnit ? `How many ${p.baseUom || 'base units'} in one ${p.poUnit}` : 'How many base units in one PO unit' })}
            <div id="mdm-storage-holder" style="display:contents">${mdmStorageFieldHtml(selPlants[0] || '', p.storageLocation)}</div>
            ${F({ label: 'MRP type', name: 'mrpType', type: 'select', value: p.mrpType, required: true, options: ds.MRP_TYPES })}
            ${F({ label: 'MRP planning enabled?', name: 'mrpEnabled', type: 'radio', value: p.mrpEnabled, options: ['Yes', 'No'], required: true })}
            ${F({ label: 'Batch-managed?', name: 'batchManaged', type: 'radio', value: p.batchManaged, options: ['Yes', 'No'], required: true })}
            ${F({ label: 'Record type', name: 'recordType', type: 'radio', value: p.recordType, options: ['Golden record', 'Sourcing record'], required: true })}
            <div class="field col-span-3"><label class="req-label">Plants<span class="req">*</span></label>
                <div class="checkbox-group plants-picker plants-picker-wide">
                    ${plantChoices.map(pl => `<label class="checkbox-label"><input type="checkbox" class="mdm-plant" value="${pl.code}" ${selPlants.indexOf(pl.code) !== -1 ? 'checked' : ''}> ${pl.code} — ${window.UI.esc(pl.name)}</label>`).join('')}
                </div>
                <div class="field-error" data-err="plant"></div>
            </div>
        </div>
        <div class="rb-title" style="margin:16px 0 8px">Technical attributes</div>
        <div class="form-grid" id="mdm-attr-zone" data-unspsc="${window.UI.esc(p.unspsc || '')}">${window.UI.attrEditorHtml(p.unspsc, p.attributes, p.recordType === 'Sourcing record')}</div>`;
    }
    function collectEdits(root) {
        const edits = {};
        root.querySelectorAll('#mdm-edit [name]').forEach(el => {
            const n = el.getAttribute('name');
            if (n === 'unspscSel') return;                    // the picker itself isn't a payload field
            if (el.type === 'radio' && !el.checked) return;  // only the selected radio counts
            edits[n] = el.value;
        });
        const plants = [...root.querySelectorAll('#mdm-edit .mdm-plant:checked')].map(cb => cb.value);
        edits.plants = plants;
        edits.plant = plants[0] || '';
        const attrZone = root.querySelector('#mdm-attr-zone');
        if (attrZone) edits.attributes = window.UI.collectAttrEditor(attrZone, edits.unspsc || attrZone.getAttribute('data-unspsc'));
        return edits;
    }

    /* ---------------- Inventory team stage ---------------- */
    function renderInventoryPanel(root, req, zone) {
        const F = window.UI.field, ds = window.Store.get().datasets;
        const p = req.payload;
        const inv = p.inventory || {};
        zone.innerHTML = `
            <div class="result-block">
                <div class="rb-title" style="margin-bottom:4px">Inventory setup (Inventory team)</div>
                <div class="muted" style="margin-bottom:14px">The record is live in SAP (ID ${esc(req.sapId)}). Fill in the inventory planning data and submit.</div>
                <form id="inv-form"><div class="form-grid">
                    ${F({ label: 'Material (Material Master Record)', name: 'inv::material', value: req.sapId, readonly: true, hint: 'SAP ID (auto)' })}
                    ${F({ label: 'Plant', name: 'inv::plant', value: req.requesterPlant, readonly: true, hint: 'Auto' })}
                    ${F({ label: 'MRP Group', name: 'inv::mrpGroup', value: p.materialGroup, readonly: true, hint: "From item's data" })}
                    ${F({ label: 'ABC Code', name: 'inv::abcCode', type: 'select', value: inv.abcCode, options: ds.ABC_CODES, required: true })}
                    ${F({ label: 'MRP Type', name: 'inv::mrpType', type: 'select', value: inv.mrpType || p.mrpType, options: ds.MRP_TYPES, required: true, hint: "Auto from item, changeable" })}
                    ${F({ label: 'Reorder point', name: 'inv::reorderPoint', value: inv.reorderPoint, hint: 'Required for Z1+R, VB+N, VB+G' })}
                    ${F({ label: 'Min qty', name: 'inv::mrpControllerMin', value: inv.mrpControllerMin, required: true, hint: 'Numeric' })}
                    ${F({ label: 'Max qty', name: 'inv::mrpControllerMax', value: inv.mrpControllerMax, required: true, hint: 'Numeric' })}
                    ${F({ label: 'Lot-size', name: 'inv::lotSize', type: 'select', value: inv.lotSize, options: ds.LOT_SIZES, required: true })}
                    ${F({ label: 'Fixed lot size', name: 'inv::fixedLotSize', value: inv.fixedLotSize, hint: 'Required for Z1+R' })}
                    ${F({ label: 'Procurement Type', name: 'inv::procurementType', value: 'F', readonly: true, hint: 'Fixed' })}
                    ${F({ label: 'Planned Delivery Time (Days)', name: 'inv::plannedDeliveryDays', value: inv.plannedDeliveryDays, hint: 'Number of days' })}
                    ${F({ label: 'Safety Stock', name: 'inv::safetyStock', value: inv.safetyStock, hint: 'Required for Z1+R' })}
                </div></form>
                <div class="form-actions" style="margin-top:16px">
                    <button class="btn btn-green" data-act="submit-inv">Submit inventory data</button>
                </div>
            </div>`;

        window.UI.bindInvMinMaxRule(zone.querySelector('#inv-form'));

        window.UI.bindActions(zone, {
            'submit-inv': () => {
                const data = collectInventory(zone);
                data.procurementType = 'F';
                const res = validateInventory(data);
                zone.querySelectorAll('.form-input, .form-select').forEach(el => el.classList.remove('error'));
                zone.querySelectorAll('.field-error').forEach(el => el.textContent = '');
                if (!res.ok) {
                    res.errors.forEach(er => {
                        const el = zone.querySelector(`[name="inv::${er.field}"]`); if (el) el.classList.add('error');
                        const errEl = zone.querySelector(`[data-err="inv::${er.field}"]`); if (errEl) errEl.textContent = er.msg;
                    });
                    window.UI.toast({ title: 'Cannot submit', body: 'Some mandatory inventory fields are blank.', kind: 'danger' });
                    return;
                }
                window.Workflow.act(req, 'approve', { inventory: data });
                window.UI.toast({ title: 'Inventory data submitted', body: 'Request completed.', kind: 'info' });
                window.Views.requestDetail(req.id);
            }
        });
    }

    /* ---------------- BULK requests: items card + batch review ---------------- */
    function bulkItemName(req, it) {
        const p = it.payload;
        return req.type === 'category' ? (p.categoryName || '—') : (p.shortName || p.name || '—');
    }
    function bulkItemSub(req, it) {
        const p = it.payload;
        if (req.type === 'category') return 'UNSPSC ' + (p.unspsc || '—') + ' · ' + (p.catAttributes || []).length + ' attributes';
        if (req.type === 'extend') return 'Extend to plant ' + req.requesterPlant + ' — ' + window.UI.plantName(req.requesterPlant);
        return [p.manufacturer, p.mfrPartNo, p.baseUom ? 'UoM ' + p.baseUom : ''].filter(Boolean).join(' · ') || '—';
    }

    // read-only list of the batch items (data zone)
    function bulkItemsCard(req) {
        const rows = (req.items || []).map((it, i) => {
            let status;
            if (it.status === 'Declined') status = `<span class="status-pill declined">Declined</span>` +
                (it.declineComment ? `<div class="muted" style="font-size:11.5px;margin-top:3px">“${esc(it.declineComment)}”</div>` : '');
            else if (req.status === 'Completed') status = `<span class="status-pill completed">Completed</span>` +
                (it.sapId ? `<div class="muted" style="font-size:11.5px;margin-top:3px">SAP ID ${esc(it.sapId)}</div>` : '');
            else status = `<span class="status-pill in-review">In review</span>`;
            const vc = it.payload.valuationClass ? `<div class="muted" style="font-size:11.5px;margin-top:2px">Valuation ${esc(it.payload.valuationClass)}${it.payload.poUnit ? ' · PO unit ' + esc(it.payload.poUnit) : ''}</div>`
                : (it.payload.poUnit ? `<div class="muted" style="font-size:11.5px;margin-top:2px">PO unit ${esc(it.payload.poUnit)}</div>` : '');
            const mg = req.type === 'category' && it.payload.materialGroup ? `<div class="muted" style="font-size:11.5px;margin-top:2px">Material group ${esc(it.payload.materialGroup)}</div>` : '';
            return `<tr>
                <td class="muted">${i + 1}</td>
                <td style="font-weight:600;max-width:250px">${esc(bulkItemName(req, it))}
                    ${it.desc ? `<div class="muted" style="font-size:11.5px;font-weight:400;margin-top:2px">${esc(it.desc)}</div>` : ''}</td>
                <td class="muted" style="font-size:12.5px">${esc(bulkItemSub(req, it))}${vc}${mg}</td>
                <td>${status}</td>
            </tr>`;
        }).join('');
        return `<div class="panel-card"><div class="pc-title">Batch items (${(req.items || []).length})</div>
            <div class="cat-attr-wrap"><table class="data-table">
                <thead><tr><th style="width:34px">#</th><th>Item</th><th>Details</th><th style="width:150px">Status</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div></div>`;
    }

    // approver panel: approve all / approve selection (rest declined) / decline all
    /* ---- shared filter bar inside bulk request tables: text search plus
       category / manufacturer / stage-status dropdowns. Filters only hide rows
       — every in-progress input and checkbox stays intact — and select-all and
       the “apply to shown items” actions operate on the visible rows only. ---- */
    function bulkSearchText(req, it) {
        return esc([bulkItemName(req, it), it.desc || '', bulkItemSub(req, it)].join(' ').toLowerCase());
    }
    function bulkRowAttrs(req, it) {
        return `data-search="${bulkSearchText(req, it)}" data-key="${esc(it.key)}"
            data-f-cat="${esc(it.payload.unspscLabel || it.payload.categoryName || '')}"
            data-f-manu="${esc(it.payload.manufacturer || '')}"`;
    }
    function bulkFilterBarHtml(req, items, statusLabel) {
        const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const cats = uniq(items.map(it => it.payload.unspscLabel || it.payload.categoryName));
        const manus = uniq(items.map(it => it.payload.manufacturer));
        const sel = (key, label, vals) => `<select class="form-select bulk-flt" data-flt="${key}" style="max-width:200px">
            <option value="">${esc(label)}</option>
            ${vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
        </select>`;
        return `<div class="bulk-filter-bar" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px">
            <input type="text" class="form-input bulk-item-search" placeholder="Search items in this request…" style="max-width:240px">
            ${cats.length > 1 ? sel('cat', 'All categories', cats) : ''}
            ${manus.length > 1 ? sel('manu', 'All manufacturers', manus) : ''}
            ${statusLabel ? `<select class="form-select bulk-flt" data-flt="status" style="max-width:200px">
                <option value="">All items</option>
                <option value="pending">${esc(statusLabel)} missing</option>
                <option value="done">${esc(statusLabel)} set</option>
            </select>` : ''}
            <span class="muted bulk-search-note" style="font-size:12.5px"></span>
        </div>`;
    }
    function rowVisible(tr) { return tr.style.display !== 'none'; }
    // statusCheck(tr) → true when the row's stage input is complete (live check,
    // so the “missing/set” filter tracks what the reviewer types)
    function bindBulkFilters(zone, statusCheck) {
        const applyFilters = () => {
            const q = zone.querySelector('.bulk-item-search');
            const term = q ? q.value.trim().toLowerCase() : '';
            const f = {};
            zone.querySelectorAll('select.bulk-flt').forEach(s => { if (s.value) f[s.getAttribute('data-flt')] = s.value; });
            let shown = 0, total = 0;
            zone.querySelectorAll('tr[data-search]').forEach(tr => {
                total += 1;
                let show = !term || tr.getAttribute('data-search').indexOf(term) !== -1;
                if (show && f.cat) show = tr.getAttribute('data-f-cat') === f.cat;
                if (show && f.manu) show = tr.getAttribute('data-f-manu') === f.manu;
                if (show && f.status && statusCheck) {
                    const done = statusCheck(tr);
                    show = f.status === 'done' ? done : !done;
                }
                tr.style.display = show ? '' : 'none';
                if (show) shown += 1;
            });
            const note = zone.querySelector('.bulk-search-note');
            if (note) note.textContent = (term || Object.keys(f).length) ? shown + ' of ' + total + ' item(s) match' : '';
            if (zone.__onBulkFilter) zone.__onBulkFilter(shown, total);
        };
        zone.__applyBulkFilters = applyFilters;
        const q = zone.querySelector('.bulk-item-search');
        if (q) q.addEventListener('input', applyFilters);
        zone.querySelectorAll('select.bulk-flt').forEach(s => s.addEventListener('change', applyFilters));
    }

    function renderBulkReview(root, req, stage, zone) {
        const ds = window.Store.get().datasets;
        const active = window.Workflow.bulkActiveItems(req);
        const needVal = stage.key === 'finance';
        const needPo = stage.key === 'mdm' && req.type === 'create';
        const needMg = stage.key === 'central' && req.type === 'category';
        const isReqApproval = stage.key === 'requester_approval';
        const inputField = needVal ? 'valuationClass' : (needPo ? 'poUnit' : (needMg ? 'materialGroup' : null));
        const inputLabel = needVal ? 'Valuation class' : (needPo ? 'PO unit & conversion' : (needMg ? 'Material group' : ''));
        const options = needVal ? ds.VALUATION_CLASSES.map(v => ({ v: v.code, l: v.code + ' — ' + v.desc }))
            : (needPo ? ds.UOM.map(u => ({ v: u, l: u }))
            : (needMg ? ds.MATERIAL_GROUPS.map(g => ({ v: g.code, l: g.code + ' — ' + g.desc })) : null));

        const rowHtml = (it) => {
            let inputCell = '';
            if (options) {
                const cur = it.payload[inputField] || '';
                // PO unit options follow each item's own base UoM (dimension-compatible
                // units only); a saved incompatible value stays selectable
                let rowOptions = options;
                if (needPo) {
                    rowOptions = window.UI.poUnitOptionsFor(it.payload.baseUom).map(u => ({ v: u, l: u }));
                    if (cur && !rowOptions.some(o => o.v === cur)) rowOptions = [{ v: cur, l: cur + ' — current value' }].concat(rowOptions);
                }
                const sel = `<select class="form-select bulk-pi" data-key="${it.key}">
                    <option value="">Select…</option>
                    ${rowOptions.map(o => `<option value="${esc(o.v)}" ${cur === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}
                </select>`;
                // MDM assigns the PO unit AND its conversion side by side
                inputCell = needPo
                    ? `<td><div style="display:flex;gap:6px;align-items:center">${sel}
                        <input type="number" class="form-input bulk-pf" data-key="${it.key}" min="0.001" step="any"
                            value="${esc(it.payload.poUnitFactor || '')}" placeholder="× ${esc(it.payload.baseUom || 'base')}"
                            title="How many ${esc(it.payload.baseUom || 'base units')} in one PO unit" style="width:86px;flex:0 0 86px">
                       </div></td>
                       <td style="white-space:nowrap"><button class="btn-mini" data-act="bulk-edit-item" data-key="${it.key}">✎ Edit</button></td>`
                    : `<td>${sel}</td>`;
            } else if (isReqApproval) {
                const vc = it.payload.valuationClass;
                inputCell = `<td style="font-weight:600">${esc(vc ? vc + ' — ' + window.UI.valuationDesc(vc) : '—')}</td>`;
            }
            return `<tr ${bulkRowAttrs(req, it)}>
                ${needVal ? '' : `<td><input type="checkbox" class="bulk-sel" data-key="${it.key}" checked></td>`}
                <td style="font-weight:600;max-width:250px">${esc(bulkItemName(req, it))}
                    ${it.desc ? `<div class="muted" style="font-size:11.5px;font-weight:400;margin-top:2px">${esc(it.desc)}</div>` : ''}</td>
                <td class="muted" style="font-size:12.5px">${esc(bulkItemSub(req, it))}</td>
                ${inputCell}
            </tr>`;
        };
        const declinedEarlier = (req.items || []).filter(it => it.status === 'Declined').length;
        const inputHead = options
            ? `<th style="width:${needPo ? 250 : 230}px">${esc(inputLabel)} <span class="req">*</span></th>${needPo ? '<th style="width:70px"></th>' : ''}`
            : (isReqApproval ? '<th style="width:230px">Valuation class (set by Accounting)</th>' : '');

        // Accounting only supplies valuation classes — no approve/decline, just Submit
        const introHtml = needVal
            ? `<div class="muted" style="margin-bottom:12px">Assign a <strong>valuation class</strong> to every item — apply one to all items at once, or set them one by one — then submit. Every item must have a valuation class before you can submit.</div>`
            : `<div class="muted" style="margin-bottom:12px">Approve a selection (unselected items are <strong>declined</strong>), or decline a selection (unselected items are <strong>approved</strong>).
                    A comment is <strong>mandatory</strong> whenever any item is declined.${options ? ' ' + esc(inputLabel) + ' is mandatory for every approved item.' : ''}</div>`;
        const applyAllHtml = needVal
            ? `<div class="bulk-actions-bar" style="margin-bottom:12px">
                    <span class="bab-label">Set for all items</span>
                    <div style="width:280px">
                        <select class="form-select" id="vc-all">
                            <option value="">Select valuation class…</option>
                            ${options.map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}
                        </select>
                    </div>
                    <button class="btn btn-outline btn-sm" data-act="vc-apply-all">Apply to shown items</button>
                    <span class="muted" style="font-size:12px">Applies to the items the filters show. You can still adjust single items below.</span>
               </div>`
            : (needPo
            ? `<div class="bulk-actions-bar" style="margin-bottom:12px">
                    <span class="bab-label">Set for all items</span>
                    <div style="width:160px">
                        <select class="form-select" id="po-all">
                            <option value="">PO unit…</option>
                            ${options.map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}
                        </select>
                    </div>
                    <input type="number" class="form-input" id="pf-all" min="0.001" step="any" placeholder="Conversion" style="max-width:110px" title="How many base units in one PO unit">
                    <button class="btn btn-outline btn-sm" data-act="po-apply-all">Apply to shown items</button>
                    <span class="muted" style="font-size:12px">Applies to the items the filters show. You can still adjust single items below.</span>
               </div>` : '');
        zone.innerHTML = `
            <div class="result-block">
                <div class="rb-title" style="margin-bottom:4px">Your review — ${esc(stage.label)} (${esc(stage.role)}) · bulk request</div>
                ${introHtml}
                ${applyAllHtml}
                ${bulkFilterBarHtml(req, active, needVal ? 'Valuation class' : (needPo ? 'PO unit' : (needMg ? 'Material group' : null)))}
                <div class="cat-attr-wrap"><table class="data-table bulk-review-table">
                    <thead><tr>
                        ${needVal ? '' : '<th style="width:30px"><input type="checkbox" id="bulk-sel-all" checked title="Select all"></th>'}
                        <th>Item</th><th>Details</th>${inputHead}
                    </tr></thead>
                    <tbody>${active.map(rowHtml).join('')}</tbody>
                </table></div>
                ${declinedEarlier ? `<div class="muted" style="margin-top:8px;font-size:12.5px">${declinedEarlier} item(s) were already declined at an earlier stage.</div>` : ''}
                <div class="field" style="margin:14px 0">
                    <label>Comment ${needVal ? '' : '<span class="muted" style="font-weight:400">(mandatory when declining)</span>'}</label>
                    <textarea class="form-textarea" id="review-comment" placeholder="Add a note…"></textarea>
                </div>
                <div class="form-actions">
                    ${needVal
                        ? `<button class="btn btn-green" data-act="bulk-approve">Submit (${active.length} item${active.length === 1 ? '' : 's'})</button>`
                        : `<button class="btn btn-green" data-act="bulk-approve">Approve selected (<span id="bulk-count">${active.length}</span> of ${active.length})</button>
                           <button class="btn btn-danger-outline" data-act="bulk-decline-sel">Decline selected (<span id="bulk-count-d">${active.length}</span> of ${active.length})</button>`}
                </div>
            </div>`;

        const countEl = zone.querySelector('#bulk-count');
        const countElD = zone.querySelector('#bulk-count-d');
        const refreshCount = () => {
            const n = zone.querySelectorAll('.bulk-sel:checked').length;
            if (countEl) countEl.textContent = n;
            if (countElD) countElD.textContent = n;
        };
        const selAll = zone.querySelector('#bulk-sel-all');
        if (selAll) selAll.addEventListener('change', (e) => {
            // when the list is filtered, select-all only touches the visible rows
            zone.querySelectorAll('.bulk-sel').forEach(c => {
                if (c.closest('tr').style.display !== 'none') c.checked = e.target.checked;
            });
            refreshCount();
        });
        bindBulkFilters(zone, inputField ? (tr) => {
            const sel = tr.querySelector('select.bulk-pi');
            if (!sel || !sel.value) return false;
            if (needPo) { const pf = tr.querySelector('.bulk-pf'); return !!(pf && pf.value); }
            return true;
        } : null);
        zone.addEventListener('change', (e) => {
            if (e.target.classList.contains('bulk-sel')) refreshCount();
            // picking a PO unit equal to the item's base UoM prefills the trivial factor of 1
            if (needPo && e.target.classList.contains('bulk-pi')) {
                const key = e.target.getAttribute('data-key');
                const it = active.find(x => x.key === key);
                const pf = zone.querySelector(`.bulk-pf[data-key="${key}"]`);
                if (it && pf && e.target.value && e.target.value === it.payload.baseUom && !pf.value) pf.value = '1';
            }
            // a filled/cleared stage input can change the “missing/set” filter result
            if ((e.target.classList.contains('bulk-pi') || e.target.classList.contains('bulk-pf')) && zone.__applyBulkFilters) {
                zone.__applyBulkFilters();
            }
        });
        // keep the reviewer's in-progress choices when the table re-renders (e.g. after an item edit)
        const persistTableInputs = () => window.Store.set(() => {
            zone.querySelectorAll('select.bulk-pi').forEach(sel => {
                const it = active.find(x => x.key === sel.getAttribute('data-key'));
                if (it && sel.value) it.payload[inputField] = sel.value;
            });
            zone.querySelectorAll('.bulk-pf').forEach(pf => {
                const it = active.find(x => x.key === pf.getAttribute('data-key'));
                if (it && pf.value) it.payload.poUnitFactor = pf.value;
            });
        });

        // custom-dropdown helpers: keep the visible toggle in sync with the
        // hidden native select when we set values or flag errors from code
        const syncSS = (sel) => {
            const wrap = sel.closest('.search-select');
            if (!wrap) return;
            const o = [...sel.options].find(x => x.value === sel.value);
            const lbl = wrap.querySelector('.ss-label');
            if (lbl) { lbl.textContent = (o && sel.value ? o.textContent : 'Select…').trim(); lbl.classList.toggle('ss-placeholder', !sel.value); }
        };
        const errSS = (sel, on) => {
            sel.classList.toggle('error', on);
            const wrap = sel.closest('.search-select');
            const t = wrap && wrap.querySelector('.ss-toggle');
            if (t) t.classList.toggle('error', on);
        };
        const commentEl = () => zone.querySelector('#review-comment');
        // stage-input validation for the items that will be APPROVED — returns
        // the perItem payload, or null (with errors shown) when something is missing
        const collectPerItem = (keys) => {
            const perItem = {};
            if (!options) return perItem;
            let missing = 0;
            keys.forEach(k => {
                const sel = zone.querySelector(`select.bulk-pi[data-key="${k}"]`);
                errSS(sel, false);
                if (!sel.value) { errSS(sel, true); missing += 1; }
                else perItem[k] = { [inputField]: sel.value };
                if (needPo) {
                    // the conversion factor is mandatory alongside the PO unit
                    const pf = zone.querySelector(`.bulk-pf[data-key="${k}"]`);
                    pf.classList.remove('error');
                    if (!pf.value || !(Number(pf.value) > 0)) { pf.classList.add('error'); missing += 1; }
                    else if (perItem[k]) perItem[k].poUnitFactor = pf.value;
                }
            });
            if (missing) {
                window.UI.toast({ title: needVal ? 'Cannot submit' : 'Cannot proceed',
                    body: needVal ? missing + ' item(s) have no valuation class yet — every item needs one before submitting.'
                        : (needPo ? 'PO unit AND its conversion are required for every item that will be approved.'
                                  : inputLabel + ' is required for every item that will be approved.'), kind: 'danger' });
                return null;
            }
            return perItem;
        };
        const needComment = () => {
            const el = commentEl();
            el.classList.add('error'); el.focus();
            window.UI.toast({ title: 'Comment required', body: 'Please write a full sentence — a few words explaining the reason.', kind: 'danger' });
        };
        window.UI.bindActions(zone, {
            'vc-apply-all': () => {
                const all = zone.querySelector('#vc-all');
                if (!all || !all.value) { window.UI.toast({ title: 'Select a valuation class', body: 'Pick the valuation class to apply.', kind: 'danger' }); return; }
                let n = 0;
                zone.querySelectorAll('select.bulk-pi').forEach(sel => {
                    if (!rowVisible(sel.closest('tr'))) return;   // filters scope the action
                    sel.value = all.value; errSS(sel, false); syncSS(sel); n += 1;
                });
                if (zone.__applyBulkFilters) zone.__applyBulkFilters();
                window.UI.toast({ title: 'Applied', body: all.value + ' — ' + window.UI.valuationDesc(all.value) + ' set for ' + n + ' item(s). You can still adjust single items.', kind: 'info' });
            },
            'po-apply-all': () => {
                const unit = zone.querySelector('#po-all');
                const factor = zone.querySelector('#pf-all');
                if (!unit || !unit.value) { window.UI.toast({ title: 'Select a PO unit', body: 'Pick the PO unit to apply.', kind: 'danger' }); return; }
                let n = 0;
                zone.querySelectorAll('select.bulk-pi').forEach(sel => {
                    if (!rowVisible(sel.closest('tr'))) return;   // filters scope the action
                    sel.value = unit.value; errSS(sel, false); syncSS(sel); n += 1;
                });
                zone.querySelectorAll('.bulk-pf').forEach(pf => {
                    if (!rowVisible(pf.closest('tr'))) return;
                    pf.classList.remove('error');
                    if (factor && factor.value) pf.value = factor.value;
                    else {
                        // no shared factor given — items whose base UoM equals the PO unit get the trivial 1
                        const it = active.find(x => x.key === pf.getAttribute('data-key'));
                        if (it && it.payload.baseUom === unit.value && !pf.value) pf.value = '1';
                    }
                });
                if (zone.__applyBulkFilters) zone.__applyBulkFilters();
                window.UI.toast({ title: 'Applied',
                    body: 'PO unit ' + unit.value + (factor && factor.value ? ' with conversion ' + factor.value : '') +
                          ' set for ' + n + ' item(s). You can still adjust single items.', kind: 'info' });
            },
            'bulk-approve': () => {
                // Accounting submits ALL items; other stages act on the selection
                const keys = needVal ? active.map(it => it.key)
                    : [...zone.querySelectorAll('.bulk-sel:checked')].map(c => c.getAttribute('data-key'));
                if (!keys.length) { window.UI.toast({ title: 'Nothing selected', body: 'Select at least one item to approve — or use “Decline all”.', kind: 'danger' }); return; }
                const comment = (commentEl() || {}).value || '';
                if (!needVal && keys.length < active.length && !window.UI.isSentence(comment)) { needComment(); return; }
                const collected = collectPerItem(keys);
                if (!collected) return;
                window.Workflow.actBulk(req, { approveKeys: keys, comment, perItem: collected });
                const declined = active.length - keys.length;
                window.UI.toast(needVal
                    ? { title: 'Submitted', body: 'Valuation classes set for ' + keys.length + ' item(s) — the request moves on for approval.', kind: 'info' }
                    : { title: 'Batch processed', body: keys.length + ' item(s) approved' + (declined ? ', ' + declined + ' declined' : '') + '.', kind: 'info' });
                window.Views.requestDetail(req.id);
            },
            'bulk-decline-sel': () => {
                // declines the SELECTED items; the unselected rest is approved
                const selKeys = [...zone.querySelectorAll('.bulk-sel:checked')].map(c => c.getAttribute('data-key'));
                if (!selKeys.length) { window.UI.toast({ title: 'Nothing selected', body: 'Select at least one item to decline.', kind: 'danger' }); return; }
                const comment = (commentEl() || {}).value || '';
                if (!window.UI.isSentence(comment)) { needComment(); return; }
                const approveKeys = active.filter(it => selKeys.indexOf(it.key) === -1).map(it => it.key);
                const collected = collectPerItem(approveKeys);   // approved remainder still needs its stage inputs
                if (!collected) return;
                window.Workflow.actBulk(req, { approveKeys, comment, perItem: collected });
                window.UI.toast({ title: 'Batch processed',
                    body: selKeys.length + ' item(s) declined' + (approveKeys.length ? ', ' + approveKeys.length + ' approved' : '') + '.', kind: 'info' });
                window.Views.requestDetail(req.id);
            },
            'bulk-edit-item': (t) => {
                const it = active.find(x => x.key === t.getAttribute('data-key'));
                if (!it) return;
                persistTableInputs();   // keep in-progress PO units/factors across the re-render
                const checkedKeys = [...zone.querySelectorAll('.bulk-sel:checked')].map(c => c.getAttribute('data-key'));
                bulkItemEditModal(req, it, () => {
                    renderBulkReview(root, req, stage, zone);
                    // restore the reviewer's selection state
                    zone.querySelectorAll('.bulk-sel').forEach(c => { c.checked = checkedKeys.indexOf(c.getAttribute('data-key')) !== -1; });
                    const cnt = zone.querySelector('#bulk-count');
                    if (cnt) cnt.textContent = zone.querySelectorAll('.bulk-sel:checked').length;
                });
            }
        });
    }

    /* ---------------- Inventory team: bulk inventory setup ----------------
       One modal form serves both flows: set up a single item, or apply the
       same planning data to every MRP-planned item at once. ---- */
    function invFormHtml(inv, mrpTypeDefault) {
        const F = window.UI.field, ds = window.Store.get().datasets;
        inv = inv || {};
        return `<div class="form-grid" id="binv-form">
            ${F({ label: 'ABC Code', name: 'inv::abcCode', type: 'select', value: inv.abcCode, options: ds.ABC_CODES, required: true })}
            ${F({ label: 'MRP Type', name: 'inv::mrpType', type: 'select', value: inv.mrpType || mrpTypeDefault, options: ds.MRP_TYPES, required: true, hint: 'Auto from item, changeable' })}
            ${F({ label: 'Reorder point', name: 'inv::reorderPoint', value: inv.reorderPoint, hint: 'Required for Z1+R, VB+N, VB+G' })}
            ${F({ label: 'Min qty', name: 'inv::mrpControllerMin', value: inv.mrpControllerMin, required: true, hint: 'Numeric' })}
            ${F({ label: 'Max qty', name: 'inv::mrpControllerMax', value: inv.mrpControllerMax, required: true, hint: 'Numeric' })}
            ${F({ label: 'Lot-size', name: 'inv::lotSize', type: 'select', value: inv.lotSize, options: ds.LOT_SIZES, required: true })}
            ${F({ label: 'Fixed lot size', name: 'inv::fixedLotSize', value: inv.fixedLotSize, hint: 'Required for Z1+R' })}
            ${F({ label: 'Planned Delivery Time (Days)', name: 'inv::plannedDeliveryDays', value: inv.plannedDeliveryDays, hint: 'Number of days' })}
            ${F({ label: 'Safety Stock', name: 'inv::safetyStock', value: inv.safetyStock, hint: 'Required for Z1+R' })}
        </div>`;
    }
    function collectInvForm(o) {
        const v = (n) => { const el = o.querySelector(`[name="inv::${n}"]`); return el ? el.value : ''; };
        const inv = {};
        ['abcCode', 'mrpType', 'reorderPoint', 'mrpControllerMin', 'mrpControllerMax',
         'lotSize', 'fixedLotSize', 'plannedDeliveryDays', 'safetyStock'].forEach(n => { inv[n] = v(n); });
        // required: ABC, MRP type, lot-size; Min/Max unless the ND+EX rule disables them
        const minMaxOff = inv.mrpType === 'ND' && inv.lotSize === 'EX';
        const missing = [];
        if (!inv.abcCode) missing.push('ABC Code');
        if (!inv.mrpType) missing.push('MRP Type');
        if (!inv.lotSize) missing.push('Lot-size');
        if (!minMaxOff && !inv.mrpControllerMin) missing.push('Min qty');
        if (!minMaxOff && !inv.mrpControllerMax) missing.push('Max qty');
        if (missing.length) {
            window.UI.toast({ title: 'Missing data', body: missing.join(', ') + ' required.', kind: 'danger' });
            return null;
        }
        return inv;
    }
    function bulkInvModal(req, items, title, onSaved) {
        // shared prefill: when all items carry identical staged data, show it
        const first = items[0].payload.inventory || null;
        window.UI.openModal({
            title, wide: true,
            bodyHtml: `<div class="muted" style="margin-bottom:12px">${items.length === 1
                    ? 'Inventory planning data for this item (SAP ID ' + esc(items[0].sapId || '—') + ', Plant ' + esc(req.requesterPlant || '—') + ').'
                    : 'This planning data will be applied to ALL ' + items.length + ' MRP-planned item(s). You can still adjust single items afterwards.'}</div>
                ${invFormHtml(first, (items[0].payload.mrpType && items[0].payload.mrpType !== 'ND') ? items[0].payload.mrpType : '')}`,
            onOpen: (o) => window.UI.bindInvMinMaxRule(o.querySelector('#binv-form')),
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: items.length === 1 ? 'Save inventory data' : 'Apply to all items', cls: 'btn-green', onClick: (o) => {
                    const inv = collectInvForm(o);
                    if (!inv) return;
                    window.Store.set(() => { items.forEach(it => { it.payload.inventory = Object.assign({}, inv); }); });
                    o.remove();
                    window.UI.toast({ title: 'Inventory data saved', body: items.length === 1
                        ? (items[0].payload.shortName || 'Item') + ' is ready.'
                        : 'Applied to ' + items.length + ' item(s). You can still adjust single items.', kind: 'info' });
                    if (onSaved) onSaved();
                } }
            ]
        });
    }
    function renderBulkInventory(root, req, zone) {
        const active = window.Workflow.bulkActiveItems(req);
        const planned = active.filter(it => (it.payload.mrpType || 'ND') !== 'ND');
        const unplanned = active.length - planned.length;
        const ready = planned.filter(it => it.payload.inventory).length;
        zone.innerHTML = `
            <div class="result-block">
                <div class="rb-title" style="margin-bottom:4px">Inventory setup (Inventory team) · bulk request</div>
                <div class="muted" style="margin-bottom:12px">The records are live in SAP. Set up the planning data for every MRP-planned item — one by one, or once for all — then submit.
                    ${unplanned ? unplanned + ' item(s) are not MRP-planned (ND) and need no inventory data.' : ''}</div>
                <div class="bulk-actions-bar" style="margin-bottom:12px">
                    <span class="bab-label">Set for all items</span>
                    <button class="btn btn-outline btn-sm" data-act="binv-all">⚙ Set up shown items (<span id="binv-all-count">${planned.length}</span>)</button>
                    <span class="muted" style="font-size:12px">Applies to the items the filters show. You can still adjust single items below.</span>
                </div>
                ${bulkFilterBarHtml(req, planned, 'Inventory data')}
                <div class="cat-attr-wrap"><table class="data-table bulk-review-table">
                    <thead><tr><th>Item</th><th>Details</th><th>MRP type</th><th>Inventory data</th><th style="width:100px"></th></tr></thead>
                    <tbody>${planned.map(it => `<tr ${bulkRowAttrs(req, it)}>
                        <td style="font-weight:600;max-width:250px">${esc(bulkItemName(req, it))}
                            <div class="muted" style="font-size:11.5px;font-weight:400;margin-top:2px">SAP ${esc(it.sapId || '—')}</div></td>
                        <td class="muted" style="font-size:12.5px">${esc(bulkItemSub(req, it))}</td>
                        <td>${esc(it.payload.mrpType || '—')}</td>
                        <td>${it.payload.inventory
                            ? '<span class="status-pill approved">✓ Ready</span><div class="muted" style="font-size:11px;margin-top:2px">ABC ' + esc(it.payload.inventory.abcCode || '—') + ' · Lot ' + esc(it.payload.inventory.lotSize || '—') + '</div>'
                            : '<span class="status-pill in-review">Pending</span>'}</td>
                        <td style="white-space:nowrap"><button class="btn-mini" data-act="binv-one" data-key="${it.key}">⚙ Set up</button></td>
                    </tr>`).join('')}</tbody>
                </table></div>
                <div class="form-actions" style="margin-top:14px">
                    <button class="btn btn-green" data-act="binv-submit">Submit inventory data (${ready} of ${planned.length} ready)</button>
                </div>
            </div>`;
        const rerender = () => renderBulkInventory(root, req, zone);
        bindBulkFilters(zone, (tr) => {
            const it = planned.find(x => x.key === tr.getAttribute('data-key'));
            return !!(it && it.payload.inventory);
        });
        zone.__onBulkFilter = (shown) => {
            const c = zone.querySelector('#binv-all-count');
            if (c) c.textContent = shown;
        };
        window.UI.bindActions(zone, {
            'binv-one': (t) => {
                const it = planned.find(x => x.key === t.getAttribute('data-key'));
                if (it) bulkInvModal(req, [it], 'Inventory setup — ' + (it.payload.shortName || 'Item'), rerender);
            },
            'binv-all': () => {
                // filters scope the action: only the visible rows are set up
                const visKeys = [...zone.querySelectorAll('tr[data-search]')].filter(rowVisible).map(tr => tr.getAttribute('data-key'));
                const targets = planned.filter(it => visKeys.indexOf(it.key) !== -1);
                if (!targets.length) { window.UI.toast({ title: 'No items shown', body: 'The current filters hide every item — adjust them first.', kind: 'danger' }); return; }
                bulkInvModal(req, targets, 'Inventory setup — ' + targets.length + ' item(s)', rerender);
            },
            'binv-submit': () => {
                const missing = planned.filter(it => !it.payload.inventory).length;
                if (missing) {
                    window.UI.toast({ title: 'Cannot submit', body: missing + ' item(s) have no inventory data yet — set up every MRP-planned item first.', kind: 'danger' });
                    return;
                }
                window.Workflow.actBulk(req, { approveKeys: active.map(it => it.key), comment: '' });
                window.UI.toast({ title: 'Inventory setup complete', body: planned.length + ' item(s) set up — the bulk request is complete.', kind: 'info' });
                window.Views.requestDetail(req.id);
            }
        });
    }

    /* ---- MDM: edit a single bulk item's data in a modal (everything except
       the long description, which stays AI-generated) ---- */
    function bulkItemEditModal(req, it, onSaved) {
        const F = window.UI.field, ds = window.Store.get().datasets;
        const p = it.payload;
        const cats = ds.CATEGORY_ATTRIBUTES || [];
        const catOpts = cats.map(c => ({ value: c.unspsc, label: c.label + ' — ' + c.unspsc }));
        if (p.unspsc && !cats.some(c => c.unspsc === p.unspsc)) {
            catOpts.unshift({ value: p.unspsc, label: (p.unspscLabel || 'Current category') + ' — ' + p.unspsc });
        }
        window.UI.openModal({
            title: 'Edit item — ' + (p.shortName || it.desc || 'Item'),
            wide: true,
            bodyHtml: `<div class="form-grid" id="bulk-edit-grid">
                ${F({ label: 'Short name', name: 'be::shortName', value: p.shortName, span: 2, required: true })}
                ${F({ label: 'Category', name: 'be::unspscSel', type: 'select', value: p.unspsc, required: true,
                      options: catOpts, hint: 'Sets UNSPSC & material group' })}
                ${F({ label: 'UNSPSC code', name: 'be::unspsc', value: p.unspsc, readonly: true })}
                ${F({ label: 'Material Group', name: 'be::materialGroup', type: 'select', value: p.materialGroup, required: true,
                      options: ds.MATERIAL_GROUPS.map(g => ({ value: g.code, label: g.code + ' — ' + g.desc })) })}
                ${F({ label: 'Part type', name: 'be::matTypeChoice', type: 'select', value: p.matTypeChoice, required: true, options: ds.MATERIAL_TYPE_CHOICES })}
                ${F({ label: 'Manufacturer', name: 'be::manufacturer', value: p.manufacturer, hint: 'Mandatory for OEM' })}
                ${F({ label: 'Manufacturer part #', name: 'be::mfrPartNo', value: p.mfrPartNo, hint: 'Mandatory for OEM' })}
                ${F({ label: 'Base UoM', name: 'be::baseUom', type: 'select', value: p.baseUom, required: true, options: ds.UOM })}
                ${F({ label: 'PO unit', name: 'be::poUnit', type: 'select', value: p.poUnit,
                    options: (p.poUnit && window.UI.poUnitOptionsFor(p.baseUom).indexOf(p.poUnit) === -1)
                        ? [{ value: p.poUnit, label: p.poUnit + ' — current value' }].concat(window.UI.poUnitOptionsFor(p.baseUom))
                        : window.UI.poUnitOptionsFor(p.baseUom) })}
                ${F({ label: 'PO unit conversion', name: 'be::poUnitFactor', value: p.poUnitFactor, hint: 'How many base units in one PO unit' })}
                ${F({ label: 'Storage location', name: 'be::storageLocation', type: 'select', value: p.storageLocation,
                      options: window.UI.storageOptionsFor((p.plants && p.plants[0]) || p.plant || req.requesterPlant) })}
                ${F({ label: 'MRP type', name: 'be::mrpType', type: 'select', value: p.mrpType, options: ds.MRP_TYPES })}
            </div>
            <div class="muted" style="font-size:12px;margin-top:10px">The long description is regenerated automatically from the item data — it cannot be edited.</div>`,
            onOpen: (o) => {
                const sel = o.querySelector('select[name="be::unspscSel"]');
                if (sel) sel.addEventListener('change', () => {
                    const c = cats.find(x => x.unspsc === sel.value);
                    if (!c) return;
                    const set = (n, v) => {
                        const el = o.querySelector(`[name="${n}"]`);
                        if (!el) return;
                        el.value = v;
                        const wrap = el.closest('.search-select');
                        if (wrap && el.tagName === 'SELECT') {
                            const opt = [...el.options].find(x => x.value === String(v));
                            const lbl = wrap.querySelector('.ss-label');
                            if (opt && lbl) { lbl.textContent = opt.textContent.trim(); lbl.classList.remove('ss-placeholder'); }
                        }
                    };
                    set('be::unspsc', c.unspsc);
                    if (c.materialGroup) set('be::materialGroup', c.materialGroup);
                });
            },
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Save changes', cls: 'btn-green', onClick: (o) => {
                    const v = (n) => { const el = o.querySelector(`[name="be::${n}"]`); return el ? el.value : undefined; };
                    if (!String(v('shortName') || '').trim()) {
                        window.UI.toast({ title: 'Missing data', body: 'Short name is required.', kind: 'danger' }); return;
                    }
                    window.Store.set(() => {
                        ['shortName', 'manufacturer', 'mfrPartNo', 'matTypeChoice', 'materialGroup',
                         'baseUom', 'poUnit', 'poUnitFactor', 'storageLocation', 'mrpType'].forEach(f => {
                            const val = v(f);
                            if (val !== undefined) p[f] = val;
                        });
                        const cat = cats.find(x => x.unspsc === v('unspscSel'));
                        if (cat) { p.unspsc = cat.unspsc; p.unspscLabel = cat.label; p.category = cat.label; }
                        if (!p.name || p.name === p.shortName) p.name = p.shortName;
                        // long description stays machine-generated and follows the edits
                        if (window.AI && window.AI.structuredDesc) p.longDesc = window.AI.structuredDesc(p, it.desc).longDesc;
                    });
                    o.remove();
                    window.UI.toast({ title: 'Item updated', body: p.shortName, kind: 'info' });
                    if (onSaved) onSaved();
                } }
            ]
        });
    }

    /* ---------------- Central team: new-category review ---------------- */
    function renderCategoryReview(root, req, zone) {
        const F = window.UI.field;
        const groupOptions = window.UI.ds().MATERIAL_GROUPS.map(g => ({ value: g.code, label: g.code + ' — ' + g.desc }));
        zone.innerHTML = `
            <div class="result-block">
                <div class="rb-title" style="margin-bottom:4px">Your review — Steward review (Central team)</div>
                <div class="muted" style="margin-bottom:14px">Review the proposed category. You may adjust the UNSPSC code, the category name and the attributes before approving. Assign the SAP material group this category maps to — it is mandatory. On approval the category and its attributes are added to the category catalogue.</div>
                <div id="cat-review-editor">${window.UI.categoryEditorHtml(req.payload, { commodityPicker: true })}</div>
                <div style="max-width:460px;margin-top:16px">
                    ${F({ label: 'Material group', name: 'cat::materialGroup', type: 'select', required: true,
                          value: req.payload.materialGroup || '', options: groupOptions,
                          placeholder: 'Select material group…', hint: 'SAP material group this category maps to' })}
                </div>
                <div class="field" style="margin:8px 0 14px">
                    <label>Comment</label>
                    <textarea class="form-textarea" id="review-comment" placeholder="Add a note…"></textarea>
                </div>
                <div class="form-actions">
                    <button class="btn btn-green" data-act="approve">Approve & add to catalog</button>
                    <button class="btn btn-danger-outline" data-act="decline">Decline</button>
                </div>
            </div>`;
        const ed = zone.querySelector('#cat-review-editor');
        window.UI.bindCategoryEditor(ed);
        window.UI.bindActions(zone, {
            'approve': () => {
                const data = window.UI.collectCategoryEditor(ed);
                if (!window.UI.validateCategoryEditor(ed, data)) { window.UI.toast({ title: 'Cannot approve', body: 'Please complete the category details.', kind: 'danger' }); return; }
                // material group is mandatory — the catalog entry must map to one
                const mg = zone.querySelector('[name="cat::materialGroup"]');
                data.materialGroup = mg ? mg.value : '';
                if (!data.materialGroup) {
                    if (mg) {
                        mg.classList.add('error');
                        const w = mg.closest('.search-select');
                        const t = w && w.querySelector('.ss-toggle');
                        if (t) t.classList.add('error');
                    }
                    const err = zone.querySelector('[data-err="cat::materialGroup"]');
                    if (err) err.textContent = 'Material group is required.';
                    window.UI.toast({ title: 'Cannot approve', body: 'Please select the material group for this category.', kind: 'danger' });
                    return;
                }
                const comment = (zone.querySelector('#review-comment') || {}).value || '';
                window.Workflow.act(req, 'approve', { comment, edits: data });
                window.UI.toast({ title: 'Category added to the catalog', body: `“${data.categoryName}” (UNSPSC ${data.unspsc}) is now available.`, kind: 'info' });
                window.Views.requestDetail(req.id);
            },
            'decline': () => doDecline(req, zone, 'decline')
        });
    }

    function collectInventory(zone) {
        const inv = {};
        zone.querySelectorAll('#inv-form [name^="inv::"]').forEach(el => { inv[el.getAttribute('name').slice(5)] = el.value.trim(); });
        return inv;
    }

    // mandatory: ABC Code, MRP Type, MRP Controller min & max, Lot-size.
    // conditional: Z1+R → reorder point, fixed lot size, safety stock; VB+N and VB+G → reorder point.
    function validateInventory(inv) {
        const errors = [];
        const req = (k, label) => { if (!inv[k] || String(inv[k]).trim() === '') errors.push({ field: k, msg: (label || k) + ' is required.' }); };
        req('abcCode', 'ABC Code');
        req('mrpType', 'MRP Type');
        // ND + EX → Min/Max levels are not applicable (disabled in the form)
        if (!(inv.mrpType === 'ND' && inv.lotSize === 'EX')) {
            req('mrpControllerMin', 'Min qty');
            req('mrpControllerMax', 'Max qty');
        }
        req('lotSize', 'Lot-size');
        const z1r = inv.mrpType === 'Z1' && inv.abcCode === 'R';
        const vbn = inv.mrpType === 'VB' && inv.abcCode === 'N';
        const vbg = inv.mrpType === 'VB' && inv.abcCode === 'G';
        if (z1r || vbn || vbg) req('reorderPoint', 'Reorder point');
        if (z1r) { req('fixedLotSize', 'Fixed lot size'); req('safetyStock', 'Safety Stock'); }
        return { ok: errors.length === 0, errors };
    }

    window.Views.requestDetail = function (id) {
        const req = window.Store.requestById(id);
        const root = document.getElementById('view');
        if (!req) { root.innerHTML = `<div class="page-narrow"><div class="empty-state">Request not found.</div></div>`; return; }

        const s = window.Store.session();
        const stage = window.Workflow.currentStage(req);
        const awaitingMe = window.Workflow.isAwaiting(req, s.currentRole);
        const isMyRequest = req.requesterUser === s.currentUser && s.currentRole === 'Requester';
        const statusCls = req.status === 'Completed' ? 'completed' : (req.status === 'Approved' ? 'approved' : (req.status === 'Declined' ? 'declined' : (req.status === 'Draft' ? 'draft' : 'in-review')));

        const feedback = (req.aiFeedback && req.aiFeedback.length)
            ? `<div class="banner warn"><span class="banner-icon">✦</span><div class="banner-body">
                <div class="banner-title">AI feedback captured at submission</div>
                <ul style="margin:6px 0 0 18px">${req.aiFeedback.map(w => `<li>${esc(w.msg)}</li>`).join('')}</ul></div></div>` : '';

        const p = req.payload || {};
        const noImg = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#C9CCC6" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
        const stageNow = req.status === 'Draft' ? 'Not submitted'
            : (req.status === 'Declined' ? 'Returned to requester'
            : (req.status === 'Completed' ? 'All steps completed'
            : (stage ? stage.label + ' — ' + stage.role : '—')));

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> ›
                <span class="crumb-link" data-act="back">Requests</span> › ${esc(window.Workflow.reqNo(req))}</div>
            <div class="page-full">
                <div class="req-head">
                    <div>
                        <div class="req-eyebrow">${esc(window.Workflow.typeLabel(req.type))} · ${esc(window.Workflow.reqNo(req))}</div>
                        <h1 class="req-title">${esc(p.shortName || req.title)}</h1>
                    </div>
                    <div class="req-head-right">
                        <span class="status-pill ${statusCls}">${esc(req.status)}</span>
                        ${req.sapId ? `<span class="sap-chip">SAP ID ${esc(req.sapId)}</span>` : ''}
                    </div>
                </div>

                ${req.v2
                    ? `<div class="panel-card tracker-card">${window.UI.bulkTracker(req)}</div>`
                    : `<div class="panel-card tracker-card">${window.UI.workflowTracker(req)}</div>`}
                ${feedback}

                <div class="req-layout">
                    <div class="req-main">
                        <div id="action-zone"></div>
                        <div id="data-zone">${req.v2 ? '' : (req.bulk ? bulkItemsCard(req) : (req.type === 'category' ? categoryCards(p) : dataCards(p)))}</div>
                    </div>
                    <aside class="req-side">
                        <div class="panel-card">
                            <div class="pc-title">Summary</div>
                            ${(req.type === 'category' || req.bulk) ? '' : `<div class="side-photo">${p.image ? `<img src="${esc(p.image)}" alt="Item photo">` : noImg}</div>`}
                            <div class="def-grid one-col">
                                ${defRow('Current stage', stageNow)}
                                ${defRow('Requester', req.requesterUser)}
                                ${defRow('Plant', req.requesterPlant + ' — ' + window.UI.plantName(req.requesterPlant))}
                                ${defRow('Created', window.UI.nowLabel(req.createdTs))}
                                ${req.sapId ? defRow('SAP ID', req.sapId) : ''}
                            </div>
                            ${req.materialId || req.sapId ? `<button class="btn btn-green-outline btn-sm" style="width:100%;margin-top:12px" data-act="view-item">View material record</button>` : ''}
                        </div>
                        <div class="panel-card">
                            <div class="pc-title">Activity</div>
                            ${window.UI.historyList(req)}
                        </div>
                    </aside>
                </div>
            </div>`;

        if (req.v2) {
            // v2 bulk requests: the per-line worklist IS the page
            window.Views.bulkLinesPanel(root, req);
            if (req.type === 'bulk_create' && req.jobId && !req.catalogDone) window.BulkFlow.armCatalogPoller(req.id);
        } else {
            renderActionZone(root, req, stage, awaitingMe, isMyRequest);
        }

        window.UI.bindActions(root, {
            'home': () => window.UI.go('#/master'),
            'back': () => window.UI.go('#/inbox'),
            'view-item': () => {
                const mid = req.materialId || (window.Store.materials().find(m => m.sapId === req.sapId) || {}).id;
                if (mid) window.UI.go('#/item/' + mid);
            }
        });
    };

    function renderActionZone(root, req, stage, awaitingMe, isMyRequest) {
        const zone = root.querySelector('#action-zone');

        // ---- bulk requests: batch banners & batch review ----
        if (req.bulk) {
            const items = req.items || [];
            const declinedN = items.filter(it => it.status === 'Declined').length;
            const doneN = items.length - declinedN;
            if (req.status === 'Declined') {
                const last = [...req.history].reverse().find(h => h.action === 'declined');
                if (!isMyRequest) {
                    zone.innerHTML = `<div class="banner danger"><span class="banner-icon">↩️</span><div class="banner-body">
                        <div class="banner-title">Bulk request declined</div>
                        ${last && last.comment ? '“' + esc(last.comment) + '”' : ''} The requester can fix the items and resubmit.</div></div>`;
                    return;
                }
                // requester: fix the declined items right here and resubmit
                const renderFix = (checkedKeys) => {
                    const declined = (req.items || []).filter(it => it.status === 'Declined');
                    const canEdit = req.type === 'create';
                    zone.innerHTML = `
                        <div class="banner danger"><span class="banner-icon">↩️</span><div class="banner-body">
                            <div class="banner-title">Declined by ${esc(last ? last.actorRole : 'reviewer')} — fix the items and resubmit</div>
                            ${last && last.comment ? '“' + esc(last.comment) + '”' : 'Please review the items and resubmit.'}</div></div>
                        <div class="result-block" style="margin-top:14px">
                            <div class="rb-title" style="margin-bottom:4px">Fix &amp; resubmit</div>
                            <div class="muted" style="margin-bottom:12px">${canEdit ? 'Edit the declined items below, then' : 'Select the items to resubmit, then'} send them back to review — it continues from the stage that declined them, earlier approvals stay valid.</div>
                            ${bulkFilterBarHtml(req, declined, null)}
                            <div class="cat-attr-wrap"><table class="data-table bulk-review-table">
                                <thead><tr>
                                    <th style="width:30px"><input type="checkbox" id="bfx-all" checked title="Select all"></th>
                                    <th>Item</th><th>Details</th><th>Decline reason</th>${canEdit ? '<th style="width:70px"></th>' : ''}
                                </tr></thead>
                                <tbody>${declined.map(it => `<tr ${bulkRowAttrs(req, it)}>
                                    <td><input type="checkbox" class="bfx-sel" data-key="${it.key}" ${!checkedKeys || checkedKeys.indexOf(it.key) !== -1 ? 'checked' : ''}></td>
                                    <td style="font-weight:600;max-width:250px">${esc(bulkItemName(req, it))}
                                        ${it.desc ? `<div class="muted" style="font-size:11.5px;font-weight:400;margin-top:2px">${esc(it.desc)}</div>` : ''}</td>
                                    <td class="muted" style="font-size:12.5px">${esc(bulkItemSub(req, it))}</td>
                                    <td class="muted" style="font-size:12.5px;max-width:220px">${esc(it.declineComment || (last && last.comment) || '—')}</td>
                                    ${canEdit ? `<td style="white-space:nowrap"><button class="btn-mini" data-act="bfx-edit" data-key="${it.key}">✎ Edit</button></td>` : ''}
                                </tr>`).join('')}</tbody>
                            </table></div>
                            <div class="form-actions" style="margin-top:14px">
                                <button class="btn btn-green" data-act="bfx-resubmit">Resubmit selected (<span id="bfx-count">${declined.length}</span> of ${declined.length})</button>
                            </div>
                        </div>`;
                    const refresh = () => { zone.querySelector('#bfx-count').textContent = zone.querySelectorAll('.bfx-sel:checked').length; };
                    zone.querySelector('#bfx-all').addEventListener('change', (e) => {
                        zone.querySelectorAll('.bfx-sel').forEach(c => {
                            if (c.closest('tr').style.display !== 'none') c.checked = e.target.checked;
                        });
                        refresh();
                    });
                    bindBulkFilters(zone, null);
                    zone.addEventListener('change', (e) => { if (e.target.classList.contains('bfx-sel')) refresh(); });
                    refresh();
                    window.UI.bindActions(zone, {
                        'bfx-edit': (t) => {
                            const it = declined.find(x => x.key === t.getAttribute('data-key'));
                            if (!it) return;
                            const keep = [...zone.querySelectorAll('.bfx-sel:checked')].map(c => c.getAttribute('data-key'));
                            bulkItemEditModal(req, it, () => renderFix(keep));
                        },
                        'bfx-resubmit': () => {
                            const keys = [...zone.querySelectorAll('.bfx-sel:checked')].map(c => c.getAttribute('data-key'));
                            if (!keys.length) { window.UI.toast({ title: 'Nothing selected', body: 'Select at least one item to resubmit.', kind: 'danger' }); return; }
                            window.Workflow.resubmitBulk(req, keys);
                            window.UI.toast({ title: 'Resubmitted', body: keys.length + ' item(s) are back in review — continuing from the stage that declined them.', kind: 'info' });
                            window.Views.requestDetail(req.id);
                        }
                    });
                };
                renderFix(null);
                return;
            }
            if (req.status === 'Completed') {
                zone.innerHTML = `<div class="banner match"><span class="banner-icon">✓</span><div class="banner-body">
                    <div class="banner-title">Bulk request completed</div>
                    ${doneN} item(s) ${req.type === 'create' ? 'created in the material master' : (req.type === 'extend' ? 'extended to plant ' + esc(req.requesterPlant) : 'added to the category catalogue')}${declinedN ? ' · ' + declinedN + ' item(s) declined along the way' : ''}. Per-item results are listed below.</div></div>`;
                return;
            }
            if (!awaitingMe) {
                const st = window.Workflow.currentStage(req);
                zone.innerHTML = `<div class="banner info"><span class="banner-icon">⏳</span><div class="banner-body">
                    ${window.Workflow.bulkActiveItems(req).length} item(s) awaiting <strong>${esc(st ? st.role : '')}</strong> (${esc(st ? st.label : '')}).
                    ${window.Store.session().currentRole === 'Requester' ? 'You will be notified when it progresses.' : 'You are acting as ' + esc(window.Store.session().currentRole) + '; switch role to act on this.'}</div></div>`;
                return;
            }
            if (stage.key === 'inventory') { renderBulkInventory(root, req, zone); return; }
            renderBulkReview(root, req, stage, zone);
            return;
        }

        // Requester view of a declined request → edit & resubmit
        if (isMyRequest && req.status === 'Declined') {
            const lastDecline = [...req.history].reverse().find(h => h.action === 'declined');
            if (req.type === 'category') {
                zone.innerHTML = `<div class="banner danger"><span class="banner-icon">↩️</span><div class="banner-body">
                        <div class="banner-title">Declined by ${esc(lastDecline ? lastDecline.actorRole : 'reviewer')} — please fix and resubmit</div>
                        ${lastDecline && lastDecline.comment ? '“' + esc(lastDecline.comment) + '”' : 'Please review and resubmit.'}</div></div>
                    <div class="result-block" style="margin-top:14px">
                        <div class="rb-title" style="margin-bottom:10px">Fix your category proposal</div>
                        <div id="cat-fix-editor">${window.UI.categoryEditorHtml(req.payload)}</div>
                        <div class="form-actions" style="margin-top:16px"><button class="btn btn-green" data-act="resubmit-cat">Resubmit request</button></div>
                    </div>`;
                const ed = zone.querySelector('#cat-fix-editor');
                window.UI.bindCategoryEditor(ed);
                window.UI.bindActions(zone, {
                    'resubmit-cat': () => {
                        const data = window.UI.collectCategoryEditor(ed);
                        if (!window.UI.validateCategoryEditor(ed, data)) { window.UI.toast({ title: 'Cannot resubmit', body: 'Please complete the category details.', kind: 'danger' }); return; }
                        window.Workflow.resubmit(req, Object.assign({ name: data.categoryName, shortName: data.categoryName }, data));
                        window.UI.toast({ title: 'Resubmitted', body: 'Your category proposal is back with the Central team.' });
                        window.Views.requestDetail(req.id);
                    }
                });
                return;
            }
            zone.innerHTML = `<div class="banner danger"><span class="banner-icon">↩️</span><div class="banner-body">
                    <div class="banner-title">Declined by ${esc(lastDecline ? lastDecline.actorRole : 'reviewer')} — please fix and resubmit</div>
                    ${lastDecline && lastDecline.comment ? '“' + esc(lastDecline.comment) + '”' : 'Please review and resubmit.'}</div>
                <div class="banner-actions">
                    ${req.type === 'create' || req.type === 'amend' ? `<button class="btn btn-green btn-sm" data-act="edit-resubmit">Edit & resubmit</button>` : `<button class="btn btn-green btn-sm" data-act="resubmit">Resubmit</button>`}
                </div></div>`;
            window.UI.bindActions(zone, {
                'edit-resubmit': () => {
                    window.Views._draft = { type: req.type, payload: req.payload, materialId: req.materialId,
                        resubmitId: req.id, analysis: { known: true } };
                    window.UI.go('#/request/new?type=' + req.type);
                },
                'resubmit': () => { window.Workflow.resubmit(req); window.UI.toast({ title: 'Resubmitted', body: 'Back in review.' }); window.Views.requestDetail(req.id); }
            });
            return;
        }

        // Draft owned by requester
        if (isMyRequest && req.status === 'Draft') {
            zone.innerHTML = `<div class="banner info"><span class="banner-icon">📝</span><div class="banner-body">This request is a draft.</div>
                <div class="banner-actions">
                    <button class="btn btn-green btn-sm" data-act="edit-draft">Continue editing</button>
                    <button class="btn btn-danger-outline btn-sm" data-act="delete-draft">Delete draft</button>
                </div></div>`;
            window.UI.bindActions(zone, {
                'edit-draft': () => {
                    window.Views._draft = { type: req.type, payload: req.payload, materialId: req.materialId, resubmitId: req.id, analysis: { known: true } };
                    window.UI.go('#/request/new?type=' + req.type);
                },
                'delete-draft': () => confirmDeleteDraft(req, () => window.UI.go('#/inbox'))
            });
            return;
        }

        if (req.status === 'Completed') {
            if (req.type === 'category') {
                const p = req.payload;
                const central = window.Store.session().currentRole === 'Central team';
                zone.innerHTML = `<div class="banner match"><span class="banner-icon">✓</span><div class="banner-body">
                    <div class="banner-title">Category added to the catalog</div>“${esc(p.categoryName)}” (UNSPSC ${esc(p.unspsc)}) with ${(p.catAttributes || []).length} attributes is now available for item classification.</div>
                    ${central ? `<div class="banner-actions"><button class="btn btn-green-outline btn-sm" data-act="view-catalog">View category catalogue</button></div>` : ''}</div>`;
                window.UI.bindActions(zone, { 'view-catalog': () => window.UI.go('#/categories') });
                return;
            }
            zone.innerHTML = `<div class="banner match"><span class="banner-icon">✓</span><div class="banner-body">
                <div class="banner-title">Completed</div>SAP responded with ID <strong>${esc(req.sapId)}</strong>. The material record has been ${verb(req.type)}.</div>
                ${req.materialId || true ? `<div class="banner-actions"><button class="btn btn-green-outline btn-sm" data-act="view-item">View record</button></div>` : ''}</div>`;
            window.UI.bindActions(zone, { 'view-item': () => {
                const mid = req.materialId || (window.Store.materials().find(m => m.sapId === req.sapId) || {}).id;
                if (mid) window.UI.go('#/item/' + mid);
            }});
            return;
        }

        if (!awaitingMe) {
            const st = window.Workflow.currentStage(req);
            // SAP done, item approved & live — only the Inventory task remains open
            if (req.status === 'Approved') {
                zone.innerHTML = `<div class="banner match"><span class="banner-icon">✓</span><div class="banner-body">
                    <div class="banner-title">Item approved</div>SAP responded with ID <strong>${esc(req.sapId)}</strong> — the record is live in the material master.
                    Inventory setup by the <strong>Inventory team</strong> is still pending, but does not hold the item.</div>
                    <div class="banner-actions"><button class="btn btn-green-outline btn-sm" data-act="view-item">View record</button></div></div>`;
                window.UI.bindActions(zone, { 'view-item': () => {
                    const mid = req.materialId || (window.Store.materials().find(m => m.sapId === req.sapId) || {}).id;
                    if (mid) window.UI.go('#/item/' + mid);
                }});
                return;
            }
            zone.innerHTML = `<div class="banner info"><span class="banner-icon">⏳</span><div class="banner-body">
                Awaiting <strong>${esc(st ? st.role : '')}</strong> (${esc(st ? st.label : '')}). ${window.Store.session().currentRole === 'Requester' ? 'You will be notified when it progresses.' : 'You are acting as ' + esc(window.Store.session().currentRole) + '; switch role to act on this.'}</div></div>`;
            return;
        }

        // ---- Inventory team: post-SAP inventory setup form ----
        if (stage.key === 'inventory') { renderInventoryPanel(root, req, zone); return; }

        // ---- Central team: new-category review (editable proposal) ----
        if (req.type === 'category' && stage.key === 'central') { renderCategoryReview(root, req, zone); return; }

        // ---- awaiting the current role: render the action panel ----
        const ds = window.Store.get().datasets;
        let extra = '';
        if (stage.key === 'finance') {
            // a request bounced back by the requester carries their decline note — surface it
            const lastNo = [...(req.history || [])].reverse().find(h => h.action === 'declined');
            const bounced = lastNo && /returned to (Finance|Accounting)/.test(lastNo.text || '');
            extra = `${bounced ? `<div class="banner warn mb-0" style="margin-bottom:12px"><span class="banner-icon">↩️</span><div class="banner-body">
                <div class="banner-title">Declined by ${esc(lastNo.actorUser)} (Requester)</div>“${esc(lastNo.comment || '')}” — please select the valuation class again.</div></div>` : ''}
                <div class="field" style="max-width:420px;margin-bottom:14px">
                <label>Valuation Class <span class="req">*</span></label>
                <select class="form-select" id="valclass">
                    <option value="">Select valuation class…</option>
                    ${ds.VALUATION_CLASSES.map(v => `<option value="${v.code}" ${req.payload.valuationClass === v.code ? 'selected' : ''}>${v.code} — ${esc(v.desc)}</option>`).join('')}
                </select>
                <div class="field-error" id="valclass-err"></div></div>`;
        }
        if (stage.key === 'requester_approval') {
            const vc = req.payload.valuationClass;
            extra = `<div class="banner info mb-0" style="margin-bottom:12px"><span class="banner-icon">💰</span><div class="banner-body">
                <div class="banner-title">Accounting selected valuation class ${esc(vc ? vc + ' — ' + window.UI.valuationDesc(vc) : '—')}</div>
                ${req.type === 'valuation'
                    ? 'Approve to apply the new valuation class in SAP, or decline with a note (mandatory) to return it to Accounting.'
                    : 'Approve to send the request to Technical review, or decline with a note (mandatory) to return it to Accounting.'}</div></div>`;
        }
        if (stage.key === 'mdm' && (req.type === 'create' || req.type === 'amend')) {
            extra = `<div class="banner info mb-0" style="margin-bottom:12px"><span class="banner-icon">✎</span><div class="banner-body">You may edit any field below before approving.</div></div>
                ${editableGrid(req.payload, req)}`;
        }
        // extend: MDM only accepts or declines — no item fields to edit
        if (stage.key === 'mdm' && req.type === 'extend') {
            const m = req.materialId ? window.Store.materialById(req.materialId) : null;
            const from = (m && m.plants && m.plants.length) ? m.plants.map(pc => window.UI.plantLabel(pc)).join(', ') : '—';
            extra = `<div class="banner info mb-0" style="margin-bottom:12px"><span class="banner-icon">↗</span><div class="banner-body">
                <div class="banner-title">Plant extension request</div>
                ${esc(req.requesterUser)} requests extending this item to plant <strong>${esc(window.UI.plantLabel(req.requesterPlant))}</strong>.
                Currently in: ${esc(from)}. Approve to update SAP, or decline with a note.</div></div>`;
        }

        // Accounting only supplies the valuation class — it cannot decline
        const canDecline = stage.key !== 'finance';
        zone.innerHTML = `
            <div class="result-block">
                <div class="rb-title" style="margin-bottom:10px">Your review — ${esc(stage.label)} (${esc(stage.role)})</div>
                ${extra}
                <div class="field" style="margin-bottom:14px">
                    <label>Comment</label>
                    <textarea class="form-textarea" id="review-comment" placeholder="Add a note…"></textarea>
                </div>
                <div class="form-actions">
                    <button class="btn btn-green" data-act="approve">${stage.key === 'finance' ? 'Submit' : 'Approve'}</button>
                    ${canDecline ? '<button class="btn btn-danger-outline" data-act="decline">Decline</button>' : ''}
                </div>
            </div>`;

        // category picked from the catalog → keep UNSPSC mirror, hidden label
        // fields and the material group in sync (same behavior as the create form)
        const catSel = zone.querySelector('#mdm-edit select[name="unspscSel"]');
        if (catSel) catSel.addEventListener('change', () => {
            const c = (window.Store.get().datasets.CATEGORY_ATTRIBUTES || []).find(x => x.unspsc === catSel.value);
            if (!c) return;
            const set = (n, v) => {
                const el = zone.querySelector(`#mdm-edit [name="${n}"]`);
                if (!el) return;
                el.value = v;
                const wrap = el.closest('.search-select');
                if (wrap && el.tagName === 'SELECT') {
                    const o = [...el.options].find(x => x.value === String(v));
                    const lbl = wrap.querySelector('.ss-label');
                    if (o && lbl) { lbl.textContent = o.textContent.trim(); lbl.classList.remove('ss-placeholder'); }
                }
            };
            set('unspsc', c.unspsc);
            set('unspscLabel', c.label);
            set('category', c.label);
            if (c.materialGroup) set('materialGroup', c.materialGroup);
            // load the new category's attribute schema, keeping values whose
            // attribute names carry over
            const az = zone.querySelector('#mdm-attr-zone');
            if (az) {
                const vals = window.UI.collectAttrEditor(az, az.getAttribute('data-unspsc'));
                az.innerHTML = window.UI.attrEditorHtml(c.unspsc, vals, req.payload.recordType === 'Sourcing record');
                az.setAttribute('data-unspsc', c.unspsc);
            }
        });

        // first selected plant drives the storage-location options (like the form)
        zone.addEventListener('change', (e) => {
            if (!e.target.classList || !e.target.classList.contains('mdm-plant')) return;
            const holder = zone.querySelector('#mdm-storage-holder');
            if (!holder) return;
            const first = zone.querySelector('.mdm-plant:checked');
            const cur = zone.querySelector('#mdm-edit [name="storageLocation"]');
            holder.innerHTML = mdmStorageFieldHtml(first ? first.value : '', cur ? cur.value : '');
        });

        // PO unit ↔ base UoM ↔ conversion: the PO unit list follows the selected
        // base UoM (dimension-compatible units only), the hint always names the
        // two units, and picking the same unit as the base UoM prefills the
        // trivial factor of 1. Delegated: the PO field is rebuilt on UoM change.
        const syncFactor = () => {
            const baseSel = zone.querySelector('#mdm-edit select[name="baseUom"]');
            const poSel = zone.querySelector('#mdm-edit select[name="poUnit"]');
            const factorInp = zone.querySelector('#mdm-edit [name="poUnitFactor"]');
            if (!poSel || !factorInp) return;
            const base = (baseSel && baseSel.value) || req.payload.baseUom || 'base units';
            const po = poSel.value;
            const hint = factorInp.closest('.field').querySelector('.hint');
            if (hint) hint.textContent = po ? `How many ${base} in one ${po}` : 'How many base units in one PO unit';
            if (po && po === ((baseSel && baseSel.value) || req.payload.baseUom) && !factorInp.value) factorInp.value = '1';
        };
        if (zone.querySelector('#mdm-edit')) {
            zone.addEventListener('change', (e) => {
                const n = e.target.getAttribute && e.target.getAttribute('name');
                if (n === 'baseUom') {
                    const holder = zone.querySelector('#mdm-pounit-holder');
                    const poSel = zone.querySelector('#mdm-edit select[name="poUnit"]');
                    // keep the chosen PO unit only if it fits the new base UoM
                    const keep = (poSel && window.UI.poUnitOptionsFor(e.target.value).indexOf(poSel.value) !== -1) ? poSel.value : '';
                    if (holder) holder.innerHTML = mdmPoUnitFieldHtml(e.target.value, keep);
                    if (!keep) { const f = zone.querySelector('#mdm-edit [name="poUnitFactor"]'); if (f) f.value = ''; }
                    syncFactor();
                } else if (n === 'poUnit') {
                    syncFactor();
                }
            });
            syncFactor();
        }

        window.UI.bindActions(zone, {
            'approve': () => {
                const comment = (zone.querySelector('#review-comment') || {}).value || '';
                const data = { comment };
                if (stage.key === 'finance') {
                    const vc = zone.querySelector('#valclass').value;
                    if (!vc) { zone.querySelector('#valclass-err').textContent = 'Valuation class is required.'; zone.querySelector('#valclass').classList.add('error'); return; }
                    data.valuationClass = vc;
                }
                if (stage.key === 'mdm' && (req.type === 'create' || req.type === 'amend')) {
                    data.edits = collectEdits(root);
                    // PO unit is assigned by MDM and mandatory before approving
                    if (!data.edits.poUnit) {
                        const native = root.querySelector('#mdm-edit [name="poUnit"]');
                        if (native) {
                            native.classList.add('error');
                            const w = native.closest('.search-select');
                            const t = w && w.querySelector('.ss-toggle');
                            if (t) t.classList.add('error');
                        }
                        const err = root.querySelector('#mdm-edit [data-err="poUnit"]');
                        if (err) err.textContent = 'PO unit is required.';
                        window.UI.toast({ title: 'Cannot approve', body: 'Please select the PO unit before approving.', kind: 'danger' });
                        return;
                    }
                    // the conversion factor is mandatory alongside the PO unit
                    const f = data.edits.poUnitFactor;
                    if (!f || !(Number(f) > 0)) {
                        const inp = root.querySelector('#mdm-edit [name="poUnitFactor"]');
                        if (inp) inp.classList.add('error');
                        const err = root.querySelector('#mdm-edit [data-err="poUnitFactor"]');
                        if (err) err.textContent = 'Enter how many base units one PO unit contains.';
                        window.UI.toast({ title: 'Cannot approve', body: `Please provide the PO unit conversion — how many ${data.edits.baseUom || 'base units'} in one ${data.edits.poUnit}.`, kind: 'danger' });
                        return;
                    }
                    // everything is editable here — approving must not blank out a
                    // mandatory field or a mandatory technical attribute
                    root.querySelectorAll('#mdm-edit .error, #mdm-attr-zone .error').forEach(el => el.classList.remove('error'));
                    root.querySelectorAll('#mdm-edit .field-error, #mdm-attr-zone .field-error').forEach(el => el.textContent = '');
                    const merged = Object.assign({}, req.payload, data.edits);
                    const res = window.AI.validate(merged);
                    if (!res.ok) {
                        res.blocking.forEach(b => {
                            const el = root.querySelector(`#mdm-edit [name="${CSS.escape(b.field)}"], #mdm-attr-zone [name="${CSS.escape(b.field)}"]`);
                            if (el) {
                                el.classList.add('error');
                                const w = el.closest('.search-select');
                                const t = w && w.querySelector('.ss-toggle');
                                if (t) t.classList.add('error');
                            }
                            const err = root.querySelector(`[data-err="${CSS.escape(b.field)}"]`);
                            if (err) err.textContent = b.msg;
                        });
                        window.UI.toast({ title: 'Cannot approve', body: `${res.blocking.length} mandatory field(s) must be completed before approving.`, kind: 'danger' });
                        return;
                    }
                }
                window.Workflow.act(req, 'approve', data);
                window.UI.toast({ title: stage.key === 'finance' ? 'Submitted' : 'Approved', body: nextMsg(req), kind: 'info' });
                window.Views.requestDetail(req.id);
            },
            'decline': () => doDecline(req, zone, 'decline')
        });
    }

    // shared draft-delete confirmation (also used by the inbox)
    function confirmDeleteDraft(req, after) {
        window.UI.openModal({
            title: 'Delete draft',
            bodyHtml: `<p>Delete draft <strong>${esc(req.payload && req.payload.shortName || req.title)}</strong> (${esc(window.Workflow.reqNo(req))})?<br>
                <span class="muted">This cannot be undone.</span></p>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Delete draft', cls: 'btn-danger-outline', onClick: (o) => {
                    o.remove();
                    if (window.Workflow.deleteDraft(req.id)) {
                        window.UI.toast({ title: 'Draft deleted', body: req.payload && req.payload.shortName || req.title, kind: 'danger' });
                        if (after) after();
                    }
                } }
            ]
        });
    }
    window.Views.confirmDeleteDraft = confirmDeleteDraft;

    function doDecline(req, zone, action) {
        const comment = (zone.querySelector('#review-comment') || {}).value || '';
        if (!window.UI.isSentence(comment)) {
            window.UI.toast({ title: 'Comment required', body: 'Please write a full sentence — a few words explaining the reason.', kind: 'danger' });
            const ta = zone.querySelector('#review-comment'); if (ta) { ta.classList.add('error'); ta.focus(); }
            return;
        }
        // the requester declining the valuation class returns it to Accounting, not to themselves
        const st = window.Workflow.currentStage(req);
        const toAccounting = st && st.key === 'requester_approval';
        window.Workflow.act(req, action, { comment });
        window.UI.toast({ title: action === 'correction' ? 'Sent for correction' : 'Declined',
            body: toAccounting ? 'Returned to Accounting with your note.' : 'Returned to the requester.', kind: 'info' });
        window.Views.requestDetail(req.id);
    }

    function nextMsg(req) {
        if (req.status === 'Completed') return 'Request completed — SAP ID ' + req.sapId + '.';
        const st = window.Workflow.currentStage(req);
        return st ? 'Forwarded to ' + st.role + '.' : 'Advanced.';
    }
    function verb(type) {
        return { create: 'created', amend: 'updated', extend: 'extended to your plant', block: 'blocked at plant level',
            reactivate: 'reactivated', block_proc: 'blocked for procurement', block_total: 'totally blocked', unblock_central: 'unblocked',
            valuation: 'updated (valuation class)' }[type] || 'processed';
    }
})();
