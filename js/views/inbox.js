/* ============================================================
   views/inbox.js — role task queue + requester "My requests"
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);
    const state = { tab: null, mode: 'single', collapsed: false,
        filters: { plant: '', requester: '', types: [], stages: [], from: '', to: '' } };

    function filtersActive() {
        const f = state.filters;
        return f.plant || f.requester || f.types.length || f.stages.length || f.from || f.to;
    }

    // distinct non-system stage labels across all chains (for the Stage filter);
    // 'Inventory setup' is appended dynamically to MRP-planned chains, so add it explicitly
    function stageOptions() {
        const labels = [];
        Object.keys(window.Workflow.CHAINS).forEach(t => window.Workflow.CHAINS[t].forEach(s => {
            if (!s.system && labels.indexOf(s.label) === -1) labels.push(s.label);
        }));
        if (labels.indexOf('Inventory setup') === -1) labels.push('Inventory setup');
        return labels;
    }

    function matchesFilters(r) {
        const f = state.filters;
        if (f.plant && r.requesterPlant !== f.plant) return false;
        if (f.requester && r.requesterUser !== f.requester) return false;
        if (f.types.length && f.types.indexOf(r.type) === -1) return false;
        if (f.stages.length) {
            // stage filter targets requests actively sitting at that stage
            if (r.status !== 'In Review' && r.status !== 'Approved') return false;
            const st = window.Workflow.currentStage(r);
            if (!st || f.stages.indexOf(st.label) === -1) return false;
        }
        if (f.from && r.createdTs < new Date(f.from + 'T00:00:00').getTime()) return false;
        if (f.to && r.createdTs > new Date(f.to + 'T23:59:59').getTime()) return false;
        return true;
    }

    const TYPE_CHIP = {
        create: { label: 'New item', cls: 'tc-create' },
        amend: { label: 'Amend', cls: 'tc-amend' },
        extend: { label: 'Extension', cls: 'tc-extend' },
        block: { label: 'Plant block', cls: 'tc-block' },
        reactivate: { label: 'Reactivation', cls: 'tc-react' },
        block_proc: { label: 'Procurement block', cls: 'tc-block' },
        block_total: { label: 'Total block', cls: 'tc-block' },
        unblock_central: { label: 'Unblock', cls: 'tc-react' },
        valuation: { label: 'Valuation change', cls: 'tc-amend' },
        inventory_update: { label: 'Inventory update', cls: 'tc-amend' },
        category: { label: 'New category', cls: 'tc-create' },
        bulk_create: { label: 'Bulk creation', cls: 'tc-create' },
        bulk_amend: { label: 'Bulk amendment', cls: 'tc-amend' },
        bulk_extend: { label: 'Bulk extension', cls: 'tc-extend' },
        inventory_setup: { label: 'Inventory setup', cls: 'tc-extend' },
        mdm_amend: { label: 'MDM amendment', cls: 'tc-amend' },
        bulk_minmax: { label: 'Bulk Min/Max', cls: 'tc-amend' }
    };

    // status shown as a coloured dot + plain text (per design)
    function statusDot(req) {
        const color = req.status === 'Completed' || req.status === 'Approved' ? '#6FBF3E'
            : (req.status === 'Declined' ? 'var(--danger)' : (req.status === 'Draft' ? '#B5B5B5' : '#E8B90C'));
        return `<span class="status-dot"><span class="sd-dot" style="background:${color}"></span>${esc(req.status)}</span>`;
    }

    function stageInfo(req) {
        if (req.status === 'Draft') return 'Not submitted';
        if (req.status === 'Declined') return 'Returned to requester';
        if (req.status === 'Completed') return 'All steps completed';
        const st = window.Workflow.currentStage(req);
        return st ? st.label + ' — ' + st.role : '—';
    }

    // mini progress dots across the request's stages
    function miniTracker(req) {
        const stages = window.Workflow.stagesFor(req);
        if (!stages.length || req.status === 'Draft') return '';
        const idx = req.currentStageIndex;
        // first dot mirrors the tracker's "Request created" step — always done once submitted
        const created = `<span class="mt-dot done" title="${esc('Request created — ' + req.requesterUser)}"></span>`;
        return `<div class="mini-track">${created}${stages.map((s, i) => {
            let cls = '';
            if (req.status === 'Completed') cls = 'done';
            else if (req.status === 'Declined' && i === idx) cls = 'declined';
            else if (i < idx) cls = 'done';
            else if (i === idx) cls = 'current';
            return `<span class="mt-dot ${cls}" title="${esc(s.label)}"></span>`;
        }).join('')}</div>`;
    }

    function lastActivity(req) {
        const h = req.history && req.history.length ? req.history[req.history.length - 1] : null;
        return h ? h.ts : req.createdTs;
    }

    // date format per design: 21-07-2026 10:06
    function fmtDate(ts) {
        const d = new Date(ts);
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function tableHtml(rows) {
        if (!rows.length) return `<div class="inbox-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C9CCC6" stroke-width="1.4"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
            <div style="font-weight:600;margin-top:10px;font-size:15px">Nothing here right now</div>
            <div class="muted" style="font-size:14px;margin-top:3px">New requests that need your attention will appear in this tab.</div>
        </div>`;
        return `<div class="inbox-table-wrap">
            <table class="data-table inbox-table">
                <thead><tr>
                    <th>Request</th><th>Type</th><th>Item</th><th>Requester</th><th>Plant</th><th>Stage</th><th>Status</th><th>Updated</th><th>Actions</th>
                </tr></thead>
                <tbody>${rows.map(r => {
                    const p = r.payload || {};
                    const tc = TYPE_CHIP[r.type] || { label: r.type, cls: '' };
                    const s = window.Store.session();
                    const deletable = r.status === 'Draft' && r.requesterUser === s.currentUser && s.currentRole === 'Requester';
                    const items = r.items || [];
                    const declinedN = items.filter(it => it.status === 'Declined').length;
                    const bulkSub = r.bulk ? `${items.length} item(s)${declinedN ? ' · ' + declinedN + ' declined' : ''}` : '';
                    return `<tr class="clickable" data-act="open" data-id="${r.id}">
                        <td class="it-no"># ${String(r.no || 0).padStart(4, '0')}</td>
                        <td><span class="type-chip ${tc.cls}">${esc(tc.label)}</span>${r.bulk ? '<span class="type-chip tc-bulk">Bulk</span>' : ''}</td>
                        <td class="it-item">
                            <div class="it-title">${esc(p.shortName || r.title)}</div>
                            ${r.bulk ? `<div class="it-sub">${esc(bulkSub)}</div>`
                                : (r.sapId ? `<div class="it-sub">SAP ID ${esc(r.sapId)}</div>` : (p.mfrPartNo ? `<div class="it-sub">Part # ${esc(p.mfrPartNo)}</div>` : ''))}
                        </td>
                        <td>${esc(r.requesterUser)}</td>
                        <td><span class="it-plant" title="${esc(window.UI.plantName(r.requesterPlant))}">${esc(r.requesterPlant)} — ${esc(window.UI.plantName(r.requesterPlant))}</span></td>
                        <td class="it-stage">
                            <div>${esc(stageInfo(r))}</div>
                            ${miniTracker(r)}
                        </td>
                        <td>${statusDot(r)}</td>
                        <td class="it-date">${fmtDate(lastActivity(r))}</td>
                        <td><div style="display:flex;gap:8px;align-items:center;justify-content:flex-start">
                            <button class="btn-view" data-act="open" data-id="${r.id}">View Details</button>
                            ${deletable ? `<button class="btn-view btn-view-danger" data-act="del-draft" data-id="${r.id}" title="Delete draft">Delete</button>` : ''}
                        </div></td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        </div>`;
    }

    /* ---- filter sidebar ---- */
    function sidebarHtml() {
        const f = state.filters;
        const ds = window.UI.ds();
        const requesters = [...new Set(window.Store.requests().map(r => r.requesterUser))].sort();
        const cb = (group, val, label) =>
            `<label class="checkbox-label"><input type="checkbox" data-filter="${group}" value="${esc(val)}" ${f[group].indexOf(val) !== -1 ? 'checked' : ''}> ${esc(label || val)}</label>`;
        return `<aside class="sidebar ${state.collapsed ? 'collapsed' : ''}">
            <div class="sidebar-collapse-icon" data-act="toggle-sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
            </div>
            <div class="filter-section first">
                <div class="filter-title">Plant</div>
                <select class="filter-select" data-filter-select="plant">
                    <option value="">All plants</option>
                    ${ds.PLANTS.map(p => `<option value="${esc(p.code)}" ${f.plant === p.code ? 'selected' : ''}>${esc(p.code + ' — ' + p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="filter-section">
                <div class="filter-title">Requester</div>
                <select class="filter-select" data-filter-select="requester">
                    <option value="">All requesters</option>
                    ${requesters.map(u => `<option value="${esc(u)}" ${f.requester === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}
                </select>
            </div>
            <div class="filter-section">
                <div class="filter-title">Type</div>
                <div class="checkbox-group">
                    ${Object.keys(TYPE_CHIP).filter(t => ['create','amend','extend','block','reactivate'].indexOf(t) !== -1 || window.Store.requests().some(r => r.type === t))
                        .map(t => cb('types', t, TYPE_CHIP[t].label)).join('')}
                </div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Stage</div>
                <div class="checkbox-group">
                    ${stageOptions().map(l => cb('stages', l)).join('')}
                </div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Time range</div>
                <div class="date-range">
                    <input type="date" class="form-input" data-filter-date="from" value="${esc(f.from)}">
                    <span class="muted" style="font-size:12px">to</span>
                    <input type="date" class="form-input" data-filter-date="to" value="${esc(f.to)}">
                </div>
            </div>
            <div class="filter-section">
                <button class="btn btn-outline btn-sm" data-act="clear-filters" ${filtersActive() ? '' : 'disabled'}>Clear filters</button>
            </div>
        </aside>`;
    }

    window.Views.inbox = function () {
        const root = document.getElementById('view');
        const s = window.Store.session();
        const all = window.Store.requests().filter(matchesFilters);
        let tabs, title, subtitle;

        if (s.currentRole === 'Requester') {
            title = 'My Requests';
            subtitle = 'Everything you have submitted, drafted or need to fix.';
            const mine = all.filter(r => r.requesterUser === s.currentUser);
            tabs = [
                { key: 'myapproval', label: 'Awaiting my approval', rows: mine.filter(r => window.Workflow.isAwaiting(r, 'Requester')) },
                { key: 'review', label: 'In review', rows: mine.filter(r => r.status === 'In Review') },
                { key: 'declined', label: 'Needs fix', rows: mine.filter(r => r.status === 'Declined') },
                { key: 'draft', label: 'Drafts', rows: mine.filter(r => r.status === 'Draft') },
                { key: 'done', label: 'Approved', rows: mine.filter(r => r.status === 'Completed' || r.status === 'Approved') }
            ];
        } else {
            title = 'Inbox — ' + s.currentRole;
            subtitle = 'Requests waiting for your review, and everything you have already handled.';
            const awaiting = all.filter(r => window.Workflow.isAwaiting(r, s.currentRole));
            const acted = all.filter(r => (r.history || []).some(h => h.actorRole === s.currentRole));
            tabs = [
                { key: 'todo', label: 'Awaiting my action', rows: awaiting },
                { key: 'acted', label: 'Reviewed by me', rows: acted }
            ];
        }

        if (!state.tab || !tabs.find(t => t.key === state.tab)) state.tab = tabs[0].key;
        const active = tabs.find(t => t.key === state.tab);

        const note = filtersActive()
            ? `<div class="muted" style="margin:2px 0 12px;font-size:13.5px">Filters applied — ${active.rows.length} request(s) match. <button class="btn-link" data-act="clear-filters">Clear filters</button></div>`
            : '';

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> › ${esc(title)}</div>
            <div class="workspace">
                ${sidebarHtml()}
                <main class="content-panel">
                    <div class="form-header" style="margin-bottom:4px">
                        <div>
                            <h2 style="font-size:22px;font-weight:600">${esc(title)}</h2>
                            <div class="muted" style="font-size:14px;margin-top:3px">${esc(subtitle)}</div>
                        </div>
                    </div>
                    <div class="tabs">
                        ${tabs.map(t => `<div class="tab ${t.key === state.tab ? 'active' : ''}" data-act="tab" data-tab="${t.key}">
                            ${esc(t.label)}<span class="tab-count ${t.key === state.tab ? 'active' : ''}">${t.rows.length}</span></div>`).join('')}
                    </div>
                    ${note}
                    ${(() => {
                        // single vs bulk requests are toggled via sub-tabs
                        const bulkRows = active.rows.filter(r => r.bulk);
                        const singleRows = active.rows.filter(r => !r.bulk);
                        // when the chosen list is empty but the other has rows, follow the rows
                        if (state.mode === 'bulk' && !bulkRows.length && singleRows.length) state.mode = 'single';
                        else if (state.mode === 'single' && !singleRows.length && bulkRows.length) state.mode = 'bulk';
                        const modeRows = state.mode === 'bulk' ? bulkRows : singleRows;
                        return `<div class="mode-tabs">
                            <div class="mode-tab ${state.mode === 'single' ? 'active' : ''}" data-act="mode" data-mode="single">Single requests <span class="mt-count">${singleRows.length}</span></div>
                            <div class="mode-tab ${state.mode === 'bulk' ? 'active' : ''}" data-act="mode" data-mode="bulk">Bulk requests <span class="mt-count">${bulkRows.length}</span></div>
                        </div>` + tableHtml(modeRows);
                    })()}
                </main>
            </div>`;

        window.UI.bindActions(root, {
            'home': () => window.UI.go('#/master'),
            'tab': (t) => { state.tab = t.getAttribute('data-tab'); window.Views.inbox(); },
            'mode': (t) => { state.mode = t.getAttribute('data-mode'); window.Views.inbox(); },
            'open': (t) => window.UI.go('#/request/' + t.getAttribute('data-id')),
            'del-draft': (t, e) => {
                e.stopPropagation();
                const req = window.Store.requestById(t.getAttribute('data-id'));
                if (req) window.Views.confirmDeleteDraft(req, () => window.Views.inbox());
            },
            'toggle-sidebar': () => { state.collapsed = !state.collapsed; root.querySelector('.sidebar').classList.toggle('collapsed', state.collapsed); },
            'clear-filters': () => { state.filters = { plant: '', requester: '', types: [], stages: [], from: '', to: '' }; window.Views.inbox(); }
        });

        // filter controls
        root.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('change', e => {
            const group = e.target.getAttribute('data-filter');
            const list = state.filters[group];
            const i = list.indexOf(e.target.value);
            if (e.target.checked && i === -1) list.push(e.target.value);
            if (!e.target.checked && i !== -1) list.splice(i, 1);
            window.Views.inbox();
        }));
        root.querySelectorAll('[data-filter-select]').forEach(el => el.addEventListener('change', e => {
            state.filters[e.target.getAttribute('data-filter-select')] = e.target.value;
            window.Views.inbox();
        }));
        root.querySelectorAll('[data-filter-date]').forEach(el => el.addEventListener('change', e => {
            state.filters[e.target.getAttribute('data-filter-date')] = e.target.value;
            window.Views.inbox();
        }));
    };
})();
