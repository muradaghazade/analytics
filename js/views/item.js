/* ============================================================
   views/item.js — material master detail page
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);

    function defRow(label, val, span) {
        return `<div class="def-row ${span ? 'span-2' : ''}"><div class="def-k">${esc(label)}</div><div class="def-v">${esc((val === undefined || val === null || val === '') ? '—' : val)}</div></div>`;
    }

    window.Views.item = function (id) {
        const m = window.Store.materialById(id);
        const root = document.getElementById('view');
        if (!m) { root.innerHTML = `<div class="page-narrow"><div class="empty-state">Item not found.</div></div>`; return; }

        const sess = window.Store.session();
        const myPlant = sess.plant;
        const role = sess.currentRole;
        const inMyPlant = (m.plants || []).indexOf(myPlant) !== -1;
        const blockStatus = m.blockStatus || null;
        const centralBlocked = blockStatus === 'Procurement block' || blockStatus === 'Total block';
        const plantBlocked = blockStatus === 'Plant block';

        // role-aware actions (unchanged behavior)
        const actions = [];
        if (role === 'Central team') {
            if (!centralBlocked) {
                actions.push({ act: 'block-proc', label: '⛔ Block for Procurement' });
                actions.push({ act: 'block-total', label: '🚫 Total block' });
            } else {
                actions.push({ act: 'unblock-central', label: '♻ Remove ' + blockStatus.toLowerCase() });
            }
        } else if (role === 'Accounting') {
            // Accounting may only change the valuation class — instantly, no approval
            actions.push({ act: 'change-valuation', label: '✎ Change valuation class' });
        } else if (role === 'Inventory team') {
            // Inventory team maintains inventory planning data directly — instantly, no approval
            actions.push({ act: 'edit-inventory', label: '✎ Edit inventory data' });
        } else if (role === 'MDM Specialist') {
            // MDM amends items directly — edited, saved and logged with no approval chain
            if (!blockStatus) actions.push({ act: 'amend', label: '✎ Edit item (direct, no approval)' });
        } else {
            // extendable when the requester has access to any plant the item is not in yet
            const u = (window.Store.get().users || []).find(x => x.name === sess.currentUser);
            const myPlants = (u && u.plants && u.plants.length) ? u.plants : [myPlant];
            if (myPlants.some(pc => (m.plants || []).indexOf(pc) === -1)) actions.push({ act: 'extend', label: '↗ Extend to plant' });
            if (inMyPlant && !blockStatus) actions.push({ act: 'amend', label: '✎ Amend' });
            if (inMyPlant && !blockStatus) actions.push({ act: 'block', label: '⛔ Block (my plant)' });
            if (inMyPlant && plantBlocked) actions.push({ act: 'reactivate', label: '♻ Reactivate' });
        }
        // approved, unblocked items can go into the sourcing shopping cart —
        // not in the SOCAR workspace, which has no cart functionality
        if ((m.itemStatus || 'Approved') === 'Approved' && !blockStatus && !window.UI.isSocar()) {
            actions.unshift({ act: 'add-cart', label: '🛒 Add to cart' });
        }
        actions.push({ act: 'history', label: '⤺ History' });

        const statusCls = { 'Approved': 'approved', 'In review': 'in-review', 'Draft': 'draft' }[m.itemStatus] || 'approved';
        const noImg = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C9CCC6" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
        const mrp = m.mrpEnabled ? `${m.mrpEnabled}${m.mrpType ? ' — ' + m.mrpType : ''}` : '—';

        const identMeta = [
            { k: 'SAP ID', v: m.sapId },
            { k: 'dmp ID', v: m.dmpId },
            { k: 'Category · UNSPSC', v: (m.unspscLabel || m.category) ? (m.unspscLabel || m.category) + (m.unspsc ? ' · ' + m.unspsc : '') : '' },
            { k: 'Material group', v: m.materialGroup ? m.materialGroup + ' — ' + window.UI.groupDesc(m.materialGroup) : '' },
            { k: 'Base UoM', v: m.baseUom },
            { k: 'PO unit', v: m.poUnit && m.poUnitFactor ? `${m.poUnit} — 1 ${m.poUnit} = ${m.poUnitFactor} ${m.baseUom || ''}` : m.poUnit },
            { k: 'Storage location', v: m.storageLocation }
        ];

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="back">Material Master</span> › ${esc(m.shortName || m.name)}</div>
            <div class="page-full" style="padding-bottom:0">
                <div class="detail-hero detail-top-plain">
                    <div class="detail-img"><div class="detail-img-inner">${m.image ? `<img src="${m.image}" alt="">` : noImg}</div></div>
                    <div class="detail-main">
                        <div class="detail-title-row">
                            <h1 class="detail-title">${esc(m.shortName || m.name)}</h1>
                            <div class="detail-pills">
                                <span class="status-pill ${statusCls}">${esc(m.itemStatus)}</span>
                                ${blockStatus ? `<span class="status-pill blocked">${esc(blockStatus)}</span>` : ''}
                                ${m.sapId ? `<span class="sap-badge" title="Up to date with SAP — material number ${esc(m.sapId)}">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><polyline points="20 6 9 17 4 12"/></svg>
                                    Synced with SAP</span>`
                                : `<span class="sap-badge sap-badge-pending" title="Not yet recorded in SAP">Not in SAP yet</span>`}
                            </div>
                        </div>
                        <div class="detail-desc">${esc(m.longDesc || '')}</div>
                        <div class="mc-meta-grid detail-ident">
                            ${identMeta.map(x => `<div class="mc-meta"><span class="k">${esc(x.k)}</span><span class="v" title="${esc(x.v || '')}">${esc(x.v || '—')}</span></div>`).join('')}
                        </div>
                        <div class="mc-plants detail-plants">
                            <span class="plants-label">Plant${(m.plants || []).length > 1 ? 's' : ''} - </span>
                            ${(m.plants || []).map(pc => `<span class="plant-chip">${esc(window.UI.plantLabel(pc))}</span>`).join('') || '<span class="muted" style="font-size:12px">—</span>'}
                        </div>
                    </div>
                    <div class="detail-actions">
                        ${actions.map(a => `<button data-act="${a.act}">${esc(a.label)}</button>`).join('')}
                    </div>
                </div>
            </div>
            <div class="page-full" style="padding-top:20px">

                <div class="panel-card">
                    <div class="pc-title">Product details</div>
                    <div class="def-grid">
                        ${defRow('Manufacturer', m.manufacturer)}
                        ${defRow('Manufacturer part #', m.mfrPartNo)}
                        ${m.prevMfrPartNo ? defRow('Previous part number', m.prevMfrPartNo) : ''}
                        ${defRow('Model', m.model)}
                        ${defRow('Part type', m.matTypeChoice)}
                        ${defRow('Material Type (SAP)', m.materialType || 'ROH')}
                        ${defRow('MRP planning', mrp)}
                        ${defRow('Batch-managed', m.batchManaged)}
                        ${defRow('Record type', m.recordType)}
                        ${defRow('Valuation class', m.valuationClass ? m.valuationClass + ' — ' + window.UI.valuationDesc(m.valuationClass) : '')}
                    </div>
                </div>

                <div class="panel-card">
                    <div class="pc-title">Technical Details</div>
                    ${Object.keys(m.attributes || {}).length
                        ? `<div class="def-grid">${Object.entries(m.attributes).map(([k, v]) => defRow(k, v)).join('')}</div>`
                        : '<div class="muted">No technical attributes.</div>'}
                </div>

                ${(m.documents && m.documents.length) ? `<div class="panel-card"><div class="pc-title">Supporting documents</div>${window.UI.docListHtml(m.documents)}</div>` : ''}

                ${inventoryCardHtml(m, role)}
            </div>`;

        window.UI.bindActions(root, {
            'back': () => window.UI.go('#/master'),
            'add-cart': () => window.UI.addToCart(m.id),
            'history': () => window.UI.go('#/item/' + m.id + '/history'),
            'extend': () => { window.Views._draft = { type: 'extend', materialId: m.id }; window.UI.go('#/request/new?type=extend&mat=' + m.id); },
            'amend': () => { window.Views._draft = { type: 'amend', materialId: m.id }; window.UI.go('#/request/new?type=amend&mat=' + m.id); },
            'block': () => { window.Views._draft = { type: 'block', materialId: m.id }; window.UI.go('#/request/new?type=block&mat=' + m.id); },
            'reactivate': () => { window.Views._draft = { type: 'reactivate', materialId: m.id }; window.UI.go('#/request/new?type=reactivate&mat=' + m.id); },
            'change-valuation': () => valuationModal(m),
            'edit-inventory': () => inventoryModal(m, invSelectedPlant(m)),
            'inv-tab': (t) => { INV_TAB[m.id] = t.getAttribute('data-p'); window.Views.item(m.id); },
            'inv-add': (t) => inventoryModal(m, t.getAttribute('data-p')),
            'block-proc': () => centralAction(m, 'block_proc'),
            'block-total': () => centralAction(m, 'block_total'),
            'unblock-central': () => centralAction(m, 'unblock_central')
        });
    };

    /* ================= item change history page ================= */
    function fmtDate(ts) {
        const d = new Date(ts);
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    window.Views.itemHistory = function (id) {
        const m = window.Store.materialById(id);
        const root = document.getElementById('view');
        if (!m) { root.innerHTML = `<div class="page-narrow"><div class="empty-state">Item not found.</div></div>`; return; }

        const log = (m.changelog || []).slice().reverse();   // newest first

        const eventCard = (e) => `
            <div class="panel-card hist-event">
                <div class="hist-head">
                    <div class="hist-action">${esc(e.action)}</div>
                    <div class="hist-meta">
                        <span class="hist-user">${esc(e.user)}</span>
                        <span class="role-chip">${esc(e.role)}</span>
                        <span class="hist-date">${fmtDate(e.ts)}</span>
                    </div>
                </div>
                ${e.changes && e.changes.length ? `
                    <table class="data-table attr-table hist-table">
                        <thead><tr><th>Field</th><th>Old value</th><th>New value</th></tr></thead>
                        <tbody>${e.changes.map(c => `
                            <tr>
                                <td style="font-weight:600">${esc(c.field)}</td>
                                <td class="hist-old">${c.from ? esc(c.from) : '<span class="muted">—</span>'}</td>
                                <td class="hist-new">${c.to ? esc(c.to) : '<span class="muted">—</span>'}</td>
                            </tr>`).join('')}</tbody>
                    </table>` : `<div class="muted" style="font-size:13.5px">No field-level changes recorded for this event.</div>`}
            </div>`;

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="back">Material Master</span> ›
                <span class="crumb-link" data-act="to-item">${esc(m.shortName || m.name)}</span> › History</div>
            <div class="page-full">
                <div class="form-header" style="margin-bottom:14px">
                    <div>
                        <h2 style="font-size:22px;font-weight:600">Change history — ${esc(m.shortName || m.name)}</h2>
                        <div class="muted" style="font-size:14px;margin-top:3px">Every change to this record: when it happened, who made it, and each field's old and new value. · SAP ID ${esc(m.sapId || '—')} · dmp ID ${esc(m.dmpId)}</div>
                    </div>
                    <button class="btn btn-outline" data-act="to-item">‹ Back to item</button>
                </div>
                ${log.length ? log.map(eventCard).join('') : `
                    <div class="inbox-empty">
                        <div style="font-size:26px">🕓</div>
                        <div style="font-weight:600;margin-top:10px;font-size:15px">No changes recorded yet</div>
                        <div class="muted" style="font-size:14px;margin-top:3px">This record came from the initial master data load and has not been modified since. Future amendments, extensions, blocks and inventory updates will appear here.</div>
                    </div>`}
            </div>`;

        window.UI.bindActions(root, {
            'back': () => window.UI.go('#/master'),
            'to-item': () => window.UI.go('#/item/' + m.id)
        });
    };

    // Accounting: change the valuation class only — instant, no approval chain
    function valuationModal(m) {
        const vcs = window.Store.get().datasets.VALUATION_CLASSES;
        window.UI.openModal({
            title: 'Change valuation class',
            bodyHtml: `<p class="muted" style="margin-bottom:12px">“${esc(m.shortName || m.name)}” (SAP ID ${esc(m.sapId || '—')}). Only the valuation class will change — the requester must approve the new class before SAP is updated.</p>
                <div class="field"><label>Valuation Class <span class="req">*</span></label>
                    <select class="form-select" id="vc-select">
                        ${vcs.map(v => `<option value="${esc(v.code)}" ${m.valuationClass === v.code ? 'selected' : ''}>${esc(v.code + ' — ' + v.desc)}</option>`).join('')}
                    </select></div>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Apply change', cls: 'btn-green', onClick: (o) => {
                    const vc = o.querySelector('#vc-select').value;
                    if (vc === m.valuationClass) { window.UI.toast({ title: 'No change', body: 'The item already has this valuation class.', kind: 'info' }); return; }
                    o.remove();
                    const req = window.Workflow.createRequest({ type: 'valuation', payload: { shortName: m.shortName, valuationClass: vc }, materialId: m.id });
                    // Accounting's own selection stage completes immediately — the
                    // request then awaits the requester's approval before SAP
                    window.Workflow.act(window.Store.requestById(req.id), 'approve', { valuationClass: vc });
                    window.UI.toast({ title: 'Sent for approval', body: window.Workflow.reqNo(req) + ' — the requester must approve the new valuation class before SAP is updated.', kind: 'info' });
                    window.Views.item(m.id);
                } }
            ]
        });
    }

    /* ---- per-plant inventory planning (view + tabs) ----
       Inventory data lives per plant. A user whose plant access covers only
       one of the item's plants sees that plant's data; users with access to
       several plants (and plant-unrestricted roles) switch between plants
       with tabs. */
    const INV_TAB = {};
    function invVisiblePlants(m) {
        const sess = window.Store.session();
        // Inventory and Central teams maintain data across all plants
        if (sess.currentRole === 'Inventory team' || sess.currentRole === 'Central team') return m.plants || [];
        const u = (window.Store.get().users || []).find(x => x.name === sess.currentUser);
        const userPlants = (u && u.plants && u.plants.length) ? u.plants : [sess.plant];
        const mine = (m.plants || []).filter(p => userPlants.indexOf(p) !== -1);
        return mine.length ? mine : (m.plants || []);
    }
    function invSelectedPlant(m) {
        const vis = invVisiblePlants(m);
        const sel = INV_TAB[m.id];
        return (sel && vis.indexOf(sel) !== -1) ? sel : vis[0];
    }
    function inventoryCardHtml(m, role) {
        const vis = invVisiblePlants(m);
        if (!vis.length) return '';
        const sel = invSelectedPlant(m);
        const inv = window.UI.invFor(m, sel);
        const anyData = vis.some(p => window.UI.invFor(m, p));
        if (!anyData && role !== 'Inventory team') return '';
        const tabs = vis.length > 1
            ? `<div class="bulk-summary" style="margin:2px 0 10px">${vis.map(p =>
                `<span class="bulk-sum ${p === sel ? 'approved' : ''}" data-act="inv-tab" data-p="${esc(p)}"
                    style="cursor:pointer${p === sel ? ';outline:2px solid var(--primary-green)' : ''}">${esc(p)} — ${esc(window.UI.plantName(p))}${window.UI.invFor(m, p) ? '' : ' · no data'}</span>`).join('')}</div>`
            : `<div class="muted" style="font-size:12px;margin-bottom:8px">Plant ${esc(sel)} — ${esc(window.UI.plantName(sel))}</div>`;
        const body = inv
            ? window.UI.inventoryRows(inv)
            : `<div class="muted" style="margin-bottom:8px">No inventory data for this plant yet.</div>` +
              (role === 'Inventory team' ? `<button class="btn btn-outline btn-sm" data-act="inv-add" data-p="${esc(sel)}">+ Add inventory data</button>` : '');
        return `<div class="panel-card"><div class="pc-title">Inventory planning</div>${tabs}${body}</div>`;
    }

    // Inventory team: maintain the item's inventory planning data — instant, no approval chain.
    // Same field set and conditional rules as the create-flow Inventory setup stage.
    function inventoryModal(m, plant) {
        const F = window.UI.field, ds = window.Store.get().datasets;
        plant = plant || invSelectedPlant(m) || (m.plants || [])[0] || '';
        const inv = window.UI.invFor(m, plant) || {};
        window.UI.openModal({
            title: 'Edit inventory data — Plant ' + plant,
            wide: true,
            bodyHtml: `<p class="muted" style="margin-bottom:14px">“${esc(m.shortName || m.name)}” (SAP ID ${esc(m.sapId || '—')}) · Plant ${esc(plant)} — ${esc(window.UI.plantName(plant))}. Changes are saved directly to the material record via SAP — no approval is required.</p>
                <form id="inv-form"><div class="form-grid">
                    ${F({ label: 'Material (Material Master Record)', name: 'inv::material', value: m.sapId, readonly: true, hint: 'SAP ID (auto)' })}
                    ${F({ label: 'Plant', name: 'inv::plant', value: plant, readonly: true, hint: 'Inventory data is per plant' })}
                    ${F({ label: 'MRP Group', name: 'inv::mrpGroup', value: m.materialGroup, readonly: true, hint: "From item's data" })}
                    ${F({ label: 'ABC Code', name: 'inv::abcCode', type: 'select', value: inv.abcCode, options: ds.ABC_CODES, required: true })}
                    ${F({ label: 'MRP Type', name: 'inv::mrpType', type: 'select', value: inv.mrpType || m.mrpType, options: ds.MRP_TYPES, required: true, hint: 'Auto from item, changeable' })}
                    ${F({ label: 'Reorder point', name: 'inv::reorderPoint', value: inv.reorderPoint, hint: 'Required for Z1+R, VB+N, VB+G' })}
                    ${F({ label: 'Min qty', name: 'inv::mrpControllerMin', value: inv.mrpControllerMin, required: true, hint: 'Numeric' })}
                    ${F({ label: 'Max qty', name: 'inv::mrpControllerMax', value: inv.mrpControllerMax, required: true, hint: 'Numeric' })}
                    ${F({ label: 'Lot-size', name: 'inv::lotSize', type: 'select', value: inv.lotSize, options: ds.LOT_SIZES, required: true })}
                    ${F({ label: 'Fixed lot size', name: 'inv::fixedLotSize', value: inv.fixedLotSize, hint: 'Required for Z1+R' })}
                    ${F({ label: 'Procurement Type', name: 'inv::procurementType', value: 'F', readonly: true, hint: 'Fixed' })}
                    ${F({ label: 'Planned Delivery Time (Days)', name: 'inv::plannedDeliveryDays', value: inv.plannedDeliveryDays, hint: 'Number of days' })}
                    ${F({ label: 'Safety Stock', name: 'inv::safetyStock', value: inv.safetyStock, hint: 'Required for Z1+R' })}
                </div></form>`,
            onOpen: (o) => window.UI.bindInvMinMaxRule(o.querySelector('#inv-form')),
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Save inventory data', cls: 'btn-green', onClick: (o) => {
                    const data = {};
                    o.querySelectorAll('#inv-form [name^="inv::"]').forEach(el => { data[el.getAttribute('name').slice(5)] = el.value.trim(); });
                    data.procurementType = 'F';
                    const res = validateInventory(data);
                    o.querySelectorAll('.form-input, .form-select').forEach(el => el.classList.remove('error'));
                    o.querySelectorAll('.field-error').forEach(el => el.textContent = '');
                    if (!res.ok) {
                        res.errors.forEach(er => {
                            const el = o.querySelector(`[name="inv::${er.field}"]`); if (el) el.classList.add('error');
                            const errEl = o.querySelector(`[data-err="inv::${er.field}"]`); if (errEl) errEl.textContent = er.msg;
                        });
                        window.UI.toast({ title: 'Cannot save', body: 'Some mandatory inventory fields are blank.', kind: 'danger' });
                        return;
                    }
                    o.remove();
                    const req = window.Workflow.createRequest({ type: 'inventory_update', payload: { shortName: m.shortName, inventory: data }, materialId: m.id });
                    window.UI.toast({ title: 'Inventory data saved', body: 'SAP confirmed (' + window.Workflow.reqNo(req) + ').', kind: 'info' });
                    window.Views.item(m.id);
                } }
            ]
        });
    }

    // mandatory: ABC Code, MRP Type, MRP Controller min & max, Lot-size.
    // conditional: Z1+R → reorder point, fixed lot size, safety stock; VB+N and VB+G → reorder point.
    function validateInventory(inv) {
        const errors = [];
        const need = (k, label) => { if (!inv[k] || String(inv[k]).trim() === '') errors.push({ field: k, msg: (label || k) + ' is required.' }); };
        need('abcCode', 'ABC Code');
        need('mrpType', 'MRP Type');
        // ND + EX → Min/Max levels are not applicable (disabled in the form)
        if (!(inv.mrpType === 'ND' && inv.lotSize === 'EX')) {
            need('mrpControllerMin', 'Min qty');
            need('mrpControllerMax', 'Max qty');
        }
        need('lotSize', 'Lot-size');
        const z1r = inv.mrpType === 'Z1' && inv.abcCode === 'R';
        const vbn = inv.mrpType === 'VB' && inv.abcCode === 'N';
        const vbg = inv.mrpType === 'VB' && inv.abcCode === 'G';
        if (z1r || vbn || vbg) need('reorderPoint', 'Reorder point');
        if (z1r) { need('fixedLotSize', 'Fixed lot size'); need('safetyStock', 'Safety Stock'); }
        return { ok: errors.length === 0, errors };
    }

    // Central team blocks/unblock: instant — confirm dialog, then straight to SAP, no approval chain
    function centralAction(m, type) {
        const label = window.Workflow.typeLabel(type);
        window.UI.openModal({
            title: label,
            bodyHtml: `<p>Apply <strong>${esc(label)}</strong> to “${esc(m.shortName || m.name)}” (SAP ID ${esc(m.sapId || '—')})?<br>
                <span class="muted">This takes effect immediately via SAP — no approval is required.</span></p>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Confirm', cls: type === 'unblock_central' ? 'btn-green' : 'btn-danger-outline', onClick: (o) => {
                    o.remove();
                    const req = window.Workflow.createRequest({ type, payload: { shortName: m.shortName }, materialId: m.id });
                    window.UI.toast({ title: label + ' applied', body: 'SAP confirmed (' + window.Workflow.reqNo(req) + ').', kind: type === 'unblock_central' ? 'info' : 'danger' });
                    window.Views.item(m.id);
                } }
            ]
        });
    }
})();
