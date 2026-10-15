/* ============================================================
   views/bulk.js — bulk upload with history log
   #/bulk        → upload zone + history of past uploads
   #/bulk/<id>   → results of one batch (items + actions)
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);

    // LEGACY ONLY: kept so bulk batches recorded before real file parsing existed
    // keep rendering (their rows re-analyse locally; `force` pins their outcomes).
    // New uploads parse the actual file and go through the live AI engine.
    const DEMO_ROWS = [
        // ---- not in the master yet → create ----
        { desc: 'SKF deep groove ball bearing 6301-2RS, single row, 12 x 37 x 12 mm, C3 clearance' },
        { desc: 'Cast steel gate valve DN80 PN25, flanged, gear operated, GV-80-PN25' },
        { desc: 'Parker hydraulic hose DN16, two-wire braid, 350 bar working pressure, EN 856' },
        { desc: 'NSK ball bearing 6210-ZZ, single row, metal shields, 50 x 90 x 20 mm' },
        { desc: 'ESAB welding electrode OK 48.00, 3.2 mm, E7018, AC/DC' },
        { desc: 'SHTURMANN CAT6 patch cord, 3 m, UTP, RJ45 connectors' },
        { desc: 'Stainless steel ball valve DN25 PN40, threaded ends, lever operated' },
        { desc: 'FAG tapered roller bearing 32008, 40 x 68 x 19 mm' },
        // ---- already mastered in the requester's plant ----
        { desc: 'SKF ball bearing 6205-2RS, 25 x 52 x 15 mm, C3 clearance' },
        { desc: 'Manuli hydraulic hose DN20, one-wire braid, abrasion-resistant cover' },
        { desc: 'ESAB welding electrode OK 76.96, 2.5 mm, E8015-B8, DC+' },
        { desc: 'Cast steel gate valve DN150 PN16, flanged, handwheel operated, GV-150-PN16' },
        // ---- mastered in another plant → extend ----
        { desc: 'ABB miniature circuit breaker S202-C6, 6 A, C-curve, 2-pole',
          force: { outcome: 'exists_other_plant', matchId: 'mat_s10_569535' } },
        { desc: 'Siemens motor protection circuit breaker 3RV1011-1BA10, 1.4–2 A',
          force: { outcome: 'exists_other_plant', matchId: 'mat_s10_329146' } },
        // ---- no category in the system yet → category request ----
        { desc: 'Hex bolt M16 x 60 mm, grade 8.8, zinc plated' },
        { desc: 'LED lamp E27, 15 W, warm white, 1500 lumen' },
        { desc: 'Acetone solvent, technical grade, 5 litre drum' },
        { desc: 'Electrolytic capacitor 470 uF, 63 V, radial' },
        { desc: 'O-ring NBR, 50 x 3 mm, oil resistant' },
        { desc: 'Anti-corrosion primer paint, grey, 5 litre' }
    ];

    const OUTCOME_META = {
        not_found: { label: 'Not in material master', cls: 'pill-create' },
        exists_other_plant: { label: 'Exists in another plant', cls: 'pill-extend' },
        exists_my_plant: { label: 'Exists in your plant', cls: 'pill-exists' },
        category_missing: { label: 'Category not in system', cls: 'pill-nocat' },
        failed: { label: 'Could not classify', cls: 'pill-nocat' }
    };

    const MAX_ROWS = 500;          // safety cap per upload (API allows 2000)
    const POLL_MS = 4000;
    const pendingTimers = {};

    function batches() {
        const s = window.Store.get();
        if (!Array.isArray(s.bulkBatches)) s.bulkBatches = [];
        return s.bulkBatches;
    }
    function batchById(id) { return batches().find(b => b.id === id); }
    // used by the Central team dashboard to measure AI duplicate matching
    window.Views._bulkProcessRow = function (row, i) { return processRow(row, i); };

    /* ---- start a new bulk session: real descriptions → one AI-engine job ---- */
    window.Views.startBulk = function (fileName, descs) {
        const sess = window.Store.session();
        const id = window.Store.uid('blk');
        window.Store.set(s => {
            if (!Array.isArray(s.bulkBatches)) s.bulkBatches = [];
            s.bulkBatches.unshift({
                id, fileName, ts: Date.now(),
                user: sess.currentUser, plant: sess.plant,
                pending: true, engine: 'remote', jobId: null, estCost: null,
                rows: descs.map(d => ({ desc: d, actionTaken: null }))
            });
        });
        window.UI.go('#/bulk/' + id);
        // submit AFTER navigating so the pending panel is already visible
        window.AI.remoteClassify(descs.map((d, i) => ({ id: 'r' + i, Original_Description: d })))
            .then(job => {
                window.Store.set(s => {
                    const b = (s.bulkBatches || []).find(x => x.id === id);
                    if (b) { b.jobId = job.job_id; b.estCost = job.estimated_cost_usd || null; }
                });
                if (window.location.hash === '#/bulk/' + id) window.Views.bulkDetail(id);
            })
            .catch(err => {
                console.warn('Live AI engine unavailable for bulk, using the built-in engine:', err);
                localFallback(id, 'Analysed with the built-in engine instead.');
            });
    };

    // remote engine unreachable / job failed → classify every row locally so the
    // batch still completes (same fallback contract as the single search)
    function localFallback(batchId, why) {
        window.Store.set(s => {
            const b = (s.bulkBatches || []).find(x => x.id === batchId);
            if (!b) return;
            b.pending = false;
            b.engine = 'local';
            b.rows.forEach(r => { delete r.remote; delete r.failed; });
        });
        window.UI.toast({ title: 'Live AI unavailable', body: why, kind: 'info' });
        if (window.location.hash === '#/bulk/' + batchId) window.Views.bulkDetail(batchId);
    }

    window.Views.bulkMarkAction = function (batchId, index, text) {
        window.Store.set(s => {
            const b = (s.bulkBatches || []).find(x => x.id === batchId);
            if (b && b.rows[index]) b.rows[index].actionTaken = text;
        });
    };

    /* ---- analyse a row (cheap → recomputed per render so outcomes track the
       live master, e.g. an extended item downgrades to "exists in your plant") ---- */
    function processRow(row, i) {
        // rows the AI engine could not classify
        if (row.failed) {
            return { row, i, a: { parsed: { summary: row.desc, attributes: {} } }, outcome: 'failed', match: null, error: row.failed };
        }
        // rows classified by the live engine: stored parse + local outcome decision
        if (row.remote) {
            const parsed = JSON.parse(JSON.stringify(row.remote.parsed));
            const a = window.AI.assembleRemote(row.desc, parsed, row.remote.meta);
            return { row, i, a, outcome: a.outcome, match: a.exactMatch };
        }
        // legacy demo batches (and local fallback): built-in deterministic engine
        const a = window.AI.analyze(row.desc);
        const force = (DEMO_ROWS[i] || {}).force;
        let outcome = a.outcome, match = a.exactMatch;
        if (force && DEMO_ROWS[i] && DEMO_ROWS[i].desc === row.desc) {
            outcome = force.outcome;
            match = window.Store.materialById(force.matchId) || match;
            if (outcome === 'exists_other_plant' && match && match.plants.indexOf(window.Store.session().plant) !== -1) {
                outcome = 'exists_my_plant';   // was extended meanwhile → now exists here
            }
        }
        return { row, i, a, outcome, match };
    }

    /* ================= history page (#/bulk) ================= */
    /* ================= rev3: ONE unified bulk upload ================= */
    function processCardsHtml() {
        const up = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:7px;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
        const dl = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
        return `
            <div class="upload-zone" style="margin-bottom:12px;align-items:center">
                <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
                    <button class="btn btn-black" data-act="up-bulk" style="display:inline-flex;align-items:center">${up}<span>Upload file</span></button>
                    <button class="btn btn-outline" data-act="tmpl-empty" style="display:inline-flex;align-items:center">${dl}<span>Download template</span></button>
                </div>
                <div>
                    <div style="font-weight:700;margin-bottom:3px">Bulk upload</div>
                    <div class="muted" style="font-size:13px">One template for everything — descriptions, technical attributes and Min/Max inventory data.
                        The system identifies each item and proposes the action: create new, extend to your plant, amend, or view the existing record.</div>
                </div>
            </div>`;
    }

    function v2Requests() {
        return window.Store.requests().filter(r => r.v2);
    }
    function historyHtml() {
        const reqs = v2Requests();
        const legacy = batches();
        let html = '';
        if (reqs.length) {
            html += `
            <div class="section-title" style="margin-top:24px">Bulk requests</div>
            <table class="data-table">
                <thead><tr><th>Registration #</th><th>Process</th><th>Requested by</th><th>Date</th>
                    <th>Lines</th><th>Progress</th><th>Status</th></tr></thead>
                <tbody>${reqs.map(r => {
                    const done = (r.lines || []).filter(l => window.BulkFlow.lineFinal(l)).length;
                    const status = r.status === 'Completed'
                        ? '<span class="status-pill approved">Completed</span>'
                        : '<span class="status-pill in-review">In progress</span>';
                    return `<tr class="clickable" data-act="open-req" data-id="${r.id}">
                        <td style="font-weight:600">${esc(window.Workflow.reqNo(r))}</td>
                        <td>${esc(window.Workflow.typeLabel(r.type))}</td>
                        <td>${esc(r.requesterUser || '—')}</td>
                        <td>${window.UI.nowLabel(r.createdTs)}</td>
                        <td>${(r.lines || []).length}</td>
                        <td>${done} of ${(r.lines || []).length} final</td>
                        <td>${status}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
        }
        const triages = legacy.filter(b => b.v3);
        const oldOnes = legacy.filter(b => !b.v3);
        if (triages.length) {
            html += `
            <div class="section-title" style="margin-top:24px">Uploads & triage</div>
            <table class="data-table">
                <thead><tr><th>File</th><th>Uploaded by</th><th>Date</th><th>Items</th><th>Actioned</th></tr></thead>
                <tbody>${triages.map(b => `<tr class="clickable" data-act="open-batch" data-id="${b.id}">
                        <td style="font-weight:600">📄 ${esc(b.fileName)}</td>
                        <td>${esc(b.user || '—')}</td>
                        <td>${window.UI.nowLabel(b.ts)}</td>
                        <td>${b.rows.length}</td>
                        <td>${b.rows.filter(r => r.actionTaken).length} of ${b.rows.length}</td>
                    </tr>`).join('')}</tbody>
            </table>`;
        }
        if (oldOnes.length) {
            html += `
            <div class="section-title" style="margin-top:24px">Earlier uploads (legacy)</div>
            <table class="data-table">
                <thead><tr><th>File</th><th>Uploaded by</th><th>Date</th><th>Items</th></tr></thead>
                <tbody>${oldOnes.map(b => `<tr class="clickable" data-act="open-batch" data-id="${b.id}">
                        <td style="font-weight:600">📄 ${esc(b.fileName)}</td>
                        <td>${esc(b.user || '—')}</td>
                        <td>${window.UI.nowLabel(b.ts)}</td>
                        <td>${b.rows.length}</td>
                    </tr>`).join('')}</tbody>
            </table>`;
        }
        if (!html) html = `<div class="empty-state">No bulk requests yet. Upload a filled template to start.</div>`;
        return html;
    }

    window.Views.bulk = function () {
        const root = document.getElementById('view');
        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> › Bulk processing</div>
            <div class="page-narrow" style="padding-top:4px">
                <div class="form-header" style="margin-top:6px">
                    <div>
                        <h2 style="font-size:20px;font-weight:600">Bulk processing</h2>
                        <div class="muted" style="font-size:13px;margin-top:2px">One Registration Number per upload, one Line ID per material — every line keeps its own status, workflow position and history.</div>
                    </div>
                </div>
                ${processCardsHtml()}
                <input type="file" id="bulk-file" accept=".xlsx,.xls,.csv" hidden>
                ${historyHtml()}
            </div>`;
        bindCommon(root);
        window.UI.bindActions(root, Object.assign(commonActions(root), {
            'open-batch': (t) => window.UI.go('#/bulk/' + t.getAttribute('data-id')),
            'open-req': (t) => window.UI.go('#/request/' + t.getAttribute('data-id')),
            'up-bulk': () => pickFile(root, handleUnifiedFile),
            'tmpl-empty': () => window.UI.exportXlsx([
                ['Description', 'Long description', 'Manufacturer', 'Part number', 'Model', 'Base UoM',
                 'Technical attributes', 'Min', 'Max', 'Reorder point', 'Safety stock']
            ], 'Bulk upload', 'dmp_bulk_upload_template.xlsx')
        }));
    };

    /* ================= batch results page (#/bulk/<id>) ================= */
    function summaryHtml(items) {
        const count = (o) => items.filter(x => x.outcome === o && !x.row.actionTaken).length;
        const done = items.filter(x => x.row.actionTaken).length;
        const chip = (n, label, cls) => `<span class="bulk-sum ${cls}">${n} ${label}</span>`;
        return `<div class="bulk-summary">
            ${chip(count('not_found'), 'to create', 'pill-create')}
            ${chip(count('exists_other_plant'), 'to extend', 'pill-extend')}
            ${chip(count('exists_my_plant'), 'already in your plant', 'pill-exists')}
            ${chip(count('category_missing'), 'need a category', 'pill-nocat')}
            ${count('failed') ? chip(count('failed'), 'could not classify', 'pill-nocat') : ''}
            ${done ? chip(done, 'actioned', 'pill-done') : ''}
        </div>`;
    }

    // the request a processed row belongs to — resolved from the "Request # NNNN"
    // in its action text (covers bulk submissions and single-item flows alike)
    function rowRequest(row) {
        const m = String(row.actionTaken || '').match(/#\s*0*(\d+)/);
        if (!m) return null;
        return window.Store.requests().find(r => r.no === Number(m[1])) || null;
    }
    function actionCell(x) {
        if (x.row.actionTaken) {
            const req = rowRequest(x.row);
            return req
                ? `<button class="bulk-done bulk-done-link" data-act="open-row-req" data-i="${x.i}" title="Open ${esc(window.Workflow.reqNo(req))}">✓ ${esc(x.row.actionTaken)} ›</button>`
                : `<span class="bulk-done">✓ ${esc(x.row.actionTaken)}</span>`;
        }
        switch (x.outcome) {
            case 'not_found':
                return `<button class="btn btn-black btn-sm" data-act="bulk-create" data-i="${x.i}">Create new item</button>`;
            case 'exists_other_plant':
                return `<button class="btn btn-green btn-sm" data-act="bulk-extend" data-i="${x.i}">↗ Extend to my plant</button>`;
            case 'exists_my_plant':
                return `<span class="muted" style="font-size:12px;margin-right:8px">No action needed</span>
                    <button class="btn btn-outline btn-sm" data-act="bulk-view" data-i="${x.i}">View record</button>`;
            case 'category_missing':
                return `<button class="btn btn-outline btn-sm" data-act="bulk-cat" data-i="${x.i}">Request category</button>`;
            case 'failed':
                return `<span class="muted" style="font-size:12px" title="${esc(x.error || '')}">Review the description and try a single search</span>`;
        }
        return '';
    }

    /* ---- one-click bulk submission: all rows sharing the same needed action
       are submitted together as ONE bulk request for the approval chain ---- */
    function bulkActionsHtml(items) {
        const pend = (o) => items.filter(x => x.outcome === o && !x.row.actionTaken);
        const creates = pend('not_found').length;
        const extends_ = pend('exists_other_plant').length;
        const cats = pend('category_missing').length;
        if (creates + extends_ + cats === 0) return '';
        return `<div class="bulk-actions-bar">
            <span class="bab-label">Bulk actions</span>
            ${creates ? `<button class="btn btn-black btn-sm" data-act="bulk-all-create">Create all new items (${creates})</button>` : ''}
            ${extends_ ? `<button class="btn btn-green btn-sm" data-act="bulk-all-extend">↗ Extend all to my plant (${extends_})</button>` : ''}
            ${cats ? `<button class="btn btn-outline btn-sm" data-act="bulk-all-cat">Request all categories (${cats})</button>` : ''}
            <span class="muted" style="font-size:12px">One request per action — approvers review the whole batch at once.</span>
        </div>`;
    }

    function resultsHtml(batch) {
        const items = batch.rows.map((r, i) => processRow(r, i));
        return `
            ${summaryHtml(items)}
            ${bulkActionsHtml(items)}
            <table class="data-table bulk-table">
                <thead><tr>
                    <th style="width:34px">#</th>
                    <th>Uploaded description</th>
                    <th>AI-identified item</th>
                    <th>Category · UNSPSC</th>
                    <th>Result</th>
                    <th style="width:220px">Action</th>
                </tr></thead>
                <tbody>${items.map(x => {
                    const om = OUTCOME_META[x.outcome] || {};
                    const p = x.a.parsed;
                    const cat = p.materialGroup ? `${esc(p.unspscLabel)} · ${esc(p.unspsc)}` : '<span class="muted">—</span>';
                    const plantHint = x.outcome === 'exists_other_plant' && x.match ? `<div class="muted" style="font-size:11px;margin-top:2px">In plant ${esc(x.match.plants[0])} — ${esc(window.UI.plantName(x.match.plants[0]))}</div>` :
                        (x.outcome === 'exists_my_plant' && x.match ? `<div class="muted" style="font-size:11px;margin-top:2px">SAP ID ${esc(x.match.sapId || '—')}</div>` : '');
                    const rowReq = x.row.actionTaken ? rowRequest(x.row) : null;
                    // processed rows open their request; "already in your plant" rows open the item record
                    const rowAttrs = rowReq
                        ? `class="clickable" data-act="open-row-req" data-i="${x.i}" title="Open ${esc(window.Workflow.reqNo(rowReq))}"`
                        : (!x.row.actionTaken && x.outcome === 'exists_my_plant' && x.match
                            ? `class="clickable" data-act="bulk-view" data-i="${x.i}" title="Open ${esc(x.match.shortName || x.match.name)}"` : '');
                    return `<tr ${rowAttrs}>
                        <td class="muted">${x.i + 1}</td>
                        <td style="max-width:260px"><div class="bulk-desc">${esc(x.row.desc)}</div></td>
                        <td style="max-width:200px;font-weight:600">${esc(p.shortName || p.summary)}</td>
                        <td>${cat}</td>
                        <td><span class="status-pill ${om.cls}">${esc(om.label || x.outcome)}</span>${plantHint}</td>
                        <td>${actionCell(x)}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
    }

    window.Views.bulkDetail = function (id) {
        const root = document.getElementById('view');
        const batch = batchById(id);
        if (!batch) {
            root.innerHTML = `<div class="page-narrow"><div class="empty-state">Bulk upload not found. <button class="btn-link" data-act="to-bulk">Back to Bulk upload</button></div></div>`;
            window.UI.bindActions(root, { 'to-bulk': () => window.UI.go('#/bulk') });
            return;
        }

        let body;
        if (batch.pending) {
            const pr = batch.progress || {};
            const total = batch.rows.length;
            const doneN = pr.products_done || 0;
            const pct = total ? Math.round(doneN / total * 100) : 0;
            body = `<div class="ai-panel" style="margin-top:18px"><div class="ai-panel-head">✦ AI Mastering — processing “${esc(batch.fileName)}”</div>
                <div class="ai-panel-body"><div class="ai-steps">
                    <div class="ai-step"><span class="tick">✓</span>File received — ${total} descriptions found</div>
                    <div class="ai-step"><span class="tick">${batch.jobId ? '✓' : ''}</span>${batch.jobId
                        ? `Submitted to the live AI engine${batch.estCost ? ' · est. $' + Number(batch.estCost).toFixed(2) : ''}`
                        : '<span class="spinner"></span> Submitting to the AI engine…'}</div>
                    <div class="ai-step"><span class="spinner"></span><span class="muted" id="bulk-progress-note">${batch.jobId
                        ? `AI pipeline running — ${doneN} of ${total} item(s) processed (${pct}%)…`
                        : 'Waiting for the engine to accept the job…'}</span></div>
                </div></div></div>`;
            armPoller(id);
        } else {
            body = batch.v3 ? triageHtml(batch) : `${resultsHtml(batch)}`;
        }

        const done = batch.rows.filter(r => r.actionTaken).length;
        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> ›
                <span class="crumb-link" data-act="to-bulk">Bulk upload</span> › ${esc(batch.fileName)}</div>
            <div class="page-narrow" style="padding-top:4px">
                <div class="back-link" data-act="to-bulk">‹ Back to upload history</div>
                <div class="form-header" style="margin-top:2px">
                    <div>
                        <h2 style="font-size:20px;font-weight:600">Results — ${esc(batch.fileName)}</h2>
                        <div class="muted" style="font-size:13px;margin-top:2px">
                            ${batch.rows.length} descriptions · uploaded by ${esc(batch.user || '—')} (Plant ${esc(batch.plant || '—')}) · ${window.UI.nowLabel(batch.ts)}${batch.pending ? '' : ' · ' + done + ' actioned'}</div>
                    </div>
                </div>
                ${body}
            </div>`;

        bindCommon(root);
        window.UI.bindActions(root, Object.assign(commonActions(root), {
            'to-bulk': () => window.UI.go('#/bulk'),
            'bulk-create': (t) => {
                const i = +t.getAttribute('data-i');
                const a = processRow(batch.rows[i], i).a;   // remote parse when available
                window.Views._draft = { type: 'create', payload: window.AI.toPayload(a), analysis: a, fromBulk: { batch: batch.id, i } };
                window.UI.go('#/request/new?type=create');
            },
            'bulk-extend': (t) => {
                const i = +t.getAttribute('data-i');
                const x = processRow(batch.rows[i], i);
                if (!x.match) return;
                window.Views._draft = { type: 'extend', materialId: x.match.id, fromBulk: { batch: batch.id, i } };
                window.UI.go('#/request/new?type=extend&mat=' + x.match.id);
            },
            'bulk-view': (t) => {
                const i = +t.getAttribute('data-i');
                const x = processRow(batch.rows[i], i);
                if (x.match) window.UI.go('#/item/' + x.match.id);
            },
            'bulk-cat': (t) => {
                const i = +t.getAttribute('data-i');
                const x = processRow(batch.rows[i], i);
                const cs = x.a && x.a.categorySuggestion;
                if (!cs) { window.UI.toast({ title: 'No proposal available', body: 'The AI produced no category proposal for this row.', kind: 'danger' }); return; }
                const payload = Object.assign({ sourceText: x.row.desc, name: cs.categoryName, shortName: cs.categoryName },
                    JSON.parse(JSON.stringify(cs)));
                const req = window.Workflow.createRequest({ type: 'category', payload });
                window.Views.bulkMarkAction(batch.id, i, 'Category requested — ' + window.Workflow.reqNo(req));
                window.UI.toast({ title: 'Category request submitted', body: window.Workflow.reqNo(req) + ' — “' + cs.categoryName + '” sent to the Central team.', kind: 'info' });
                window.Views.bulkDetail(batch.id);
            },
            'open-row-req': (t) => {
                const req = rowRequest(batch.rows[+t.getAttribute('data-i')]);
                if (req) window.UI.go('#/request/' + req.id);
            },
            'bulk-all-create': () => submitBulkAction(batch, 'not_found'),
            'bulk-all-extend': () => submitBulkAction(batch, 'exists_other_plant'),
            'bulk-all-cat': () => submitBulkAction(batch, 'category_missing')
        }, batch.v3 ? triageActions(batch) : {}));
    };

    /* ---- poll the AI-engine job of a pending batch until it completes ----
       An immediate check runs on every render and whenever the tab becomes
       visible again (a hidden tab's timers can be frozen by the browser, so a
       timer chain alone can stall); between checks a timer re-polls. Completed
       results are written to the store, so the batch is ready even if the user
       navigated away in the meantime. ---- */
    const pollInFlight = {};
    function schedulePoll(id) {
        if (pendingTimers[id]) return;
        pendingTimers[id] = setTimeout(() => { delete pendingTimers[id]; pollBatch(id); }, POLL_MS);
    }
    function armPoller(id) { pollBatch(id); }
    if (typeof document !== 'undefined' && !document.__bulkVisBound) {
        document.__bulkVisBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            const m = window.location.hash.match(/^#\/bulk\/([^/?]+)/);
            if (m && batchById(m[1]) && batchById(m[1]).pending) pollBatch(m[1]);
        });
    }
    async function pollBatch(id) {
        if (pollInFlight[id]) return;
        pollInFlight[id] = true;
        clearTimeout(pendingTimers[id]); delete pendingTimers[id];
        try {
            const b = batchById(id);
            if (!b || !b.pending) return;
            if (!b.jobId) { schedulePoll(id); return; }     // submission still in flight
            let d;
            try {
                d = await window.AI.remoteJob(b.jobId);
            } catch (err) {
                console.warn('Bulk job poll failed:', err);
                schedulePoll(id);                           // transient — keep polling
                return;
            }
            if (d.status === 'completed') {
                const byId = {};
                (d.results || []).forEach(r => { if (r && r.id !== undefined) byId[String(r.id)] = r; });
                window.Store.set(s => {
                    const b2 = (s.bulkBatches || []).find(x => x.id === id);
                    if (!b2) return;
                    b2.pending = false;
                    b2.rows.forEach((row, i) => {
                        const r = byId['r' + i];
                        if (!r || r.Success === false) {
                            row.failed = (r && r.error_message) || 'The AI engine returned no result for this row';
                        } else {
                            row.remote = window.AI.mapRemoteRow(row.desc, r);   // {parsed, meta} — JSON-safe
                        }
                    });
                });
                if (window.location.hash === '#/bulk/' + id) window.Views.bulkDetail(id);
                return;
            }
            if (d.status === 'failed' || d.status === 'cancelled') {
                localFallback(id, 'The AI job ' + d.status + (d.error ? ' — ' + d.error : '') + '. Analysed with the built-in engine instead.');
                return;
            }
            // still processing → update progress and keep polling
            window.Store.set(s => {
                const b2 = (s.bulkBatches || []).find(x => x.id === id);
                if (b2) b2.progress = d.progress || {};
            });
            const note = document.getElementById('bulk-progress-note');
            if (note && window.location.hash === '#/bulk/' + id) {
                const pr = d.progress || {};
                const total = (batchById(id) || { rows: [] }).rows.length;
                const doneN = pr.products_done || 0;
                note.textContent = `AI pipeline running — ${doneN} of ${total} item(s) processed (${total ? Math.round(doneN / total * 100) : 0}%)…`;
            }
            schedulePoll(id);
        } finally {
            pollInFlight[id] = false;
        }
    }

    /* ---- submit ONE bulk request for every pending row with the given outcome ---- */
    function submitBulkAction(batch, outcome) {
        const rows = batch.rows.map((r, i) => processRow(r, i)).filter(x => x.outcome === outcome && !x.row.actionTaken);
        if (!rows.length) return;
        // bulk creates first ask which record type the batch should be created as
        if (outcome === 'not_found') return askRecordType(batch, rows);
        doSubmitBulkAction(batch, rows, outcome);
    }

    // golden = full record (technical attributes mandatory further down the chain);
    // sourcing = quick incomplete record — attributes optional, enriched later
    function askRecordType(batch, rows) {
        window.UI.openModal({
            title: 'Create ' + rows.length + ' new item' + (rows.length === 1 ? '' : 's'),
            bodyHtml: `
                <div class="muted" style="margin-bottom:14px;font-size:13.5px">Choose how this batch should be created:</div>
                <label class="checkbox-label" style="align-items:flex-start;margin-bottom:12px">
                    <input type="radio" name="blk-rectype" value="Golden record" checked style="margin-top:3px">
                    <span><strong>Golden record</strong> — complete master record.<br>
                        <span class="muted" style="font-size:12.5px">Technical attributes are mandatory and reviewed in full.</span></span>
                </label>
                <label class="checkbox-label" style="align-items:flex-start">
                    <input type="radio" name="blk-rectype" value="Sourcing record" style="margin-top:3px">
                    <span><strong>Sourcing record</strong> — quick incomplete record.<br>
                        <span class="muted" style="font-size:12.5px">Technical attributes are optional; the record is enriched later.</span></span>
                </label>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: rows.length === 1 ? 'Submit request' : 'Submit bulk request', cls: 'btn-green', onClick: (o) => {
                    const rt = (o.querySelector('[name="blk-rectype"]:checked') || {}).value || 'Golden record';
                    o.remove();
                    doSubmitBulkAction(batch, rows, 'not_found', rt);
                } }
            ]
        });
    }

    function doSubmitBulkAction(batch, rows, outcome, recordType) {
        const type = { not_found: 'create', exists_other_plant: 'extend', category_missing: 'category' }[outcome];
        // a single qualifying row becomes a normal SINGLE request — approvers
        // should never see a "bulk" wrapper around one item
        if (rows.length === 1) {
            const x = rows[0];
            let req = null;
            if (type === 'create') {
                const payload = window.AI.toPayload(x.a);
                payload.recordType = recordType || 'Golden record';
                if (!payload.shortName) {
                    const sd = window.AI.structuredDesc(payload);
                    payload.shortName = sd.shortName || payload.name || x.row.desc;
                    payload.longDesc = payload.longDesc || sd.longDesc;
                }
                req = window.Workflow.createRequest({ type: 'create', payload });
            } else if (type === 'extend') {
                const m = x.match;
                if (!m) return;
                req = window.Workflow.createRequest({ type: 'extend', materialId: m.id,
                    payload: { shortName: m.shortName, name: m.name, longDesc: m.longDesc,
                        unspsc: m.unspsc, unspscLabel: m.unspscLabel, materialGroup: m.materialGroup,
                        manufacturer: m.manufacturer, mfrPartNo: m.mfrPartNo, baseUom: m.baseUom,
                        sapIdSource: m.sapId } });
            } else {
                const cs = x.a.categorySuggestion;
                if (!cs) { window.UI.toast({ title: 'No proposal available', body: 'The AI produced no category proposal for this row.', kind: 'danger' }); return; }
                req = window.Workflow.createRequest({ type: 'category',
                    payload: Object.assign({ sourceText: x.row.desc, name: cs.categoryName, shortName: cs.categoryName },
                        JSON.parse(JSON.stringify(cs))) });
            }
            if (!req) return;
            window.Views.bulkMarkAction(batch.id, x.i, 'Submitted — ' + window.Workflow.reqNo(req));
            const st1 = window.Workflow.stagesFor(req)[0];
            window.UI.toast({ title: 'Request submitted',
                body: window.Workflow.reqNo(req) + ' — sent to ' + (st1 ? st1.role : 'review') + '.', kind: 'info' });
            window.UI.go('#/request/' + req.id);
            return;
        }
        const items = [];
        rows.forEach(x => {
            if (type === 'create') {
                const payload = window.AI.toPayload(x.a);
                payload.recordType = recordType || 'Golden record';
                if (!payload.shortName) {
                    const sd = window.AI.structuredDesc(payload);
                    payload.shortName = sd.shortName || payload.name || x.row.desc;
                    payload.longDesc = payload.longDesc || sd.longDesc;
                }
                items.push({ desc: x.row.desc, payload });
            } else if (type === 'extend') {
                if (!x.match) return;
                items.push({ desc: x.row.desc, materialId: x.match.id,
                    payload: { shortName: x.match.shortName, name: x.match.name, unspsc: x.match.unspsc, sapIdSource: x.match.sapId } });
            } else {
                const cs = x.a.categorySuggestion;
                if (!cs) return;
                items.push({ desc: x.row.desc, payload: Object.assign({ sourceText: x.row.desc,
                    name: cs.categoryName, shortName: cs.categoryName }, JSON.parse(JSON.stringify(cs))) });
            }
        });
        if (!items.length) return;
        const req = window.Workflow.createBulkRequest({ type, items });
        if (recordType === 'Sourcing record') {
            window.Store.set(s => {
                const r = s.requests.find(x => x.id === req.id);
                if (r) r.title = 'Bulk new sourcing items — ' + items.length + ' items';
            });
        }
        window.Store.set(s => {
            const b = (s.bulkBatches || []).find(z => z.id === batch.id);
            if (b) rows.forEach(x => { if (b.rows[x.i]) b.rows[x.i].actionTaken = 'Submitted in bulk — ' + window.Workflow.reqNo(req); });
        });
        const firstStage = window.Workflow.stagesFor(req)[0];
        window.UI.toast({ title: 'Bulk request submitted',
            body: window.Workflow.reqNo(req) + ' — ' + items.length + ' item(s) sent to ' + (firstStage ? firstStage.role : 'review') + '.', kind: 'info' });
        window.UI.go('#/request/' + req.id);
    }

    /* ---- shared bits ---- */
    function commonActions(root) {
        void root;
        return { 'home': () => window.UI.go('#/master') };
    }

    let fileHandler = null;
    function pickFile(root, handler) {
        fileHandler = handler;
        const fi = root.querySelector('#bulk-file');
        if (fi) fi.click();
    }
    function bindCommon(root) {
        const fi = root.querySelector('#bulk-file');
        if (fi) fi.addEventListener('change', e => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (f && fileHandler) fileHandler(f);
        });
    }

    /* ================= rev3 unified intake ================= */
    const UNI_COLS = [
        { key: 'desc', match: /^(item\s+|short\s+)?description$/i, required: true },
        { key: 'longDesc', match: /long/i },
        { key: 'manufacturer', match: /manufacturer|mfr(?!.*part)/i },
        { key: 'mfrPartNo', match: /part/i },
        { key: 'model', match: /model/i },
        { key: 'baseUom', match: /uom|unit/i },
        { key: 'attrs', match: /attribute/i },
        { key: 'min', match: /^min$|minimum/i },
        { key: 'max', match: /^max$|maximum/i },
        { key: 'reorder', match: /reorder/i },
        { key: 'safety', match: /safety/i }
    ];
    // "Name=Value; Name=Value" (or "Name: Value") → {name: value}
    function parseAttrPairs(str) {
        const out = {};
        String(str || '').split(/[;|]/).forEach(tok => {
            const m = tok.match(/^\s*([^=:]+?)\s*[=:]\s*(.+?)\s*$/);
            if (m) out[m[1]] = m[2];
        });
        return out;
    }
    async function handleUnifiedFile(f) {
        let tbl;
        try {
            const rows = await window.Spreadsheet.parseFile(f);
            tbl = window.Spreadsheet.extractTable(rows, UNI_COLS);
        } catch (err) {
            window.UI.toast({ title: 'Could not read the file', body: String(err && err.message || err), kind: 'danger' });
            return;
        }
        if (tbl.error) { window.UI.toast({ title: 'File not usable', body: tbl.error, kind: 'danger' }); return; }
        let items = tbl.records.filter(r => r.desc);
        if (!items.length) {
            window.UI.toast({ title: 'No items found', body: 'The file has no rows with a description. See the template for the expected columns.', kind: 'danger' });
            return;
        }
        let capNote = '';
        if (items.length > MAX_ROWS) {
            capNote = `<div class="banner warn" style="margin-top:10px"><div class="banner-body">The file has ${items.length} rows — only the first ${MAX_ROWS} will be processed.</div></div>`;
            items = items.slice(0, MAX_ROWS);
        }
        const withInv = items.filter(r => r.min || r.max || r.reorder || r.safety).length;
        const withAttrs = items.filter(r => r.attrs).length;
        const sample = items.slice(0, 3).map(r =>
            `<li style="margin:3px 0">${esc(r.desc.length > 90 ? r.desc.slice(0, 90) + '…' : r.desc)}</li>`).join('');
        window.UI.openModal({
            title: 'Analyze bulk upload — “' + f.name + '”?',
            bodyHtml: `
                <div style="font-size:13.5px;margin-bottom:8px"><strong>${items.length}</strong> item(s) found${withAttrs ? ' · ' + withAttrs + ' with technical attributes' : ''}${withInv ? ' · ' + withInv + ' with Min/Max inventory data' : ''}.</div>
                <ul class="muted" style="font-size:12.5px;padding-left:18px;margin:6px 0">${sample}</ul>
                ${items.length > 3 ? `<div class="muted" style="font-size:12px">…and ${items.length - 3} more.</div>` : ''}
                ${capNote}
                <div class="muted" style="font-size:12.5px;margin-top:10px">The AI engine identifies every item and compares it with the material master and the category catalogue.
                You will then see the proposed action per item — <strong>create new</strong>, <strong>extend to your plant</strong>, <strong>amend</strong> or <strong>view the existing record</strong> —
                and whether it qualifies as a Golden record (all mandatory attributes filled) or a Sourcing record.</div>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Analyze items', cls: 'btn-black', onClick: (o) => { o.remove(); startTriage(f.name, items); } }
            ]
        });
    }

    function startTriage(fileName, items) {
        const sess = window.Store.session();
        const id = window.Store.uid('blk');
        window.Store.set(s => {
            if (!Array.isArray(s.bulkBatches)) s.bulkBatches = [];
            s.bulkBatches.unshift({
                id, v3: true, fileName, ts: Date.now(),
                user: sess.currentUser, plant: sess.plant,
                pending: true, engine: 'remote', jobId: null, estCost: null,
                rows: items.map(r => ({
                    desc: r.desc, actionTaken: null,
                    up: {
                        longDesc: r.longDesc || '', manufacturer: r.manufacturer || '',
                        mfrPartNo: r.mfrPartNo || '', model: r.model || '', baseUom: (r.baseUom || '').toUpperCase(),
                        attrPairs: parseAttrPairs(r.attrs),
                        inv: { mrpControllerMin: r.min || '', mrpControllerMax: r.max || '', reorderPoint: r.reorder || '', safetyStock: r.safety || '' }
                    }
                }))
            });
        });
        window.UI.go('#/bulk/' + id);
        window.AI.remoteClassify(items.map((r, i) => ({ id: 'r' + i, Original_Description: r.desc })))
            .then(job => {
                window.Store.set(s => {
                    const b = (s.bulkBatches || []).find(x => x.id === id);
                    if (b) { b.jobId = job.job_id; b.estCost = job.estimated_cost_usd || null; }
                });
                if (window.location.hash === '#/bulk/' + id) window.Views.bulkDetail(id);
            })
            .catch(err => {
                console.warn('Live AI engine unavailable for bulk, using the built-in engine:', err);
                localFallback(id, 'Analysed with the built-in engine instead.');
            });
    }

    /* ================= rev3 triage — per-item action decision ================= */
    const ACTION_META = {
        create: { label: 'Create new', cls: 'pill-create' },
        extend: { label: 'Extend to my plant', cls: 'pill-extend' },
        amend: { label: 'Amend existing', cls: 'pill-nocat' },
        view: { label: 'Exact match', cls: 'pill-exists' },
        nocat: { label: 'Category not in system', cls: 'pill-nocat' },
        failed: { label: 'Could not classify', cls: 'pill-nocat' }
    };
    const UP_FIELDS = ['longDesc', 'manufacturer', 'mfrPartNo', 'model', 'baseUom'];
    function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
    function invOf(u) {
        const out = {};
        Object.keys((u || {}).inv || {}).forEach(k => { if (String(u.inv[k] || '').trim()) out[k] = u.inv[k]; });
        return out;
    }
    function analyse3(row) {
        if (row.failed) return null;
        if (row.remote) {
            const parsed = JSON.parse(JSON.stringify(row.remote.parsed));
            return window.AI.assembleRemote(row.desc, parsed, row.remote.meta);
        }
        return window.AI.analyze(row.desc);
    }
    // recomputed per render so actions track the live master and catalogue
    function processRow3(row, i) {
        if (row.failed) return { row, i, action: 'failed', error: row.failed };
        const a = analyse3(row);
        const u = row.up || {};
        const inv = invOf(u);
        const m = a.exactMatch;
        if ((a.outcome === 'exists_my_plant' || a.outcome === 'exists_other_plant') && m) {
            // uploaded (non-empty) fields vs the mastered record → amendment diff
            const changes = {};
            UP_FIELDS.forEach(k => {
                if (u[k] && String(u[k]) !== String(m[k] || '')) changes[k] = { from: m[k] || '', to: u[k] };
            });
            const pairs = u.attrPairs || {};
            const mAttrs = m.attributes || {};
            let attrChanged = false;
            Object.keys(pairs).forEach(n => {
                const mk = Object.keys(mAttrs).find(k => normName(k) === normName(n)) || n;
                if (String(mAttrs[mk] || '') !== String(pairs[n])) attrChanged = true;
            });
            if (attrChanged) {
                const to = Object.assign({}, mAttrs);
                Object.keys(pairs).forEach(n => {
                    const mk = Object.keys(to).find(k => normName(k) === normName(n)) || n;
                    to[mk] = pairs[n];
                });
                changes.attributes = { from: mAttrs, to };
            }
            if (Object.keys(inv).length) {
                const mi = window.UI.invFor(m, window.Store.session().plant) || {};
                if (Object.keys(inv).some(k => String(mi[k] || '') !== String(inv[k]))) {
                    changes.inventory = { from: Object.assign({}, mi), to: Object.assign({}, mi, inv) };
                }
            }
            if (Object.keys(changes).length) return { row, i, a, action: 'amend', match: m, changes };
            return { row, i, a, action: a.outcome === 'exists_my_plant' ? 'view' : 'extend', match: m };
        }
        if (a.outcome === 'category_missing' && !window.UI.categorySchema((a.parsed || {}).unspsc)) {
            return { row, i, a, action: 'nocat' };
        }
        // ---- new material: AI payload + uploaded overrides ----
        const payload = window.AI.toPayload(a);
        UP_FIELDS.forEach(k => { if (u[k]) payload[k] = u[k]; });
        const schema = window.UI.categorySchema(payload.unspsc);
        const pairs = u.attrPairs || {};
        Object.keys(pairs).forEach(n => {
            let key = n;
            if (schema) {
                const sa = schema.attributes.find(x => normName(x.name) === normName(n));
                if (sa) key = sa.name;
            } else {
                const ek = Object.keys(payload.attributes).find(k => normName(k) === normName(n));
                if (ek) key = ek;
            }
            payload.attributes[key] = pairs[n];
        });
        if (Object.keys(inv).length) payload.inventory = inv;
        // Golden vs Sourcing: decided by the category catalogue's mandatory attributes
        let recordType = 'Sourcing record';
        if (schema) {
            const mand = schema.attributes.filter(x => x.mandatory);
            recordType = mand.every(x => String(payload.attributes[x.name] || '').trim() !== '') ? 'Golden record' : 'Sourcing record';
        }
        payload.recordType = recordType;
        // near matches flagged for the MDM deduplication stage
        const sim = (a.similar || [])[0];
        const dup = sim && (sim.unspsc === payload.unspsc || (payload.manufacturer && sim.manufacturer === payload.manufacturer))
            ? { matchId: sim.id, name: sim.shortName || sim.name } : null;
        return { row, i, a, action: 'create', payload, recordType, dup };
    }

    function summary3(items) {
        const count = (act) => items.filter(x => x.action === act && !x.row.actionTaken).length;
        const done = items.filter(x => x.row.actionTaken).length;
        const chip = (n, label, cls) => n ? `<span class="bulk-sum ${cls}">${n} ${label}</span>` : '';
        return `<div class="bulk-summary">
            ${chip(count('create'), 'to create', 'pill-create')}
            ${chip(count('extend'), 'to extend', 'pill-extend')}
            ${chip(count('amend'), 'to amend', 'pill-nocat')}
            ${chip(count('view'), 'exact matches', 'pill-exists')}
            ${chip(count('nocat'), 'need a category', 'pill-nocat')}
            ${chip(count('failed'), 'could not classify', 'pill-nocat')}
            ${chip(done, 'actioned', 'pill-done')}
        </div>`;
    }
    function bulkBar3(items) {
        const n = (act) => items.filter(x => x.action === act && !x.row.actionTaken).length;
        const creates = n('create'), extends_ = n('extend'), amends = n('amend');
        const isMdm = window.Store.session().currentRole === 'MDM Specialist';
        if (creates + extends_ + amends === 0) return '';
        return `<div class="bulk-actions-bar">
            <span class="bab-label">Bulk actions</span>
            ${creates ? `<button class="btn btn-black btn-sm" data-act="t3-all-create">Create all new items (${creates})</button>` : ''}
            ${extends_ ? `<button class="btn btn-green btn-sm" data-act="t3-all-extend">↗ Extend all to my plant (${extends_})</button>` : ''}
            ${amends ? (isMdm
                ? `<button class="btn btn-green btn-sm" data-act="t3-all-amend">✎ Apply all amendments directly (${amends})</button>`
                : `<button class="btn btn-outline btn-sm" data-act="t3-all-amend">✎ Amend all (${amends})</button>`) : ''}
            <span class="muted" style="font-size:12px">${isMdm && amends
                ? 'MDM amendments are applied immediately — no approval chain; every change is logged on the item.'
                : 'One request per action — approvers review the whole batch at once.'}</span>
        </div>`;
    }
    function actionCell3(x) {
        if (x.row.actionTaken) {
            const req = rowRequest(x.row);
            return req
                ? `<button class="bulk-done bulk-done-link" data-act="open-row-req" data-i="${x.i}" title="Open ${esc(window.Workflow.reqNo(req))}">✓ ${esc(x.row.actionTaken)} ›</button>`
                : `<span class="bulk-done">✓ ${esc(x.row.actionTaken)}</span>`;
        }
        switch (x.action) {
            case 'create':
                return `<button class="btn btn-black btn-sm" data-act="t3-create" data-i="${x.i}">Create new</button>`;
            case 'extend':
                return `<button class="btn btn-green btn-sm" data-act="t3-extend" data-i="${x.i}">↗ Extend</button>`;
            case 'amend':
                return window.Store.session().currentRole === 'MDM Specialist'
                    ? `<button class="btn btn-green btn-sm" data-act="t3-amend" data-i="${x.i}">✎ Apply directly</button>`
                    : `<button class="btn btn-outline btn-sm" data-act="t3-amend" data-i="${x.i}">✎ Amend</button>`;
            case 'view':
                return `<button class="btn btn-outline btn-sm" data-act="t3-view" data-i="${x.i}">View record</button>`;
            case 'nocat':
                return `<button class="btn btn-outline btn-sm" data-act="t3-cat" data-i="${x.i}">Request category</button>`;
            case 'failed':
                return `<span class="muted" style="font-size:12px" title="${esc(x.error || '')}">Review the description and try a single search</span>`;
        }
        return '';
    }
    function triageHtml(batch) {
        const items = batch.rows.map((r, i) => processRow3(r, i));
        return `
            ${summary3(items)}
            ${bulkBar3(items)}
            <table class="data-table bulk-table">
                <thead><tr>
                    <th style="width:34px">#</th>
                    <th>Uploaded description</th>
                    <th>Identified item</th>
                    <th>Category · UNSPSC</th>
                    <th style="width:110px">Record type</th>
                    <th style="width:150px">Proposed action</th>
                    <th style="width:170px">Action</th>
                </tr></thead>
                <tbody>${items.map(x => {
                    const am = ACTION_META[x.action] || {};
                    const p = (x.a && x.a.parsed) || { summary: x.row.desc };
                    const nameCell = x.match
                        ? `<div style="font-weight:600">${esc(x.match.shortName || x.match.name)}</div><div class="muted" style="font-size:11.5px">SAP ${esc(x.match.sapId || '—')}</div>`
                        : `<div style="font-weight:600">${esc((x.payload && x.payload.shortName) || p.shortName || p.summary || x.row.desc)}</div>`;
                    const cat = x.match
                        ? (x.match.unspscLabel ? esc(x.match.unspscLabel) + ' · ' + esc(x.match.unspsc || '') : '<span class="muted">—</span>')
                        : (p.unspsc ? esc(p.unspscLabel || '') + ' · ' + esc(p.unspsc) : '<span class="muted">—</span>');
                    const rt = x.action === 'create'
                        ? `<span class="status-pill ${x.recordType === 'Golden record' ? 'approved' : 'in-review'}" style="font-size:10.5px">${esc(x.recordType.replace(' record', ''))}</span>`
                        : '<span class="muted">—</span>';
                    let hint = '';
                    if (x.action === 'extend' && x.match) hint = `<div class="muted" style="font-size:11px;margin-top:2px">In plant ${esc(x.match.plants[0])} — ${esc(window.UI.plantName(x.match.plants[0]))}</div>`;
                    if (x.action === 'amend') hint = `<div class="muted" style="font-size:11px;margin-top:2px">Changes: ${esc(Object.keys(x.changes).join(', '))}</div>`;
                    if (x.action === 'create' && x.dup) hint = `<div class="muted" style="font-size:11px;margin-top:2px">Similar: ${esc(x.dup.name)} — flagged for deduplication</div>`;
                    const rowAttrs = x.row.actionTaken && rowRequest(x.row)
                        ? `class="clickable" data-act="open-row-req" data-i="${x.i}"`
                        : (!x.row.actionTaken && x.action === 'view' && x.match ? `class="clickable" data-act="t3-view" data-i="${x.i}"` : '');
                    return `<tr ${rowAttrs}>
                        <td class="muted">${x.i + 1}</td>
                        <td style="max-width:240px"><div class="bulk-desc">${esc(x.row.desc)}</div></td>
                        <td style="max-width:200px">${nameCell}</td>
                        <td>${cat}</td>
                        <td>${rt}</td>
                        <td><span class="status-pill ${am.cls}">${esc(am.label || x.action)}</span>${hint}</td>
                        <td>${actionCell3(x)}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
    }

    /* ---- rev3 submission: one request per action; a single item becomes a
       normal single request, never a bulk wrapper around one line ---- */
    function finalizeCreate(payload, desc) {
        if (!payload.shortName) {
            const sd = window.AI.structuredDesc(payload);
            payload.shortName = sd.shortName || payload.name || desc;
            payload.longDesc = payload.longDesc || sd.longDesc;
        }
        return payload;
    }
    function amendPayloadFor(m, changes) {
        const payload = {};
        ['shortName', 'name', 'longDesc', 'manufacturer', 'mfrPartNo', 'model', 'baseUom',
         'unspsc', 'unspscLabel', 'materialGroup', 'matTypeChoice', 'plants'].forEach(k => {
            if (m[k] !== undefined) payload[k] = Array.isArray(m[k]) ? m[k].slice() : m[k];
        });
        payload.attributes = Object.assign({}, m.attributes || {});
        Object.keys(changes).forEach(k => {
            if (k === 'attributes') payload.attributes = Object.assign({}, changes[k].to);
            else if (k === 'inventory') payload.inventory = Object.assign({}, changes[k].to);
            else payload[k] = changes[k].to;
        });
        return payload;
    }
    function submitRows3(batch, action, xs) {
        xs = xs.filter(x => !x.row.actionTaken);
        if (!xs.length) return;
        let req = null;
        if (xs.length === 1) {
            const x = xs[0];
            if (action === 'create') {
                req = window.Workflow.createRequest({ type: 'create', payload: finalizeCreate(x.payload, x.row.desc) });
            } else if (action === 'extend') {
                const m = x.match;
                req = window.Workflow.createRequest({ type: 'extend', materialId: m.id,
                    payload: { shortName: m.shortName, name: m.name, longDesc: m.longDesc,
                        unspsc: m.unspsc, unspscLabel: m.unspscLabel, materialGroup: m.materialGroup,
                        manufacturer: m.manufacturer, mfrPartNo: m.mfrPartNo, baseUom: m.baseUom,
                        sapIdSource: m.sapId } });
            } else if (action === 'amend') {
                req = window.Workflow.createRequest({ type: 'amend', materialId: x.match.id,
                    payload: amendPayloadFor(x.match, x.changes) });
            }
            if (!req) return;
            window.Views.bulkMarkAction(batch.id, xs[0].i, 'Submitted — ' + window.Workflow.reqNo(req));
            const st1 = window.Workflow.stagesFor(req)[0];
            window.UI.toast({ title: 'Request submitted',
                body: window.Workflow.reqNo(req) + ' — sent to ' + (st1 ? st1.role : 'review') + '.', kind: 'info' });
            window.UI.go('#/request/' + req.id);
            return;
        }
        let lines = [];
        if (action === 'create') {
            lines = xs.map(x => ({ desc: x.row.desc, payload: finalizeCreate(x.payload, x.row.desc), dup: x.dup }));
            req = window.BulkFlow.create({ ptype: 'bulk_create', title: 'Bulk new materials — ' + batch.fileName, lines });
        } else if (action === 'extend') {
            lines = xs.map(x => ({ desc: x.row.desc, materialId: x.match.id,
                payload: { shortName: x.match.shortName, name: x.match.name, unspsc: x.match.unspsc, sapIdSource: x.match.sapId } }));
            req = window.BulkFlow.create({ ptype: 'bulk_extend', title: 'Bulk plant extension — ' + batch.fileName, lines });
        } else if (action === 'amend') {
            lines = xs.map(x => {
                const payload = {};
                Object.keys(x.changes).forEach(k => { payload[k] = x.changes[k].to; });
                return { desc: x.match.shortName || x.match.name, materialId: x.match.id, payload, changes: x.changes };
            });
            req = window.BulkFlow.create({ ptype: 'bulk_amend', title: 'Bulk amendment — ' + batch.fileName, lines });
        }
        if (!req) return;
        window.Store.set(s => {
            const b = (s.bulkBatches || []).find(z => z.id === batch.id);
            if (b) xs.forEach(x => { if (b.rows[x.i]) b.rows[x.i].actionTaken = 'Submitted in bulk — ' + window.Workflow.reqNo(req); });
        });
        window.UI.toast({ title: 'Bulk request submitted',
            body: window.Workflow.reqNo(req) + ' — ' + lines.length + ' item(s), ' + window.Workflow.typeLabel(req.type).toLowerCase() + '.', kind: 'info' });
        window.UI.go('#/request/' + req.id);
    }
    // MDM Specialist: amendments from the upload are applied IMMEDIATELY — one
    // instant, logged mdm_amend request per item, no approval chain
    function applyDirectAmend(batch, xs) {
        xs = xs.filter(x => !x.row.actionTaken && x.match);
        if (!xs.length) return;
        xs.forEach(x => {
            const req = window.Workflow.createRequest({ type: 'mdm_amend', materialId: x.match.id,
                payload: amendPayloadFor(x.match, x.changes) });
            window.Views.bulkMarkAction(batch.id, x.i, 'Applied directly — ' + window.Workflow.reqNo(req));
        });
        window.UI.toast({ title: 'Amendments applied', body: xs.length + ' item(s) updated directly — changes are live and logged on each item.', kind: 'info' });
        window.Views.bulkDetail(batch.id);
    }
    function triageActions(batch) {
        const one = (t) => processRow3(batch.rows[+t.getAttribute('data-i')], +t.getAttribute('data-i'));
        const all = (action) => batch.rows.map((r, i) => processRow3(r, i)).filter(x => x.action === action);
        const isMdm = () => window.Store.session().currentRole === 'MDM Specialist';
        return {
            't3-create': (t) => submitRows3(batch, 'create', [one(t)]),
            't3-extend': (t) => submitRows3(batch, 'extend', [one(t)]),
            't3-amend': (t) => isMdm() ? applyDirectAmend(batch, [one(t)]) : submitRows3(batch, 'amend', [one(t)]),
            't3-view': (t) => { const x = one(t); if (x.match) window.UI.go('#/item/' + x.match.id); },
            't3-cat': (t) => {
                const x = one(t);
                const cs = x.a && x.a.categorySuggestion;
                if (!cs) { window.UI.toast({ title: 'No proposal available', body: 'The AI produced no category proposal for this row.', kind: 'danger' }); return; }
                const req = window.Workflow.createRequest({ type: 'category',
                    payload: Object.assign({ sourceText: x.row.desc, name: cs.categoryName, shortName: cs.categoryName },
                        JSON.parse(JSON.stringify(cs))) });
                window.Views.bulkMarkAction(batch.id, x.i, 'Category requested — ' + window.Workflow.reqNo(req));
                window.UI.toast({ title: 'Category request submitted', body: window.Workflow.reqNo(req) + ' — “' + cs.categoryName + '” sent to the Central team. Re-upload or refresh once approved to create the item.', kind: 'info' });
                window.Views.bulkDetail(batch.id);
            },
            't3-all-create': () => submitRows3(batch, 'create', all('create')),
            't3-all-extend': () => submitRows3(batch, 'extend', all('extend')),
            't3-all-amend': () => isMdm() ? applyDirectAmend(batch, all('amend')) : submitRows3(batch, 'amend', all('amend'))
        };
    }
})();
