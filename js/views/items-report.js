/* ============================================================
   views/items-report.js — Created items report (Central team)
   Every item in the master with its full creation story: who
   requested it, who approved it, when it was initiated and when
   it landed in the master — plus the item's change history.
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);

    const S = { q: '', plant: '', cat: '', record: [], creators: [], approver: '', source: [],
                attrs: {}, addedFrom: '', addedTo: '', initFrom: '', initTo: '', collapsed: false };

    function filtersActive() {
        return !!(S.q.trim() || S.plant || S.cat || S.record.length || S.creators.length || S.approver || S.source.length ||
                  Object.keys(S.attrs).length || S.addedFrom || S.addedTo || S.initFrom || S.initTo);
    }

    // schema of the selected category filter — same as the Material Master page
    function selectedCategorySchema() {
        if (!S.cat) return null;
        return (window.Store.get().datasets.CATEGORY_ATTRIBUTES || []).find(c => c.label === S.cat) || null;
    }
    function attrFiltersHtml() {
        const schema = selectedCategorySchema();
        if (!schema || !schema.attributes.length) return '';
        const fa = S.attrs;
        const controls = schema.attributes.map(a => {
            const t = a.fieldType || 'Text';
            const cur = fa[a.name] || {};
            const uom = a.uom ? ` <span class="attr-uom">(${esc(a.uom.toLowerCase())})</span>` : '';
            if (t === 'Number' || t === 'Range') {
                return `<div class="af-row"><div class="af-label">${esc(a.name)}${uom}</div>
                    <div class="af-minmax">
                        <input class="form-input af-num" type="number" step="any" placeholder="Min" data-attr-num="${esc(a.name)}" data-bound="min" value="${esc(cur.min ?? '')}">
                        <span class="muted">–</span>
                        <input class="form-input af-num" type="number" step="any" placeholder="Max" data-attr-num="${esc(a.name)}" data-bound="max" value="${esc(cur.max ?? '')}">
                    </div></div>`;
            }
            if (t === 'List' || t === 'Yes/No') {
                const opts = t === 'Yes/No' ? ['Yes', 'No'] : window.UI.optionList(a.options);
                return `<div class="af-row"><div class="af-label">${esc(a.name)}</div>
                    <select class="filter-select" data-attr-sel="${esc(a.name)}">
                        <option value="">Any</option>
                        ${opts.map(o => `<option value="${esc(o)}" ${cur.val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
                    </select></div>`;
            }
            return `<div class="af-row"><div class="af-label">${esc(a.name)}${uom}</div>
                <input class="form-input" type="text" placeholder="Contains…" data-attr-text="${esc(a.name)}" value="${esc(cur.text || '')}"></div>`;
        }).join('');
        return `<div class="filter-section attr-filters">
            <div class="filter-title">${esc(schema.label)} attributes</div>
            ${controls}
        </div>`;
    }
    function matchesAttrFilters(attrs) {
        const fa = S.attrs;
        const keys = Object.keys(fa);
        if (!keys.length) return true;
        attrs = attrs || {};
        return keys.every(name => {
            const f = fa[name];
            const raw = attrs[name];
            if (f.min !== undefined || f.max !== undefined) {
                const n = parseFloat(String(raw === undefined ? '' : raw).replace(',', '.'));
                if (isNaN(n)) return false;
                if (f.min !== undefined && n < f.min) return false;
                if (f.max !== undefined && n > f.max) return false;
                return true;
            }
            if (f.val !== undefined) return String(raw || '').toLowerCase().indexOf(String(f.val).toLowerCase()) !== -1;
            if (f.text !== undefined) return String(raw || '').toLowerCase().indexOf(String(f.text).toLowerCase()) !== -1;
            return true;
        });
    }
    // ts within a [from, to] date range (inclusive whole days); rows without a
    // timestamp (seeded items) drop out as soon as either bound is set
    function tsInRange(ts, from, to) {
        if (!from && !to) return true;
        if (!ts) return false;
        if (from && ts < new Date(from + 'T00:00:00').getTime()) return false;
        if (to && ts > new Date(to + 'T23:59:59.999').getTime()) return false;
        return true;
    }

    /* ---- build one report row per master item ---- */
    function findCreate(m, reqs) {
        for (const r of reqs) {
            if (r.type !== 'create') continue;
            if (!r.bulk && r.materialId === m.id) return r;
            if (r.bulk && (r.items || []).some(it => it.materialId === m.id)) return r;
        }
        const c0 = (m.changelog || [])[0];
        if (c0 && c0.reqId) {
            const rid = String(c0.reqId).split(':')[0];
            const r = reqs.find(x => x.id === rid && x.type === 'create');
            if (r) return r;
        }
        return null;
    }
    function buildRows() {
        const reqs = window.Store.requests();
        return window.Store.materials().map(m => {
            const r = findCreate(m, reqs);
            let approvers = [], initiated = null, completed = null;
            if (r) {
                initiated = r.createdTs;
                const done = (r.history || []).find(h => h.actorRole === 'System' && h.action === 'completed');
                completed = done ? done.ts : (r.status === 'Completed' && r.history && r.history.length ? r.history[r.history.length - 1].ts : null);
                const seen = new Set();
                (r.history || []).forEach(h => {
                    if (h.action !== 'approved') return;
                    const key = (h.actorUser || '—') + '·' + (h.actorRole || '');
                    if (!seen.has(key)) { seen.add(key); approvers.push({ user: h.actorUser || '—', role: h.actorRole || '' }); }
                });
            }
            return { m, r, approvers, initiated, completed, seeded: !r };
        });
    }

    function fmtDate(ts) {
        return ts ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    }

    function matches(row) {
        const m = row.m;
        const q = S.q.trim().toLowerCase();
        if (q) {
            const hay = [m.shortName, m.name, m.longDesc, m.sapId, m.dmpId, m.manufacturer, m.mfrPartNo,
                row.r ? row.r.requesterUser : ''].filter(Boolean).join(' ').toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        if (S.plant && (m.plants || []).indexOf(S.plant) === -1) return false;
        if (S.cat && (m.unspscLabel || m.category) !== S.cat) return false;
        if (S.record.length) {
            const rt = m.recordType === 'Sourcing record' ? 'Sourcing record' : 'Golden record';
            if (S.record.indexOf(rt) === -1) return false;
        }
        if (!matchesAttrFilters(m.attributes)) return false;
        if (S.creators.length && (!row.r || S.creators.indexOf(row.r.requesterUser) === -1)) return false;
        if (S.approver && !row.approvers.some(a => a.user === S.approver)) return false;
        if (!tsInRange(row.completed, S.addedFrom, S.addedTo)) return false;
        if (!tsInRange(row.initiated, S.initFrom, S.initTo)) return false;
        return true;
    }

    /* ---- sidebar ---- */
    function sidebarHtml(rows) {
        const plants = [...new Set(rows.flatMap(x => x.m.plants || []))].sort();
        const cats = [...new Set(rows.map(x => x.m.unspscLabel || x.m.category).filter(Boolean))].sort();
        const creators = [...new Set(rows.map(x => x.r && x.r.requesterUser).filter(Boolean))].sort();
        const approvers = [...new Set(rows.flatMap(x => x.approvers.map(a => a.user)).filter(Boolean))].sort();
        const cb = (group, val, label) => `<label class="checkbox-label"><input type="checkbox" data-ir-filter="${group}" value="${esc(val)}" ${S[group].indexOf(val) !== -1 ? 'checked' : ''}> ${esc(label || val)}</label>`;
        return `<aside class="sidebar ${S.collapsed ? 'collapsed' : ''}">
            <div class="sidebar-collapse-icon" data-act="toggle-sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
            </div>
            <div class="filter-section first">
                <div class="filter-title">Plant</div>
                <select class="filter-select" id="ir-plant">
                    <option value="">All plants</option>
                    ${plants.map(p => `<option value="${esc(p)}" ${S.plant === p ? 'selected' : ''}>${esc(p + ' — ' + window.UI.plantName(p))}</option>`).join('')}
                </select>
            </div>
            <div class="filter-section">
                <div class="filter-title">Category</div>
                <select class="filter-select" id="ir-cat">
                    <option value="">All categories</option>
                    ${cats.map(c => `<option value="${esc(c)}" ${S.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                </select>
            </div>
            ${attrFiltersHtml()}
            <div class="filter-section">
                <div class="filter-title">Record type</div>
                <div class="checkbox-group">
                    ${cb('record', 'Golden record', 'Golden record (complete)')}
                    ${cb('record', 'Sourcing record', 'Sourcing record (incomplete)')}
                </div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Created by</div>
                <div class="checkbox-group">${creators.map(u => cb('creators', u)).join('') || '<span class="muted" style="font-size:12px">No request-created items.</span>'}</div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Approved by</div>
                <select class="filter-select" id="ir-approver">
                    <option value="">Anyone</option>
                    ${approvers.map(u => `<option value="${esc(u)}" ${S.approver === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}
                </select>
            </div>
            <div class="filter-section">
                <div class="filter-title">Added at</div>
                <div class="date-range">
                    <div class="dr-row"><span class="dr-lbl">From</span><input type="date" class="form-input" id="ir-added-from" value="${esc(S.addedFrom)}"></div>
                    <div class="dr-row"><span class="dr-lbl">To</span><input type="date" class="form-input" id="ir-added-to" value="${esc(S.addedTo)}"></div>
                </div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Initiated at</div>
                <div class="date-range">
                    <div class="dr-row"><span class="dr-lbl">From</span><input type="date" class="form-input" id="ir-init-from" value="${esc(S.initFrom)}"></div>
                    <div class="dr-row"><span class="dr-lbl">To</span><input type="date" class="form-input" id="ir-init-to" value="${esc(S.initTo)}"></div>
                </div>
            </div>
            <div class="filter-section">
                <button class="btn btn-outline btn-sm" data-act="clear-ir-filters" ${filtersActive() ? '' : 'disabled'}>Clear filters</button>
            </div>
        </aside>`;
    }

    /* ---- table ---- */
    function listHtml(rows) {
        const shown = rows.filter(matches).sort((a, b) => (b.completed || 0) - (a.completed || 0));
        const note = filtersActive()
            ? `<div class="muted" style="margin:0 0 12px;font-size:13.5px">${shown.length} of ${rows.length} items match. <button class="btn-link" data-act="clear-ir-filters">Clear search &amp; filters</button></div>` : '';
        if (!shown.length) return note + '<div class="empty-state">No items match your search. <button class="btn-link" data-act="clear-ir-filters">Clear search &amp; filters</button></div>';
        const noImg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9CCC6" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
        return note + `
            <div class="panel-card" style="padding:0;overflow:hidden">
                <div class="cat-attr-wrap"><table class="data-table ir-table">
                    <thead><tr>
                        <th style="padding-left:20px">Item</th><th>Record</th><th>Created by</th><th>Approved by</th>
                        <th>Initiated</th><th>Added</th><th style="width:120px"></th>
                    </tr></thead>
                    <tbody>${shown.map(x => {
                        const m = x.m;
                        const src = x.seeded ? '<span class="muted">Initial master data</span>'
                            : `${esc(x.r.requesterUser)}<div class="muted" style="font-size:11.5px">${window.Workflow.reqNo(x.r)} · Plant ${esc(x.r.requesterPlant || '—')}</div>`;
                        const appr = x.approvers.length
                            ? x.approvers.map(a => `<div style="white-space:nowrap">${esc(a.user)} <span class="muted" style="font-size:11px">(${esc(a.role)})</span></div>`).join('')
                            : '<span class="muted">—</span>';
                        const rt = m.recordType === 'Sourcing record'
                            ? '<span class="type-chip tc-extend">Sourcing</span>' : '<span class="type-chip tc-create">Golden</span>';
                        return `<tr class="clickable" data-act="open-item" data-id="${esc(m.id)}">
                            <td style="padding-left:20px">
                                <div style="display:flex;align-items:center;gap:10px">
                                    <span class="ir-thumb">${m.image ? `<img src="${m.image}" alt="">` : noImg}</span>
                                    <span>
                                        <div style="font-weight:600">${esc(m.shortName || m.name)}</div>
                                        <div class="muted" style="font-size:11.5px">SAP ${esc(m.sapId || '—')} · ${esc(m.unspscLabel || m.category || '—')}</div>
                                    </span>
                                </div>
                            </td>
                            <td>${rt}</td>
                            <td>${src}</td>
                            <td style="font-size:12.5px">${appr}</td>
                            <td>${fmtDate(x.initiated)}</td>
                            <td>${fmtDate(x.completed)}</td>
                            <td style="text-align:right;white-space:nowrap;padding-right:20px">
                                <button class="btn-mini" data-act="item-history" data-id="${esc(m.id)}">⤺ History</button>
                            </td>
                        </tr>`;
                    }).join('')}</tbody>
                </table></div>
            </div>
            <div class="seen-all">${filtersActive() ? shown.length + ' of ' + rows.length : rows.length} item(s).</div>`;
    }

    /* ---- export the (filtered) report as an Excel file ---- */
    function exportExcel(rows) {
        const shown = rows.filter(matches).sort((a, b) => (b.completed || 0) - (a.completed || 0));
        const join = (obj, sep) => Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => k + ': ' + v).join(sep || '; ');
        const header = ['Short name', 'Name', 'SAP ID', 'dmp ID', 'Category', 'UNSPSC', 'Material group', 'Record type',
            'Part type', 'Manufacturer', 'Manufacturer part #', 'Base UoM', 'PO unit', 'PO unit conversion',
            'Storage location', 'MRP enabled', 'MRP type', 'Batch-managed', 'Valuation class', 'Plants',
            'Item status', 'Block status', 'Long description', 'Technical attributes', 'Inventory planning',
            'Created by', 'Request #', 'Requester plant', 'Approved by', 'Initiated', 'Added', 'Source'];
        const dataRows = shown.map(x => {
            const m = x.m;
            return [
                m.shortName || '', m.name || '', m.sapId || '', m.dmpId || '',
                m.unspscLabel || m.category || '', m.unspsc || '', m.materialGroup || '',
                m.recordType || 'Golden record', m.matTypeChoice || '', m.manufacturer || '', m.mfrPartNo || '',
                m.baseUom || '', m.poUnit || '', m.poUnitFactor || '', m.storageLocation || '',
                m.mrpEnabled || '', m.mrpType || '', m.batchManaged || '',
                m.valuationClass ? m.valuationClass + ' — ' + window.UI.valuationDesc(m.valuationClass) : '',
                (m.plants || []).join(', '), m.itemStatus || '', m.blockStatus || '',
                m.longDesc || '', join(m.attributes),
                m.inventoryByPlant
                    ? Object.keys(m.inventoryByPlant).map(p => 'Plant ' + p + ' — ' + join(m.inventoryByPlant[p])).join(' | ')
                    : join(m.inventory),
                x.r ? x.r.requesterUser : '', x.r ? window.Workflow.reqNo(x.r) : '',
                x.r ? (x.r.requesterPlant || '') : '',
                x.approvers.map(a => `${a.user} (${a.role})`).join(', '),
                fmtDate(x.initiated), fmtDate(x.completed),
                x.seeded ? 'Initial master data' : 'Created via request'
            ];
        });
        window.UI.exportXlsx([header].concat(dataRows), 'Created items',
            'dmp_created_items_' + new Date().toISOString().slice(0, 10) + '.xlsx');
        window.UI.toast({ title: 'Excel exported', body: shown.length + ' item(s) exported' + (filtersActive() ? ' (filtered list)' : '') + '.', kind: 'info' });
    }

    window.Views.itemsReport = function () {
        const root = document.getElementById('view');
        if (window.Store.session().currentRole !== 'Central team') {
            root.innerHTML = `<div class="page-narrow"><div class="banner info" style="margin-top:24px"><span class="banner-icon">🔒</span>
                <div class="banner-body"><div class="banner-title">Central team only</div>
                This report is available to the Central team. Switch role to <strong>Central team</strong> to view it.</div></div></div>`;
            return;
        }
        const rows = buildRows();
        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> ›
                <span class="crumb-link" data-act="to-dash">Analytics dashboard</span> › Created items</div>
            <div class="workspace">
                ${sidebarHtml(rows)}
                <main class="content-panel">
                    <div class="form-header" style="align-items:flex-end;margin-bottom:14px">
                        <div>
                            <h2 style="font-size:22px;font-weight:600">Created items</h2>
                            <div class="muted" style="font-size:14px;margin-top:3px">Every item in the material master — who initiated it, who approved it, and when it was added. Click a row to open the item.</div>
                        </div>
                        <div style="display:flex;gap:8px">
                            <button class="btn btn-black btn-sm" data-act="export">⬇ Export to Excel</button>
                            <button class="btn btn-outline btn-sm" data-act="to-dash">‹ Back to dashboard</button>
                        </div>
                    </div>
                    <div class="cat-toolbar">
                        <input type="text" class="form-input cat-search" id="ir-q" value="${esc(S.q)}" placeholder="Search by name, SAP ID, dmp ID, manufacturer, part number or requester…">
                    </div>
                    <div id="ir-list">${listHtml(rows)}</div>
                </main>
            </div>`;

        // live search re-renders only the list, so typing keeps focus
        root.querySelector('#ir-q').addEventListener('input', (e) => {
            S.q = e.target.value;
            root.querySelector('#ir-list').innerHTML = listHtml(rows);
        });
        const sel = (id, key) => root.querySelector(id).addEventListener('change', (e) => {
            S[key] = e.target.value; window.Views.itemsReport();
        });
        sel('#ir-added-from', 'addedFrom');
        sel('#ir-added-to', 'addedTo');
        sel('#ir-init-from', 'initFrom');
        sel('#ir-init-to', 'initTo');
        sel('#ir-plant', 'plant');
        root.querySelector('#ir-cat').addEventListener('change', (e) => {
            S.cat = e.target.value;
            S.attrs = {};   // new category → fresh attribute filter set
            window.Views.itemsReport();
        });
        sel('#ir-approver', 'approver');
        // per-attribute filter controls (same behavior as the Material Master page)
        const setAttr = (name, patch) => {
            const cur = Object.assign({}, S.attrs[name] || {}, patch);
            Object.keys(cur).forEach(k => { if (cur[k] === undefined) delete cur[k]; });
            if (Object.keys(cur).length) S.attrs[name] = cur; else delete S.attrs[name];
            window.Views.itemsReport();
        };
        root.querySelectorAll('[data-attr-num]').forEach(el => el.addEventListener('change', (e) => {
            const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
            setAttr(e.target.getAttribute('data-attr-num'), { [e.target.getAttribute('data-bound')]: (v === undefined || isNaN(v)) ? undefined : v });
        }));
        root.querySelectorAll('[data-attr-sel]').forEach(el => el.addEventListener('change', (e) => {
            setAttr(e.target.getAttribute('data-attr-sel'), { val: e.target.value || undefined });
        }));
        root.querySelectorAll('[data-attr-text]').forEach(el => el.addEventListener('change', (e) => {
            setAttr(e.target.getAttribute('data-attr-text'), { text: e.target.value.trim() || undefined });
        }));
        root.querySelectorAll('[data-ir-filter]').forEach(el => el.addEventListener('change', (e) => {
            const group = e.target.getAttribute('data-ir-filter');
            const i = S[group].indexOf(e.target.value);
            if (e.target.checked && i === -1) S[group].push(e.target.value);
            if (!e.target.checked && i !== -1) S[group].splice(i, 1);
            window.Views.itemsReport();
        }));

        window.UI.bindActions(root, {
            'home': () => window.UI.go('#/master'),
            'to-dash': () => window.UI.go('#/dashboard'),
            'export': () => exportExcel(rows),
            'open-item': (t) => window.UI.go('#/item/' + t.getAttribute('data-id')),
            'item-history': (t, e) => { e.stopPropagation(); window.UI.go('#/item/' + t.getAttribute('data-id') + '/history'); },
            'clear-ir-filters': () => {
                S.q = ''; S.plant = ''; S.cat = ''; S.record = []; S.creators = []; S.approver = ''; S.source = [];
                S.attrs = {}; S.addedFrom = ''; S.addedTo = ''; S.initFrom = ''; S.initTo = '';
                window.Views.itemsReport();
            },
            'toggle-sidebar': () => { S.collapsed = !S.collapsed; root.querySelector('.sidebar').classList.toggle('collapsed', S.collapsed); }
        });
    };
})();
