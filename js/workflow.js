/* ============================================================
   workflow.js — request lifecycle & approval chains
   ============================================================ */
(function () {

    /* ---- base stage definitions per request type (human/system steps after submit) ---- */
    const CHAINS = {
        // Accounting selects the valuation class first; the requester then approves it
        // (decline sends it back to Accounting) before the technical chain starts
        // no Steward review step — the Central team only reviews new-category requests
        create: [
            { key: 'finance', role: 'Accounting', label: 'Accounting' },
            { key: 'requester_approval', role: 'Requester', label: 'Requester approval' },
            { key: 'technical', role: 'Technical SME', label: 'Technical review' },
            { key: 'mdm', role: 'MDM Specialist', label: 'MDM review' },
            { key: 'sap', role: 'System', label: 'SAP creation', system: true }
        ],
        // amends keep the item's existing valuation class — no Accounting step
        amend: [
            { key: 'technical', role: 'Technical SME', label: 'Technical review' },
            { key: 'mdm', role: 'MDM Specialist', label: 'MDM review' },
            { key: 'sap', role: 'System', label: 'SAP update', system: true }
        ],
        // plant extensions need MDM Specialist approval before SAP is updated
        extend: [
            { key: 'mdm', role: 'MDM Specialist', label: 'MDM review' },
            { key: 'sap', role: 'System', label: 'SAP extension', system: true }
        ],
        block: [
            { key: 'mdm', role: 'MDM Specialist', label: 'MDM review' },
            { key: 'sap', role: 'System', label: 'SAP block', system: true }
        ],
        reactivate: [
            { key: 'mdm', role: 'MDM Specialist', label: 'MDM review' },
            { key: 'sap', role: 'System', label: 'SAP reactivation', system: true }
        ],
        // Central team blocks — no approval, straight to SAP
        block_proc: [
            { key: 'sap', role: 'System', label: 'SAP procurement block', system: true }
        ],
        block_total: [
            { key: 'sap', role: 'System', label: 'SAP total block', system: true }
        ],
        unblock_central: [
            { key: 'sap', role: 'System', label: 'SAP unblock', system: true }
        ],
        // Accounting proposes the new valuation class (its stage auto-completes at
        // submission); the REQUESTER then approves before SAP applies it. A decline
        // loops back to Accounting to select again — same loop as the create chain.
        valuation: [
            { key: 'finance', role: 'Accounting', label: 'Accounting' },
            { key: 'requester_approval', role: 'Requester', label: 'Requester approval' },
            { key: 'sap', role: 'System', label: 'SAP valuation update', system: true }
        ],
        // Inventory team edits an item's inventory data directly — no approval
        inventory_update: [
            { key: 'sap', role: 'System', label: 'SAP inventory update', system: true }
        ],
        // raised automatically when a plant extension completes: the Inventory
        // team sets up planning data for the NEW plant — an inbox task, not just
        // a notification
        inventory_setup: [
            { key: 'inventory', role: 'Inventory team', label: 'Inventory setup (new plant)' }
        ],
        // MDM Specialist amends items directly — no approval chain, applied and
        // logged immediately (single edit from the item page, or bulk via upload)
        mdm_amend: [
            { key: 'sap', role: 'System', label: 'SAP update', system: true }
        ],
        // new-category request: reviewed by the Central team, added to the catalog on approval
        category: [
            { key: 'central', role: 'Central team', label: 'Steward review' }
        ]
    };

    const INVENTORY_STAGE = { key: 'inventory', role: 'Inventory team', label: 'Inventory setup' };

    const TYPE_LABEL = {
        create: 'New item request', amend: 'Amend request', extend: 'Extension request',
        block: 'Block request (plant)', reactivate: 'Reactivation request',
        block_proc: 'Procurement block', block_total: 'Total block', unblock_central: 'Remove central block',
        valuation: 'Valuation class change',
        inventory_update: 'Inventory data update',
        inventory_setup: 'Inventory setup — new plant',
        mdm_amend: 'MDM direct amendment',
        category: 'New category request'
    };

    // build the concrete stage list for a request. Only CREATE requests get the
    // post-SAP Inventory stage (when the item is MRP-planned, i.e. MRP type ≠ ND);
    // amends never do — the Inventory team edits inventory data directly on items.
    function buildStages(type, payload) {
        const base = (CHAINS[type] || CHAINS.create).map(s => Object.assign({}, s));
        if (type === 'create' && payload && payload.mrpType && payload.mrpType !== 'ND') {
            base.push(Object.assign({}, INVENTORY_STAGE));
        }
        return base;
    }

    function typeLabel(type) {
        if (window.BulkFlow && window.BulkFlow.TYPE_LABEL[type]) return window.BulkFlow.TYPE_LABEL[type];
        return TYPE_LABEL[type] || type;
    }

    // accepts a request object (uses its concrete stages) or a type string (base chain)
    function stagesFor(reqOrType) {
        if (reqOrType && typeof reqOrType === 'object') return reqOrType.stages || CHAINS[reqOrType.type] || CHAINS.create;
        return CHAINS[reqOrType] || CHAINS.create;
    }

    function currentStage(req) {
        // v2 bulk requests: lines carry their own stages — summarize
        if (req && req.v2 && window.BulkFlow) return window.BulkFlow.summaryStage(req);
        const st = stagesFor(req);
        return st[req.currentStageIndex] || null;
    }

    // 'Approved' = SAP done, item live; only the post-SAP inventory task remains open
    function isActive(req) { return req.status === 'In Review' || req.status === 'Approved'; }

    function isAwaiting(req, role) {
        if (req && req.v2 && window.BulkFlow) return req.status !== 'Completed' && window.BulkFlow.isAwaiting(req, role);
        if (!isActive(req)) return false;
        const st = currentStage(req);
        return st && st.role === role && !st.system;
    }

    function pushHistory(req, entry) {
        req.history = req.history || [];
        req.history.push(Object.assign({ ts: Date.now() }, entry));
    }

    // direct notification push (caller must already be inside a Store.set so it persists)
    function notify(n) {
        window.Store.notifications().unshift(Object.assign({ id: window.Store.uid('ntf'), read: false, ts: Date.now() }, n));
    }

    function fakeSAP() {
        const n = 12000000 + Math.floor((performance.now() * 131 + Date.now()) % 899999);
        return String(n);
    }

    /* ---- create a request ---- */
    function createRequest(opts) {
        const s = window.Store.session();
        const req = {
            id: window.Store.uid('req'), type: opts.type,
            title: opts.payload && (opts.payload.shortName || opts.payload.name) || typeLabel(opts.type),
            requesterUser: s.currentUser, requesterRole: s.currentRole,
            requesterPlant: opts.requesterPlant || s.plant,
            materialId: opts.materialId || null,
            payload: opts.payload || {},
            stages: buildStages(opts.type, opts.payload || {}),
            aiFeedback: opts.aiFeedback || [],
            status: opts.draft ? 'Draft' : 'In Review',
            currentStageIndex: 0,
            history: [],
            createdTs: Date.now()
        };
        window.Store.set(s2 => {
            s2.seq = s2.seq || { req: 0 };
            s2.seq.req += 1;
            req.no = s2.seq.req;
            s2.requests.unshift(req);
            if (!opts.draft) {
                pushHistory(req, { actorRole: 'Requester', actorUser: s.currentUser, action: 'submitted',
                    text: `Submitted ${typeLabel(opts.type).toLowerCase()}` });
                autoAdvance(req);   // fully-automated chains (e.g. extend) run to SAP immediately
            }
        });
        return req;
    }

    // run consecutive system stages, then finish if the chain is exhausted.
    // MUST be called inside a Store.set (mutations persist via the enclosing set).
    function autoAdvance(req) {
        let st = currentStage(req);
        while (st && st.system && isActive(req)) { runSystemStage(req); st = currentStage(req); }
        if (!isActive(req)) return;
        if (!currentStage(req)) { finish(req); return; }
        // SAP has run but a post-SAP stage (inventory) remains: the item is already
        // approved & live — don't keep the request "In Review" while inventory is pending
        if (req.sapId) req.status = 'Approved';
        // the role now holding the request gets notified, with the requester's name
        const nst = currentStage(req);
        if (nst && !nst.system) {
            if (nst.key === 'requester_approval') {
                notify({
                    title: 'Valuation class selected — your approval needed',
                    body: `${reqNo(req)} “${req.title}” — Accounting selected valuation class ${req.payload.valuationClass || '—'}. Approve to continue, or decline to send it back to Accounting.`,
                    kind: 'info', requestId: req.id, forRole: 'Requester'
                });
            } else {
                notify({
                    title: 'New request in your queue',
                    body: `${reqNo(req)} “${req.title}” from ${req.requesterUser} — awaiting ${nst.label}.`,
                    kind: 'info', requestId: req.id, forRole: nst.role
                });
            }
        }
    }

    /* ---- act on a request (approve / decline / edit-approve / inventory submit) ---- */
    function act(req, action, data) {
        data = data || {};
        const s = window.Store.session();
        const st = currentStage(req);
        if (!st) return;

        window.Store.set(() => {
            // requester declines the Accounting-selected valuation class → the request
            // stays In Review and loops back to the Accounting stage with the note
            if (action === 'decline' && st.key === 'requester_approval') {
                const fi = req.stages.findIndex(x => x.key === 'finance');
                req.currentStageIndex = fi === -1 ? 0 : fi;
                pushHistory(req, {
                    actorRole: s.currentRole, actorUser: s.currentUser, action: 'declined',
                    text: 'Declined at ' + st.label + ' — returned to Accounting',
                    comment: data.comment
                });
                notify({
                    title: 'Valuation class declined by requester',
                    body: `${reqNo(req)} “${req.title}” — ${s.currentUser} declined the valuation class. Please select again.`,
                    kind: 'danger', requestId: req.id, forRole: 'Accounting'
                });
                return;
            }
            if (action === 'decline' || action === 'correction') {
                req.status = 'Declined';
                pushHistory(req, {
                    actorRole: s.currentRole, actorUser: s.currentUser, action: 'declined',
                    text: action === 'correction' ? 'Sent back for correction' : 'Declined at ' + st.label,
                    comment: data.comment
                });
                notify({
                    title: 'Request needs your attention',
                    body: `${typeLabel(req.type)} “${req.title}” was ${action === 'correction' ? 'returned for correction' : 'declined'} by ${s.currentRole}.`,
                    kind: 'danger', requestId: req.id, forRole: req.requesterRole
                });
                return;
            }

            // approve path
            if (st.key === 'finance') req.payload.valuationClass = data.valuationClass;
            if (st.key === 'inventory') { req.payload.inventory = data.inventory || {}; applyInventory(req, req.payload.inventory); }
            if (data.edits) Object.assign(req.payload, data.edits);
            if (req.type === 'category' && st.key === 'central') {
                if (req.payload.categoryName) { req.title = req.payload.categoryName; req.payload.shortName = req.payload.categoryName; }
                applyCategory(req);
            }

            pushHistory(req, {
                actorRole: s.currentRole, actorUser: s.currentUser, action: 'approved',
                text: st.key === 'inventory' ? 'Inventory data submitted' : (data.edits ? 'Edited & approved at ' : 'Approved at ') + st.label,
                comment: data.comment
            });
            if (st.key === 'inventory') {
                notify({ title: 'Inventory setup complete', body: `Inventory data set for “${req.title}” (SAP ID ${req.sapId}).`, kind: 'success', requestId: req.id, forRole: req.requesterRole });
            }
            req.currentStageIndex += 1;

            if (isActive(req)) autoAdvance(req);
        });
    }

    /* ================= BULK requests =================
       One request carrying N items of the same type (create / extend / category).
       Approvers act on the whole batch at once: approve all, decline all, or
       approve a selection (the rest is declined — one mandatory comment covers
       every declined item). Declined items drop out; the rest continue. ---- */

    const BULK_TITLE = { create: 'Bulk new items', extend: 'Bulk plant extension', category: 'Bulk new categories' };

    function createBulkRequest(opts) {
        // opts: { type, items: [{desc, payload, materialId?}], requesterPlant? }
        const s = window.Store.session();
        const req = {
            id: window.Store.uid('req'), type: opts.type, bulk: true,
            title: (BULK_TITLE[opts.type] || 'Bulk request') + ' — ' + opts.items.length + ' items',
            requesterUser: s.currentUser, requesterRole: s.currentRole,
            requesterPlant: opts.requesterPlant || s.plant,
            materialId: null,
            payload: {},
            items: opts.items.map((it, i) => ({
                key: 'i' + i, desc: it.desc || '', payload: it.payload || {},
                materialId: it.materialId || null, status: 'Active', declineComment: '', sapId: null
            })),
            // the Inventory stage is appended dynamically at SAP time, when any
            // surviving item turns out to be MRP-planned (mrpType ≠ ND)
            stages: buildStages(opts.type, { mrpType: 'ND' }),
            aiFeedback: [],
            status: 'In Review',
            currentStageIndex: 0,
            history: [],
            createdTs: Date.now()
        };
        window.Store.set(s2 => {
            s2.seq = s2.seq || { req: 0 };
            s2.seq.req += 1;
            req.no = s2.seq.req;
            s2.requests.unshift(req);
            pushHistory(req, { actorRole: 'Requester', actorUser: s.currentUser, action: 'submitted',
                text: `Submitted ${req.title.toLowerCase()}` });
            autoAdvance(req);
        });
        return req;
    }

    function bulkActiveItems(req) { return (req.items || []).filter(it => it.status === 'Active'); }

    /* ---- act on a bulk request: approve the given keys, decline the remaining
       active items (comment covers all declined). Caller validates inputs. ---- */
    function actBulk(req, opts) {
        // opts: { approveKeys: [], comment: '', perItem: { key: {field: value} } }
        const s = window.Store.session();
        const st = currentStage(req);
        if (!st) return;
        window.Store.set(() => {
            const approve = new Set(opts.approveKeys || []);
            const perItem = opts.perItem || {};
            const active = bulkActiveItems(req);
            const declined = [];
            active.forEach(it => {
                if (approve.has(it.key)) {
                    if (perItem[it.key]) Object.assign(it.payload, perItem[it.key]);
                } else {
                    it.status = 'Declined';
                    it.declineComment = opts.comment || '';
                    declined.push(it);
                }
            });
            const approvedCount = active.length - declined.length;
            pushHistory(req, {
                actorRole: s.currentRole, actorUser: s.currentUser,
                action: declined.length && !approvedCount ? 'declined' : 'approved',
                text: (approvedCount ? `Approved ${approvedCount}` : 'Approved 0') +
                      (declined.length ? `, declined ${declined.length}` : '') + ' item(s) at ' + st.label,
                comment: opts.comment
            });
            if (declined.length) {
                notify({ title: 'Items declined in your bulk request',
                    body: `${reqNo(req)} “${req.title}” — ${declined.length} item(s) declined at ${st.label} by ${s.currentRole}.`,
                    kind: 'danger', requestId: req.id, forRole: req.requesterRole });
            }
            if (!approvedCount) { req.status = 'Declined'; return; }
            // category batches are applied to the catalog on Central approval
            if (req.type === 'category' && st.key === 'central') {
                bulkActiveItems(req).forEach(it => applyCategory({ id: req.id, payload: it.payload }));
            }
            // inventory stage: write the submitted planning data onto each created record
            if (st.key === 'inventory') {
                bulkActiveItems(req).forEach(it => {
                    if (!it.payload.inventory) return;
                    const m = window.Store.materialById(it.materialId);
                    if (!m) return;
                    const plant = it.payload.inventory.plant || req.requesterPlant || (m.plants || [])[0];
                    const before = Object.assign({}, window.UI.invFor(m, plant) || {});
                    window.UI.setInv(m, plant, it.payload.inventory);
                    if (!m.changelog) m.changelog = [];
                    m.changelog.push({ reqId: req.id + ':' + it.key, ts: Date.now(),
                        user: s.currentUser, role: s.currentRole,
                        action: 'Inventory setup (bulk) — ' + reqNo(req),
                        changes: diffInventory(before, window.UI.invFor(m, plant)) });
                });
                notify({ title: 'Inventory setup complete',
                    body: `${reqNo(req)} “${req.title}” — inventory data set for ${bulkActiveItems(req).filter(it => it.payload.inventory).length} item(s).`,
                    kind: 'success', requestId: req.id, forRole: req.requesterRole });
            }
            req.currentStageIndex += 1;
            if (isActive(req)) autoAdvanceBulk(req);
        });
    }

    function autoAdvanceBulk(req) {
        let st = currentStage(req);
        while (st && st.system && isActive(req)) { runBulkSystemStage(req); st = currentStage(req); }
        if (!isActive(req)) return;
        if (!currentStage(req)) { finish(req); return; }
        // SAP has run but the Inventory stage remains: the items are already live
        if (currentStage(req).key === 'inventory') req.status = 'Approved';
        const nst = currentStage(req);
        if (nst && !nst.system) {
            notify({
                title: nst.key === 'requester_approval' ? 'Bulk request — your approval needed' : 'Bulk request in your queue',
                body: `${reqNo(req)} “${req.title}” from ${req.requesterUser} — ${bulkActiveItems(req).length} item(s) awaiting ${nst.label}.`,
                kind: 'info', requestId: req.id, forRole: nst.role
            });
        }
    }

    /* ---- bulk SAP stage: process every remaining active item ---- */
    function runBulkSystemStage(req) {
        const active = bulkActiveItems(req);
        active.forEach(it => {
            const sapId = it.sapId || fakeSAP();
            it.sapId = sapId;
            if (req.type === 'create') {
                const p = it.payload;
                if (window.AI && window.AI.structuredDesc && /[a-z]/.test(p.shortName || '')) {
                    if (!p.name || p.name === p.shortName) p.name = p.shortName;
                    const sd = window.AI.structuredDesc(p);
                    p.shortName = sd.shortName;
                    p.longDesc = sd.longDesc;
                }
                const id = window.Store.uid('mat');
                const mat = Object.assign({
                    id, dmpId: String(1600 + window.Store.materials().length + 1), sapId,
                    itemStatus: 'Approved', blockStatus: null, requestStatus: 'Approved',
                    plants: (p.plants && p.plants.length) ? p.plants.slice() : [req.requesterPlant],
                    image: p.image || '', changelog: []
                }, materialFromPayload(p));
                if (window.I18N && window.I18N.stampItemAz) window.I18N.stampItemAz(mat);
                window.Store.materials().unshift(mat);
                it.materialId = id;
                logChange(mat, req, []);
            } else if (req.type === 'extend') {
                const m = window.Store.materialById(it.materialId);
                if (m && req.requesterPlant && m.plants.indexOf(req.requesterPlant) === -1) {
                    const before = m.plants.join(', ');
                    m.plants.push(req.requesterPlant);
                    // one changelog entry per item — keyed by request+item so they don't merge
                    if (!m.changelog) m.changelog = [];
                    m.changelog.push({ reqId: req.id + ':' + it.key, ts: Date.now(),
                        user: req.requesterUser, role: req.requesterRole || 'Requester',
                        action: typeLabel(req.type) + ' (bulk) — ' + reqNo(req),
                        changes: [{ field: 'Plants', from: before, to: m.plants.join(', ') }] });
                    m.sapId = m.sapId || sapId;
                }
            }
        });
        pushHistory(req, { actorRole: 'System', actorUser: 'SAP', action: 'completed',
            text: `SAP processed ${active.length} item(s)` });
        notify({ title: 'Bulk request processed by SAP',
            body: `${reqNo(req)} “${req.title}” — ${active.length} item(s) ${req.type === 'create' ? 'created' : 'extended'} in SAP.`,
            kind: 'success', requestId: req.id, forRole: req.requesterRole });
        // MRP-planned items need their inventory set up after mastering —
        // append (or drop) the Inventory stage based on what actually survived
        if (req.type === 'create') {
            const needsInv = bulkActiveItems(req).some(it => (it.payload.mrpType || 'ND') !== 'ND');
            const invIdx = req.stages.findIndex(s => s.key === 'inventory');
            if (needsInv && invIdx === -1) req.stages.push(Object.assign({}, INVENTORY_STAGE));
            if (!needsInv && invIdx !== -1) req.stages.splice(invIdx, 1);
        }
        req.currentStageIndex += 1;
    }

    /* ---- requester resubmits a declined BULK request: the selected items are
       reactivated and the review CONTINUES at the stage that declined them —
       earlier approvals stay valid, the chain does not start over ---- */
    function resubmitBulk(req, keys) {
        window.Store.set(() => {
            (req.items || []).forEach(it => {
                if (it.status === 'Declined' && (!keys || keys.indexOf(it.key) !== -1)) {
                    it.status = 'Active';
                    it.declineComment = '';
                }
            });
            req.status = 'In Review';
            // currentStageIndex still points at the stage that declined — resume there
            const st = currentStage(req);
            pushHistory(req, { actorRole: 'Requester', actorUser: window.Store.session().currentUser,
                action: 'submitted',
                text: 'Resubmitted after correction (' + bulkActiveItems(req).length + ' item(s)) — back to ' + (st ? st.label : 'review') });
            autoAdvanceBulk(req);
        });
    }

    /* ---- requester resubmits a declined request ---- */
    function resubmit(req, payload) {
        window.Store.set(() => {
            if (payload) req.payload = Object.assign({}, req.payload, payload);
            req.stages = buildStages(req.type, req.payload);   // MRP type may have changed
            req.status = 'In Review';
            req.currentStageIndex = 0;
            pushHistory(req, { actorRole: 'Requester', actorUser: window.Store.session().currentUser,
                action: 'submitted', text: 'Resubmitted after correction' });
            autoAdvance(req);
        });
    }

    /* ---- system (SAP) stage: perform SAP work, notify requester, advance one step ---- */
    function runSystemStage(req) {
        const sapId = req.sapId || fakeSAP();
        req.sapId = sapId;

        if (req.type === 'create' || req.type === 'amend' || req.type === 'mdm_amend') {
            applyToMaterial(req, sapId);
        } else if (req.type === 'extend') {
            const m = window.Store.materialById(req.materialId);
            if (m && req.requesterPlant && m.plants.indexOf(req.requesterPlant) === -1) {
                const before = m.plants.join(', ');
                m.plants.push(req.requesterPlant);
                logChange(m, req, [{ field: 'Plants', from: before, to: m.plants.join(', ') }]);
                // the new plant has no inventory planning yet — raise the
                // Inventory-team inbox task (which also notifies the role)
                raiseInventorySetup(m.id, req.requesterPlant, { user: req.requesterUser, role: req.requesterRole });
            }
            if (m) m.sapId = m.sapId || sapId;
        } else if (req.type === 'inventory_update') {
            const m = window.Store.materialById(req.materialId);
            if (m) {
                const plant = (req.payload.inventory || {}).plant || req.requesterPlant || (m.plants || [])[0];
                const before = Object.assign({}, window.UI.invFor(m, plant) || {});
                window.UI.setInv(m, plant, req.payload.inventory || {});
                logChange(m, req, diffInventory(before, window.UI.invFor(m, plant)));
            }
        } else if (req.type === 'valuation') {
            const m = window.Store.materialById(req.materialId);
            if (m) {
                const vcs = window.Store.get().datasets.VALUATION_CLASSES;
                const label = (c) => { const v = vcs.find(x => x.code === c); return v ? c + ' — ' + v.desc : (c || ''); };
                const before = m.valuationClass;
                m.valuationClass = req.payload.valuationClass;
                logChange(m, req, [{ field: 'Valuation class', from: label(before), to: label(m.valuationClass) }]);
            }
        } else if (['block', 'reactivate', 'block_proc', 'block_total', 'unblock_central'].indexOf(req.type) !== -1) {
            const m = window.Store.materialById(req.materialId);
            if (m) {
                const target = { block: 'Plant block', reactivate: null, block_proc: 'Procurement block',
                    block_total: 'Total block', unblock_central: null }[req.type];
                const before = m.blockStatus || 'Not blocked';
                m.blockStatus = target;
                logChange(m, req, [{ field: 'Block status', from: before, to: target || 'Not blocked' }]);
            }
        }

        pushHistory(req, { actorRole: 'System', actorUser: 'SAP', action: 'completed', text: `SAP responded — SAP ID ${sapId}` });
        const verb = { create: 'created', amend: 'updated', extend: 'extended to your plant', block: 'blocked at plant level',
            reactivate: 'reactivated', block_proc: 'blocked for procurement', block_total: 'totally blocked', unblock_central: 'unblocked',
            valuation: 'updated (valuation class)', inventory_update: 'updated (inventory data)',
            mdm_amend: 'updated (MDM direct amendment)' }[req.type] || 'processed';
        notify({ title: 'Record successfully ' + verb, body: `“${req.title}” — SAP ID ${sapId}.`, kind: 'success', requestId: req.id, forRole: req.requesterRole });
        req.currentStageIndex += 1;
    }

    function finish(req) {
        req.status = 'Completed';
        req.currentStageIndex = stagesFor(req).length;
    }

    /* ---- item change log: ONE entry per request cycle.
       All field changes that happen during a request (e.g. amend edits + the
       inventory data set at the end of a create chain) merge into that
       request's single log entry. ---- */
    function logChange(m, req, changes) {
        if (!m.changelog) m.changelog = [];
        const existing = m.changelog.find(x => x.reqId === req.id);
        if (existing) {
            existing.changes = existing.changes.concat(changes || []);
            existing.ts = Date.now();
            return;
        }
        m.changelog.push({
            reqId: req.id, ts: Date.now(),
            user: req.requesterUser, role: req.requesterRole || 'Requester',
            action: typeLabel(req.type) + ' — ' + reqNo(req),
            changes: changes || []
        });
    }

    const MAT_FIELD_LABELS = {
        shortName: 'Short name', longDesc: 'Long description', matTypeChoice: 'Part type',
        manufacturer: 'Manufacturer', mfrPartNo: 'Manufacturer part #', prevMfrPartNo: 'Previous part number',
        model: 'Model', unspsc: 'UNSPSC code',
        unspscLabel: 'Category', materialGroup: 'Material Group', baseUom: 'Base UoM',
        poUnit: 'PO unit', poUnitFactor: 'PO unit conversion',
        storageLocation: 'Storage location', mrpEnabled: 'MRP planning enabled',
        batchManaged: 'Batch-managed', mrpType: 'MRP type', recordType: 'Record type',
        valuationClass: 'Valuation class'
    };

    function snapshotMaterial(m) {
        const snap = {};
        Object.keys(MAT_FIELD_LABELS).forEach(k => { snap[k] = m[k]; });
        snap.attributes = Object.assign({}, m.attributes || {});
        snap.image = m.image || '';
        snap.documents = (m.documents || []).map(d => d.name).join(', ');
        snap.plants = (m.plants || []).join(', ');
        return snap;
    }

    function diffMaterial(before, m) {
        const changes = [];
        const str = (v) => (v === undefined || v === null) ? '' : String(v);
        Object.keys(MAT_FIELD_LABELS).forEach(k => {
            if (str(before[k]) !== str(m[k])) changes.push({ field: MAT_FIELD_LABELS[k], from: str(before[k]), to: str(m[k]) });
        });
        const keys = new Set(Object.keys(before.attributes || {}).concat(Object.keys(m.attributes || {})));
        keys.forEach(k => {
            const a = str((before.attributes || {})[k]), b = str((m.attributes || {})[k]);
            if (a !== b) changes.push({ field: 'Attribute — ' + k, from: a, to: b });
        });
        if (str(before.image) !== str(m.image || '')) changes.push({ field: 'Item photo', from: before.image ? '(previous photo)' : '', to: (m.image ? '(new photo)' : '') });
        const docsNow = (m.documents || []).map(d => d.name).join(', ');
        if (str(before.documents) !== docsNow) changes.push({ field: 'Supporting documents', from: str(before.documents) || '—', to: docsNow || '—' });
        const plantsNow = (m.plants || []).join(', ');
        if (str(before.plants) !== plantsNow) changes.push({ field: 'Plants', from: str(before.plants), to: plantsNow });
        return changes;
    }

    const INV_FIELD_LABELS = {
        material: 'Material (MMR)', plant: 'Plant', mrpGroup: 'MRP Group', abcCode: 'ABC Code',
        mrpType: 'MRP Type', reorderPoint: 'Reorder point', mrpControllerMin: 'Min qty',
        mrpControllerMax: 'Max qty', lotSize: 'Lot-size', fixedLotSize: 'Fixed lot size',
        procurementType: 'Procurement Type', plannedDeliveryDays: 'Planned Delivery Time (Days)', safetyStock: 'Safety Stock'
    };
    function diffInventory(before, after) {
        const changes = [];
        const str = (v) => (v === undefined || v === null) ? '' : String(v);
        Object.keys(INV_FIELD_LABELS).forEach(k => {
            if (str(before[k]) !== str(after[k])) changes.push({ field: INV_FIELD_LABELS[k], from: str(before[k]), to: str(after[k]) });
        });
        return changes;
    }

    function applyToMaterial(req, sapId) {
        const p = req.payload;
        if ((req.type === 'amend' || req.type === 'mdm_amend') && req.materialId) {
            const m = window.Store.materialById(req.materialId);
            if (m) {
                const before = snapshotMaterial(m);
                const keepImg = m.image;
                const oldPartNo = m.mfrPartNo;
                Object.assign(m, materialFromPayload(p));
                // an amend whose payload carries no photo must not wipe the item's photo
                if (!p.image && keepImg) m.image = keepImg;
                // a changed part number keeps the old one on the record for traceability
                if (oldPartNo && String(oldPartNo) !== String(m.mfrPartNo || '')) m.prevMfrPartNo = oldPartNo;
                // amendments carrying inventory data write it to the request's plant
                if (p.inventory && window.UI.setInv) window.UI.setInv(m, req.requesterPlant || (m.plants || [])[0], p.inventory);
                m.sapId = m.sapId || sapId;
                if (window.I18N && window.I18N.stampItemAz) window.I18N.stampItemAz(m);
                logChange(m, req, diffMaterial(before, m));
            }
            return;
        }
        // create → new material record. Every mastered record carries MRO-structured
        // descriptions (same shape as the rest of the master); the readable wording
        // stays on the name field.
        if (window.AI && window.AI.structuredDesc && /[a-z]/.test(p.shortName || '')) {
            if (!p.name || p.name === p.shortName) p.name = p.shortName;
            const sd = window.AI.structuredDesc(p);
            p.shortName = sd.shortName;
            p.longDesc = sd.longDesc;
        }
        const id = window.Store.uid('mat');
        const mat = Object.assign({
            id,
            dmpId: String(1600 + window.Store.materials().length + 1),
            sapId,
            itemStatus: 'Approved', blockStatus: null, requestStatus: 'Approved',
            plants: (p.plants && p.plants.length) ? p.plants.slice() : [req.requesterPlant],
            image: p.image || '',
            changelog: []
        }, materialFromPayload(p));
        if (window.I18N && window.I18N.stampItemAz) window.I18N.stampItemAz(mat);
        window.Store.materials().unshift(mat);
        req.materialId = id;   // so a following Inventory stage can find this record
        logChange(mat, req, []);
    }

    // approved new-category request → upsert the category + attributes into the catalog
    function applyCategory(req) {
        const p = req.payload;
        const ds = window.Store.get().datasets;
        if (!Array.isArray(ds.CATEGORY_ATTRIBUTES)) ds.CATEGORY_ATTRIBUTES = [];
        const attrs = (p.catAttributes || [])
            .filter(a => a && a.name && String(a.name).trim())
            .map(a => ({ name: String(a.name).trim(), uom: a.uom || '', mandatory: a.mandatory === true || a.mandatory === 'Yes',
                         fieldType: a.fieldType || 'Text', options: a.options || '' }));
        const existing = ds.CATEGORY_ATTRIBUTES.find(c => c.unspsc === p.unspsc);
        if (existing) {
            existing.label = p.categoryName || existing.label;
            existing.attributes = attrs;
            if (p.materialGroup) existing.materialGroup = p.materialGroup;
        } else {
            ds.CATEGORY_ATTRIBUTES.push({ unspsc: p.unspsc, label: p.categoryName, materialGroup: p.materialGroup || '', attributes: attrs, addedByRequest: true });
        }
        // an approved category lifts any deletion tombstone for its UNSPSC
        const s0 = window.Store.get();
        if (Array.isArray(s0.deletedCategories)) s0.deletedCategories = s0.deletedCategories.filter(u => String(u) !== String(p.unspsc));
        if (window.I18N && window.I18N.syncDynamic) window.I18N.syncDynamic();
        notify({ title: 'New category added to the catalog',
            body: `Category “${p.categoryName}” (UNSPSC ${p.unspsc}) is now available with ${attrs.length} attribute${attrs.length === 1 ? '' : 's'}.`,
            kind: 'success', requestId: req.id });
    }

    // a completed plant extension raises an Inventory-team inbox task for the
    // NEW plant's planning data (single and bulk extensions both call this)
    function raiseInventorySetup(materialId, plant, origin) {
        const m = window.Store.materialById(materialId);
        if (!m) return null;
        const setup = createRequest({
            type: 'inventory_setup', materialId, requesterPlant: plant,
            payload: { shortName: m.shortName || m.name, name: m.name,
                materialGroup: m.materialGroup, mrpType: m.mrpType, plant }
        });
        window.Store.set(s => {
            const r = s.requests.find(x => x.id === setup.id);
            if (!r) return;
            r.sapId = m.sapId;   // the record is already live in SAP
            if (origin && origin.user) r.requesterUser = origin.user;
            if (origin && origin.role) r.requesterRole = origin.role;
        });
        notify({ title: 'Inventory data needed for new plant', forRole: 'Inventory team', requestId: setup.id,
            body: `${m.shortName || m.name} was extended to plant ${plant} — please add inventory planning data for this plant.` });
        return setup;
    }

    function applyInventory(req, inv) {
        const m = window.Store.materialById(req.materialId) || window.Store.materials().find(x => x.sapId === req.sapId);
        if (m) {
            const plant = (inv || {}).plant || req.requesterPlant || (m.plants || [])[0];
            const before = Object.assign({}, window.UI.invFor(m, plant) || {});
            window.UI.setInv(m, plant, inv);
            logChange(m, req, diffInventory(before, window.UI.invFor(m, plant)));
        }
    }

    function materialFromPayload(p) {
        const out = {
            name: p.name || p.shortName, shortName: p.shortName, longDesc: p.longDesc,
            materialType: p.materialType || 'ROH', matTypeChoice: p.matTypeChoice,
            manufacturer: p.manufacturer, mfrPartNo: p.mfrPartNo, model: p.model || '',
            unspsc: p.unspsc, unspscLabel: p.unspscLabel, category: p.category,
            materialGroup: p.materialGroup,
            baseUom: p.baseUom, poUnit: p.poUnit, poUnitFactor: p.poUnitFactor, storageLocation: p.storageLocation,
            mrpEnabled: p.mrpEnabled, batchManaged: p.batchManaged, mrpType: p.mrpType,
            valuationClass: p.valuationClass, recordType: p.recordType,
            attributes: p.attributes || {},
            image: p.image || '',
            documents: (p.documents || []).map(d => Object.assign({}, d))
        };
        // a payload from an older flow without a documents field keeps the item's existing ones
        if (!p.documents) delete out.documents;
        if (p.plants && p.plants.length) out.plants = p.plants.slice();
        // amends carry no Accounting step — keep the item's existing valuation class
        // when the payload doesn't provide one
        if (!p.valuationClass) delete out.valuationClass;
        return out;
    }

    // human-friendly sequential request number, e.g. "Request # 0007"
    function reqNo(req) {
        return 'Request # ' + String(req && req.no || 0).padStart(4, '0');
    }

    // drafts are the only deletable requests (submitted requests keep their audit trail)
    function deleteDraft(id) {
        let ok = false;
        window.Store.set(s => {
            const r = s.requests.find(x => x.id === id);
            if (r && r.status === 'Draft') { s.requests = s.requests.filter(x => x.id !== id); ok = true; }
        });
        return ok;
    }

    window.Workflow = {
        stagesFor, buildStages, typeLabel, currentStage, isAwaiting,
        createRequest, act, resubmit, fakeSAP, reqNo, deleteDraft, CHAINS, raiseInventorySetup,
        createBulkRequest, actBulk, bulkActiveItems, resubmitBulk,
        materialFromPayload, logChange,   // consumed by the per-line bulk engine (bulk-flow.js)
        autoAdvance   // used by store.js migrations to run pending system stages
    };
})();
