/* ============================================================
   views/manufacturers.js — manufacturer master data (Central team only)
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);

    function list() { return window.Store.get().datasets.MANUFACTURERS || []; }

    const state = { q: '', country: '', usage: [], collapsed: false };

    function usageMap() {
        const usage = {};
        window.Store.materials().forEach(m => { if (m.manufacturer) usage[m.manufacturer] = (usage[m.manufacturer] || 0) + 1; });
        return usage;
    }
    function matchesFilters(m, usage) {
        const q = state.q.trim().toLowerCase();
        if (q && !((m.name || '').toLowerCase().indexOf(q) !== -1 ||
                   (m.country || '').toLowerCase().indexOf(q) !== -1)) return false;
        if (state.country && (m.country || '') !== state.country) return false;
        if (state.usage.length) {
            const used = (usage[m.name] || 0) > 0 ? 'used' : 'unused';
            if (state.usage.indexOf(used) === -1) return false;
        }
        return true;
    }
    function filtersActive() { return !!(state.q.trim() || state.country || state.usage.length); }

    function restricted(root) {
        root.innerHTML = `<div class="page-narrow"><div class="inbox-empty" style="margin-top:30px">
            <div style="font-size:26px">🔒</div>
            <div style="font-weight:600;margin-top:10px;font-size:15px">Central team only</div>
            <div class="muted" style="font-size:14px;margin-top:3px">Switch to the Central team role to manage this page.</div>
        </div></div>`;
    }

    function listHtml() {
        const all = list();
        const usage = usageMap();
        // keep the ORIGINAL index on each row — edit/delete address the full list
        const rows = all.map((m, i) => ({ m, i })).filter(x => matchesFilters(x.m, usage));
        const note = filtersActive()
            ? `<div class="muted" style="margin:0 0 12px;font-size:13.5px">${rows.length} of ${all.length} manufacturers match. <button class="btn-link" data-act="clear-mfr-filters">Clear search &amp; filters</button></div>` : '';
        if (!rows.length) return note + '<div class="empty-state">No manufacturers match your search. <button class="btn-link" data-act="clear-mfr-filters">Clear search &amp; filters</button></div>';
        return note + `
            <div class="panel-card" style="padding:0;overflow:hidden">
                <table class="data-table attr-table">
                    <thead><tr><th style="padding-left:20px">Name</th><th>Country</th><th>Used by items</th><th style="width:150px"></th></tr></thead>
                    <tbody>${rows.map(({ m, i }) => `
                        <tr>
                            <td style="font-weight:600;padding-left:20px">${esc(m.name)}</td>
                            <td>${m.country ? esc(m.country) : '<span class="muted">—</span>'}</td>
                            <td>${usage[m.name] ? usage[m.name] + ' item(s)' : '<span class="muted">—</span>'}</td>
                            <td style="text-align:right;white-space:nowrap;padding-right:20px">
                                <button class="btn-mini" data-act="edit" data-i="${i}">Edit</button>
                                <button class="btn-mini danger" data-act="del" data-i="${i}">Delete</button>
                            </td>
                        </tr>`).join('')}</tbody>
                </table>
            </div>
            <div class="seen-all">${filtersActive() ? rows.length + ' of ' + all.length : all.length} manufacturers.</div>`;
    }

    function sidebarHtml() {
        const countries = [...new Set(list().map(m => m.country).filter(Boolean))].sort();
        const cb = (val, label) => `<label class="checkbox-label"><input type="checkbox" data-mfr-usage value="${val}" ${state.usage.indexOf(val) !== -1 ? 'checked' : ''}> ${label}</label>`;
        return `<aside class="sidebar ${state.collapsed ? 'collapsed' : ''}">
            <div class="sidebar-collapse-icon" data-act="toggle-sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
            </div>
            <div class="filter-section first">
                <div class="filter-title">Country</div>
                <select class="filter-select" id="mfr-country">
                    <option value="">All countries</option>
                    ${countries.map(c => `<option value="${esc(c)}" ${state.country === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                </select>
            </div>
            <div class="filter-section">
                <div class="filter-title">Usage</div>
                <div class="checkbox-group">
                    ${cb('used', 'Used by items')}
                    ${cb('unused', 'Not used yet')}
                </div>
            </div>
            <div class="filter-section">
                <button class="btn btn-outline btn-sm" data-act="clear-mfr-filters" ${filtersActive() ? '' : 'disabled'}>Clear filters</button>
            </div>
        </aside>`;
    }

    window.Views.manufacturers = function () {
        const root = document.getElementById('view');
        if (window.Store.session().currentRole !== 'Central team') return restricted(root);

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> › Manufacturers</div>
            <div class="workspace">
                ${sidebarHtml()}
                <main class="content-panel">
                    <div class="form-header" style="align-items:flex-end;margin-bottom:14px">
                        <div>
                            <h2 style="font-size:22px;font-weight:600">Manufacturers</h2>
                            <div class="muted" style="font-size:14px;margin-top:3px">Master list of manufacturers referenced by material records and item requests.</div>
                        </div>
                        <button class="btn btn-black" data-act="add">＋ Add manufacturer</button>
                    </div>
                    <div class="cat-toolbar">
                        <input type="text" class="form-input cat-search" id="mfr-q" value="${esc(state.q)}" placeholder="Search by name or country…">
                    </div>
                    <div id="mfr-list">${listHtml()}</div>
                </main>
            </div>`;

        // live search re-renders only the list, so typing keeps focus
        root.querySelector('#mfr-q').addEventListener('input', (e) => {
            state.q = e.target.value;
            root.querySelector('#mfr-list').innerHTML = listHtml();
        });
        root.querySelector('#mfr-country').addEventListener('change', (e) => { state.country = e.target.value; window.Views.manufacturers(); });
        root.querySelectorAll('[data-mfr-usage]').forEach(el => el.addEventListener('change', (e) => {
            const i = state.usage.indexOf(e.target.value);
            if (e.target.checked && i === -1) state.usage.push(e.target.value);
            if (!e.target.checked && i !== -1) state.usage.splice(i, 1);
            window.Views.manufacturers();
        }));

        window.UI.bindActions(root, {
            'home': () => window.UI.go('#/master'),
            'add': () => modal(null),
            'edit': (t) => modal(+t.getAttribute('data-i')),
            'del': (t) => del(+t.getAttribute('data-i')),
            'clear-mfr-filters': () => { state.q = ''; state.country = ''; state.usage = []; window.Views.manufacturers(); },
            'toggle-sidebar': () => { state.collapsed = !state.collapsed; root.querySelector('.sidebar').classList.toggle('collapsed', state.collapsed); }
        });
    };

    function modal(index) {
        const m = index !== null && index !== undefined ? list()[index] : null;
        window.UI.openModal({
            title: m ? 'Edit manufacturer' : 'Add manufacturer',
            bodyHtml: `
                <div class="field" style="margin-bottom:12px"><label>Name <span class="req">*</span></label>
                    <input class="form-input" id="mm-name" value="${esc(m ? m.name : '')}" placeholder="e.g. SKF"></div>
                <div class="field"><label>Country</label>
                    <input class="form-input" id="mm-country" value="${esc(m ? m.country || '' : '')}" placeholder="e.g. Sweden"></div>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: m ? 'Save changes' : 'Add manufacturer', cls: 'btn-green', onClick: (o) => {
                    const name = o.querySelector('#mm-name').value.trim();
                    const country = o.querySelector('#mm-country').value.trim();
                    if (!name) { window.UI.toast({ title: 'Missing data', body: 'Manufacturer name is required.', kind: 'danger' }); return; }
                    const dup = list().some((x, i) => x.name.toLowerCase() === name.toLowerCase() && i !== index);
                    if (dup) { window.UI.toast({ title: 'Already exists', body: '“' + name + '” is already in the list.', kind: 'danger' }); return; }
                    window.Store.set(s => {
                        if (m) { s.datasets.MANUFACTURERS[index] = { name, country }; }
                        else s.datasets.MANUFACTURERS.push({ name, country });
                        if (Array.isArray(s.deletedManufacturers)) s.deletedManufacturers = s.deletedManufacturers.filter(n => n.toLowerCase() !== name.toLowerCase());
                    });
                    o.remove();
                    window.UI.toast({ title: m ? 'Manufacturer updated' : 'Manufacturer added', body: name });
                    window.Views.manufacturers();
                } }
            ]
        });
    }

    function del(index) {
        const m = list()[index];
        if (!m) return;
        const used = window.Store.materials().filter(x => x.manufacturer === m.name).length;
        window.UI.openModal({
            title: 'Delete manufacturer',
            bodyHtml: `<p>Delete <strong>${esc(m.name)}</strong>?${used ? `<br><span class="muted">${used} existing item(s) reference it — they keep their saved value.</span>` : ''}</p>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Delete', cls: 'btn-danger-outline', onClick: (o) => {
                    window.Store.set(s => {
                        s.datasets.MANUFACTURERS.splice(index, 1);
                        // tombstone: keeps the seed merge from resurrecting it on reload
                        if (!Array.isArray(s.deletedManufacturers)) s.deletedManufacturers = [];
                        if (s.deletedManufacturers.indexOf(m.name) === -1) s.deletedManufacturers.push(m.name);
                    });
                    o.remove();
                    window.UI.toast({ title: 'Manufacturer deleted', body: m.name, kind: 'danger' });
                    window.Views.manufacturers();
                } }
            ]
        });
    }
})();
