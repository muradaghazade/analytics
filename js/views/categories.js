/* ============================================================
   views/categories.js — category catalog with full management:
   categories (UNSPSC code + label) and their structured attributes
   (name, field type, UoM, mandatory, list options) — create/edit/delete
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);
    const state = { expanded: {}, q: '', group: '', sources: [], attrs: [], attrQ: '', collapsed: false };

    function cats() { return window.Store.get().datasets.CATEGORY_ATTRIBUTES || []; }
    function catBy(unspsc) { return cats().find(c => c.unspsc === unspsc); }
    function ds() { return window.Store.get().datasets; }

    /* ================= rendering ================= */
    function attrTable(c) {
        if (!c.attributes.length) return `<div class="muted" style="padding:14px 4px">No attributes yet — add the first one.</div>`;
        return `<table class="data-table attr-table">
            <thead><tr>
                <th>Attribute name</th><th>Field type</th><th>Measured in</th><th>Mandatory</th><th style="width:150px"></th>
            </tr></thead>
            <tbody>${c.attributes.map((a, i) => `
                <tr>
                    <td style="font-weight:600">${esc(a.name)}</td>
                    <td><span class="ft-chip" ${a.options ? `title="${esc(a.options)}"` : ''}>${esc(a.fieldType || 'Text')}</span></td>
                    <td>${a.uom ? esc(a.uom) : '<span class="muted">—</span>'}</td>
                    <td>${a.mandatory ? '<span class="mand-chip">Mandatory</span>' : '<span class="muted">Optional</span>'}</td>
                    <td style="text-align:right;white-space:nowrap">
                        <button class="btn-mini" data-act="edit-attr" data-cat="${esc(c.unspsc)}" data-i="${i}">Edit</button>
                        <button class="btn-mini danger" data-act="del-attr" data-cat="${esc(c.unspsc)}" data-i="${i}">Delete</button>
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;
    }

    function catCard(c) {
        const open = state.expanded[c.unspsc] === true;   // default collapsed
        const mand = c.attributes.filter(a => a.mandatory).length;
        return `<div class="panel-card cat-card">
            <div class="cat-head" data-act="toggle" data-cat="${esc(c.unspsc)}">
                <div class="cat-head-left">
                    <span class="cat-caret">${open ? '▾' : '▸'}</span>
                    <div>
                        <div class="cat-title">${esc(c.label)} <span class="cat-code">UNSPSC ${esc(c.unspsc)}</span>
                            ${c.addedByAI ? '<span class="ai-added-chip">✦ AI-added</span>' : ''}</div>
                        <div class="cat-sub">${esc(c.materialGroup || '—')} ${esc(window.UI.groupDesc(c.materialGroup))} · ${c.attributes.length} attribute(s), ${mand} mandatory</div>
                    </div>
                </div>
                <div class="cat-head-actions">
                    <button class="btn btn-outline btn-sm" data-act="add-attr" data-cat="${esc(c.unspsc)}">＋ Add attribute</button>
                    <button class="btn-mini" data-act="edit-cat" data-cat="${esc(c.unspsc)}">Edit</button>
                    <button class="btn-mini danger" data-act="del-cat" data-cat="${esc(c.unspsc)}">Delete</button>
                </div>
            </div>
            ${open ? `<div class="cat-body">${attrTable(c)}</div>` : ''}
        </div>`;
    }

    // search matches the label, the UNSPSC code and every attribute name
    function matchesFilters(c) {
        const q = state.q.trim().toLowerCase();
        if (q && !(c.label.toLowerCase().indexOf(q) !== -1 ||
                   String(c.unspsc).indexOf(q) !== -1 ||
                   (c.attributes || []).some(a => (a.name || '').toLowerCase().indexOf(q) !== -1))) return false;
        if (state.group && c.materialGroup !== state.group) return false;
        if (state.sources.length) {
            const src = c.addedByAI ? 'ai' : (c.addedByRequest ? 'req' : 'builtin');
            if (state.sources.indexOf(src) === -1) return false;
        }
        // attribute filter: the category must carry EVERY selected attribute
        if (state.attrs.length && !state.attrs.every(a =>
            (c.attributes || []).some(x => (x.name || '').toLowerCase() === a.toLowerCase()))) return false;
        return true;
    }
    function filtersActive() { return !!(state.q.trim() || state.group || state.sources.length || state.attrs.length); }

    function listHtml() {
        const all = cats();
        const list = all.filter(matchesFilters);
        const note = filtersActive()
            ? `<div class="muted" style="margin:0 0 12px;font-size:13.5px">${list.length} of ${all.length} categories match. <button class="btn-link" data-act="clear-cat-filters">Clear search &amp; filters</button></div>` : '';
        if (!all.length) return '<div class="empty-state">No categories yet. Add the first one.</div>';
        if (!list.length) return note + '<div class="empty-state">No categories match your search. <button class="btn-link" data-act="clear-cat-filters">Clear search &amp; filters</button></div>';
        return note + list.map(catCard).join('') +
            `<div class="seen-all">${filtersActive() ? list.length + ' of ' + all.length : all.length} categories. Mandatory attributes block item request submission when left blank.</div>`;
    }

    // all attribute names across the catalog, with how many categories carry each
    function attrIndex() {
        const map = new Map();
        cats().forEach(c => (c.attributes || []).forEach(a => {
            const n = (a.name || '').trim();
            if (n) map.set(n, (map.get(n) || 0) + 1);
        }));
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    function attrListHtml() {
        const q = state.attrQ.trim().toLowerCase();
        const rows = attrIndex().filter(([n]) =>
            state.attrs.indexOf(n) !== -1 || !q || n.toLowerCase().indexOf(q) !== -1);
        if (!rows.length) return '<div class="muted" style="font-size:12.5px;padding:4px 2px">No attributes match</div>';
        return rows.map(([n, count]) => `<label class="checkbox-label"><input type="checkbox" data-cat-attr value="${esc(n)}" ${state.attrs.indexOf(n) !== -1 ? 'checked' : ''}> ${esc(n)} <span class="muted">(${count})</span></label>`).join('');
    }

    function sidebarHtml() {
        const groupsInUse = [...new Set(cats().map(c => c.materialGroup).filter(Boolean))].sort();
        const cb = (val, label) => `<label class="checkbox-label"><input type="checkbox" data-cat-source value="${val}" ${state.sources.indexOf(val) !== -1 ? 'checked' : ''}> ${label}</label>`;
        return `<aside class="sidebar ${state.collapsed ? 'collapsed' : ''}">
            <div class="sidebar-collapse-icon" data-act="toggle-sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
            </div>
            <div class="filter-section first">
                <div class="filter-title">Material group</div>
                <select class="filter-select" id="cat-group">
                    <option value="">All material groups</option>
                    ${groupsInUse.map(g => `<option value="${esc(g)}" ${state.group === g ? 'selected' : ''}>${esc(g + ' — ' + window.UI.groupDesc(g))}</option>`).join('')}
                </select>
            </div>
            <div class="filter-section">
                <div class="filter-title">Source</div>
                <div class="checkbox-group">
                    ${cb('builtin', 'Built-in')}
                    ${cb('ai', '✦ AI-added')}
                    ${cb('req', 'Added via request')}
                </div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Attributes</div>
                <input type="text" class="form-input attr-filter-search" id="cat-attr-q" value="${esc(state.attrQ)}" placeholder="Find attribute…">
                <div class="checkbox-group attr-filter-list" id="cat-attr-list">${attrListHtml()}</div>
                ${state.attrs.length ? `<div class="muted" style="font-size:11.5px;margin-top:6px">Categories carrying all ${state.attrs.length} selected attribute(s)</div>` : ''}
            </div>
            <div class="filter-section">
                <button class="btn btn-outline btn-sm" data-act="clear-cat-filters" ${filtersActive() ? '' : 'disabled'}>Clear filters</button>
            </div>
        </aside>`;
    }

    window.Views.categories = function () {
        const root = document.getElementById('view');

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> › Category catalog</div>
            <div class="workspace">
                ${sidebarHtml()}
                <main class="content-panel">
                    <div class="form-header" style="align-items:flex-end;margin-bottom:14px">
                        <div>
                            <h2 style="font-size:22px;font-weight:600">Categories &amp; attributes</h2>
                            <div class="muted" style="font-size:14px;margin-top:3px">Each category (UNSPSC code + label) defines the structured attributes that must be filled when creating items in that category.</div>
                        </div>
                    </div>
                    <div class="cat-toolbar">
                        <input type="text" class="form-input cat-search" id="cat-q" value="${esc(state.q)}"
                            placeholder="Search category, UNSPSC code or attribute…">
                    </div>
                    <div id="cat-list">${listHtml()}</div>
                </main>
            </div>`;

        // live search: only the list re-renders, so typing keeps focus
        const updateList = () => { root.querySelector('#cat-list').innerHTML = listHtml(); };
        root.querySelector('#cat-q').addEventListener('input', (e) => { state.q = e.target.value; updateList(); });
        root.querySelector('#cat-group').addEventListener('change', (e) => { state.group = e.target.value; window.Views.categories(); });
        root.querySelectorAll('[data-cat-source]').forEach(el => el.addEventListener('change', (e) => {
            const i = state.sources.indexOf(e.target.value);
            if (e.target.checked && i === -1) state.sources.push(e.target.value);
            if (!e.target.checked && i !== -1) state.sources.splice(i, 1);
            window.Views.categories();
        }));
        // attribute filter: search narrows the checkbox list (typing keeps focus),
        // ticking an attribute narrows the categories to those carrying all ticked ones
        root.querySelector('#cat-attr-q').addEventListener('input', (e) => {
            state.attrQ = e.target.value;
            root.querySelector('#cat-attr-list').innerHTML = attrListHtml();
        });
        root.querySelector('#cat-attr-list').addEventListener('change', (e) => {
            if (!e.target.hasAttribute('data-cat-attr')) return;
            const v = e.target.value;
            const i = state.attrs.indexOf(v);
            if (e.target.checked && i === -1) state.attrs.push(v);
            if (!e.target.checked && i !== -1) state.attrs.splice(i, 1);
            window.Views.categories();
        });

        window.UI.bindActions(root, {
            'home': () => window.UI.go('#/master'),
            'toggle': (t) => {
                const id = t.getAttribute('data-cat');
                state.expanded[id] = state.expanded[id] !== true;
                window.Views.categories();
            },
            'clear-cat-filters': () => { state.q = ''; state.group = ''; state.sources = []; state.attrs = []; state.attrQ = ''; window.Views.categories(); },
            'toggle-sidebar': () => { state.collapsed = !state.collapsed; root.querySelector('.sidebar').classList.toggle('collapsed', state.collapsed); },
            'edit-cat': (t, e) => { e.stopPropagation(); catModal(t.getAttribute('data-cat')); },
            'del-cat': (t, e) => { e.stopPropagation(); delCat(t.getAttribute('data-cat')); },
            'add-attr': (t, e) => { e.stopPropagation(); attrModal(t.getAttribute('data-cat'), null); },
            'edit-attr': (t) => attrModal(t.getAttribute('data-cat'), +t.getAttribute('data-i')),
            'del-attr': (t) => delAttr(t.getAttribute('data-cat'), +t.getAttribute('data-i'))
        });
    };

    /* ================= category CRUD ================= */
    function catModal(unspsc) {
        const c = unspsc ? catBy(unspsc) : null;
        const groups = ds().MATERIAL_GROUPS;
        const current = c ? c.materialGroup || '' : '';
        // material group picker: search box + always-visible scrollable list —
        // a native <select> popup gets clipped inside the modal
        const rowsHtml = (filter, selected) => {
            const f = (filter || '').trim().toLowerCase();
            const rows = groups.filter(g => !f || (g.code + ' ' + g.desc).toLowerCase().indexOf(f) !== -1);
            if (!rows.length) return '<div class="mg-empty">No material groups match your search.</div>';
            return rows.map(g => `<div class="mg-opt ${selected === g.code ? 'selected' : ''}" data-code="${esc(g.code)}">${esc(g.code + ' — ' + g.desc)}</div>`).join('');
        };
        // edit: the commodity is picked from the dropdown of the category's
        // UNSPSC class (family) — preselected with the current commodity; the
        // canonical values live in the hidden cm-code / cm-label inputs
        const commodityHtml = () => {
            const co = window.UI.commodityOptions({ unspsc: c.unspsc, categoryName: c.label });
            return `<select class="form-select" id="cm-commodity">
                    ${co.options.map(x => `<option value="${esc(x.value)}" data-name="${esc(x.name)}" ${x.value === String(c.unspsc) ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
                </select>
                <div class="muted" style="font-size:12px;margin-top:6px">UNSPSC class ${esc(co.cls)}${co.classTitle ? ' — ' + esc(co.classTitle) : ''} · ${co.options.length} commodities</div>`;
        };
        window.UI.openModal({
            title: c ? 'Edit category' : 'Add category',
            bodyHtml: `
                ${c ? `<div class="field" style="margin-bottom:12px"><label>Category (commodity) <span class="req">*</span></label>
                    <div id="cm-commodity-holder">${commodityHtml()}</div>
                    <input type="hidden" id="cm-code" value="${esc(c.unspsc)}">
                    <input type="hidden" id="cm-label" value="${esc(c.label)}">
                    <div class="muted" style="font-size:12px;margin-top:4px">Changing the commodity re-keys the category — existing items keep their saved attribute values.</div>
                </div>`
                : `<div class="field" style="margin-bottom:12px"><label>UNSPSC code <span class="req">*</span></label>
                    <input class="form-input" id="cm-code" value="" placeholder="e.g. 31171504"></div>
                <div class="field" style="margin-bottom:12px"><label>UNSPSC label <span class="req">*</span></label>
                    <input class="form-input" id="cm-label" value="" placeholder="e.g. Ball bearings"></div>`}
                <div class="field"><label>Material group</label>
                    <input class="form-input" id="cm-group-q" autocomplete="off"
                        placeholder="Search ${groups.length} material groups…" style="margin-bottom:8px">
                    <input type="hidden" id="cm-group" value="${esc(current)}">
                    <div class="mg-list" id="cm-group-list">${rowsHtml('', current)}</div>
                    <div class="muted" style="font-size:12px;margin-top:6px" id="cm-group-hint">${current ? 'Selected: ' + esc(current + ' — ' + window.UI.groupDesc(current)) : 'No material group selected yet.'}</div>
                </div>`,
            onOpen: (o) => {
                // commodity picker (edit only): selection → hidden code + label;
                // once the full UNSPSC codeset finishes loading, rebuild the
                // dropdown so ALL commodities of the class are listed
                const bindCommodity = () => {
                    const sel = o.querySelector('#cm-commodity');
                    if (!sel) return;
                    sel.addEventListener('change', () => {
                        const opt = sel.options[sel.selectedIndex];
                        o.querySelector('#cm-code').value = sel.value;
                        o.querySelector('#cm-label').value = (opt && opt.getAttribute('data-name')) || '';
                    });
                };
                bindCommodity();
                if (c && window.UNSPSC_READY) window.UNSPSC_READY.then(() => {
                    const holder = o.querySelector('#cm-commodity-holder');
                    if (!holder || !document.body.contains(holder)) return;
                    const cur = o.querySelector('#cm-code').value;
                    const curName = o.querySelector('#cm-label').value;
                    const co = window.UI.commodityOptions({ unspsc: cur, categoryName: curName });
                    holder.innerHTML = `<select class="form-select" id="cm-commodity">
                            ${co.options.map(x => `<option value="${esc(x.value)}" data-name="${esc(x.name)}" ${x.value === String(cur) ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
                        </select>
                        <div class="muted" style="font-size:12px;margin-top:6px">UNSPSC class ${esc(co.cls)}${co.classTitle ? ' — ' + esc(co.classTitle) : ''} · ${co.options.length} commodities</div>`;
                    bindCommodity();
                });
                const q = o.querySelector('#cm-group-q'), hid = o.querySelector('#cm-group'),
                      list = o.querySelector('#cm-group-list'), hint = o.querySelector('#cm-group-hint');
                q.addEventListener('input', () => { list.innerHTML = rowsHtml(q.value, hid.value); });
                list.addEventListener('click', (e) => {
                    const r = e.target.closest('.mg-opt');
                    if (!r) return;
                    hid.value = r.getAttribute('data-code');
                    hint.textContent = 'Selected: ' + r.textContent;
                    list.innerHTML = rowsHtml(q.value, hid.value);
                });
                const sel = list.querySelector('.mg-opt.selected');
                if (sel) sel.scrollIntoView({ block: 'center' });
            },
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: c ? 'Save changes' : 'Add category', cls: 'btn-green', onClick: (o) => {
                    const code = o.querySelector('#cm-code').value.trim();
                    const label = o.querySelector('#cm-label').value.trim();
                    const group = o.querySelector('#cm-group').value;
                    if (!code || !label) { window.UI.toast({ title: 'Missing data', body: 'UNSPSC code and label are required.', kind: 'danger' }); return; }
                    const clash = catBy(code);
                    if (clash && (!c || clash.unspsc !== c.unspsc)) { window.UI.toast({ title: 'Already exists', body: 'A category with UNSPSC ' + code + ' already exists.', kind: 'danger' }); return; }
                    window.Store.set(s => {
                        if (c) {
                            const cc = s.datasets.CATEGORY_ATTRIBUTES.find(x => x.unspsc === unspsc);
                            cc.unspsc = code;   // the picker may re-key to a sibling commodity
                            cc.label = label; cc.materialGroup = group;
                            if (Array.isArray(s.deletedCategories)) s.deletedCategories = s.deletedCategories.filter(u => String(u) !== String(code));
                        } else {
                            s.datasets.CATEGORY_ATTRIBUTES.push({ unspsc: code, label, materialGroup: group, attributes: [] });
                            if (Array.isArray(s.deletedCategories)) s.deletedCategories = s.deletedCategories.filter(u => String(u) !== String(code));
                        }
                    });
                    o.remove();
                    window.UI.toast({ title: c ? 'Category updated' : 'Category added', body: label + ' (UNSPSC ' + code + ')' });
                    window.Views.categories();
                } }
            ]
        });
    }

    function delCat(unspsc) {
        const c = catBy(unspsc);
        if (!c) return;
        window.UI.openModal({
            title: 'Delete category',
            bodyHtml: `<p>Delete <strong>${esc(c.label)}</strong> (UNSPSC ${esc(c.unspsc)}) and its ${c.attributes.length} attribute(s)?<br>
                <span class="muted">Existing items keep their saved attribute values; new items in this category will have no attribute schema.</span></p>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Delete', cls: 'btn-danger-outline', onClick: (o) => {
                    window.Store.set(s => {
                        s.datasets.CATEGORY_ATTRIBUTES = s.datasets.CATEGORY_ATTRIBUTES.filter(x => x.unspsc !== unspsc);
                        // tombstone: keeps the seed merge from resurrecting it on reload
                        if (!Array.isArray(s.deletedCategories)) s.deletedCategories = [];
                        if (s.deletedCategories.indexOf(unspsc) === -1) s.deletedCategories.push(unspsc);
                    });
                    o.remove();
                    window.UI.toast({ title: 'Category deleted', body: c.label, kind: 'danger' });
                    window.Views.categories();
                } }
            ]
        });
    }

    /* ================= attribute CRUD ================= */
    function attrModal(unspsc, index) {
        const c = catBy(unspsc);
        if (!c) return;
        const a = index !== null && index !== undefined && c.attributes[index] ? c.attributes[index] : null;
        const types = ds().ATTR_FIELD_TYPES || ['Text', 'Number', 'Range', 'Yes/No', 'List', 'Date'];
        const uoms = ds().UOM;
        window.UI.openModal({
            title: (a ? 'Edit attribute — ' : 'Add attribute — ') + c.label,
            bodyHtml: `
                <div class="field" style="margin-bottom:12px"><label>Attribute name <span class="req">*</span></label>
                    <input class="form-input" id="am-name" value="${esc(a ? a.name : '')}" placeholder="e.g. Bore diameter"></div>
                <div style="display:flex;gap:12px;margin-bottom:12px">
                    <div class="field" style="flex:1"><label>Field type <span class="req">*</span></label>
                        <select class="form-select" id="am-type">
                            ${types.map(t => `<option ${a && a.fieldType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
                        </select></div>
                    <div class="field" style="flex:1"><label>Measured in</label>
                        <select class="form-select" id="am-uom">
                            <option value="">— none —</option>
                            ${uoms.map(u => `<option ${a && a.uom === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}
                        </select></div>
                </div>
                <div class="field" style="margin-bottom:12px" id="am-options-wrap">
                    <label>List values <span class="muted" style="font-weight:400">(for List type, comma-separated)</span></label>
                    <input class="form-input" id="am-options" value="${esc(a ? a.options || '' : '')}" placeholder="e.g. CN, C2, C3, C4"></div>
                <label class="checkbox-label" style="font-size:14px"><input type="checkbox" id="am-mand" ${a && a.mandatory ? 'checked' : ''}> Mandatory — blocks item request submission when blank</label>`,
            onOpen: (o) => {
                const typeSel = o.querySelector('#am-type');
                const optsWrap = o.querySelector('#am-options-wrap');
                const sync = () => { optsWrap.style.display = typeSel.value === 'List' ? '' : 'none'; };
                typeSel.addEventListener('change', sync); sync();
            },
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: a ? 'Save changes' : 'Add attribute', cls: 'btn-green', onClick: (o) => {
                    const name = o.querySelector('#am-name').value.trim();
                    const fieldType = o.querySelector('#am-type').value;
                    const uom = o.querySelector('#am-uom').value;
                    const options = o.querySelector('#am-options').value.trim();
                    const mandatory = o.querySelector('#am-mand').checked;
                    if (!name) { window.UI.toast({ title: 'Missing data', body: 'Attribute name is required.', kind: 'danger' }); return; }
                    if (fieldType === 'List' && !options) { window.UI.toast({ title: 'Missing data', body: 'List type needs at least one value.', kind: 'danger' }); return; }
                    const dup = c.attributes.some((x, i) => x.name.toLowerCase() === name.toLowerCase() && i !== index);
                    if (dup) { window.UI.toast({ title: 'Already exists', body: 'This category already has an attribute named “' + name + '”.', kind: 'danger' }); return; }
                    window.Store.set(s => {
                        const cc = s.datasets.CATEGORY_ATTRIBUTES.find(x => x.unspsc === unspsc);
                        const obj = { name, fieldType, uom, mandatory, options: fieldType === 'List' ? options : '' };
                        if (a) cc.attributes[index] = obj; else cc.attributes.push(obj);
                    });
                    o.remove();
                    window.UI.toast({ title: a ? 'Attribute updated' : 'Attribute added', body: name + ' (' + fieldType + (uom ? ', ' + uom : '') + ')' });
                    window.Views.categories();
                } }
            ]
        });
    }

    function delAttr(unspsc, index) {
        const c = catBy(unspsc);
        if (!c || !c.attributes[index]) return;
        const a = c.attributes[index];
        window.UI.openModal({
            title: 'Delete attribute',
            bodyHtml: `<p>Delete attribute <strong>${esc(a.name)}</strong> from <strong>${esc(c.label)}</strong>?</p>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Delete', cls: 'btn-danger-outline', onClick: (o) => {
                    window.Store.set(s => {
                        const cc = s.datasets.CATEGORY_ATTRIBUTES.find(x => x.unspsc === unspsc);
                        cc.attributes.splice(index, 1);
                    });
                    o.remove();
                    window.UI.toast({ title: 'Attribute deleted', body: a.name, kind: 'danger' });
                    window.Views.categories();
                } }
            ]
        });
    }
})();
