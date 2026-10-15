/* ============================================================
   bulk-flow.js — per-line bulk workflow engine (v2 / rev3)

   One Bulk Request (Registration Number) carries many material Line IDs,
   and EVERY line owns its stages, status, history and outcome — lines
   progress independently, one returned/failed line never blocks others,
   and the request completes only when every line reaches final disposition.

   Rev3 (single unified upload): the triage page decides per uploaded item
   whether it is a creation, a plant extension or an amendment, and one bulk
   request per action is registered. Chains (req.rev === 3):
     bulk_create — Valuation class assignment (Accounting) → Valuation
                   confirmation (Requester) → [Budget owner approval, only
                   when the line carries inventory data] → Technical
                   approval → MDM review (incl. duplicate-flag decisions) →
                   SAP creation
     bulk_extend — MDM check → SAP plant extension
     bulk_amend  — MDM review → [Budget owner approval, only when inventory
                   data changed] → Technical approval → Final MDM check →
                   SAP update
   Declined lines are edited and resubmitted by the requester under the
   SAME request number — the line chain restarts from its first stage.

   Requests recorded by the earlier engines (legacy shared progression, and
   v2 three-process requests whose lines carry the old stage keys) keep
   rendering and progressing on their stored stages.
   ============================================================ */
(function () {
    'use strict';

    const TYPE_LABEL = {
        bulk_create: 'Bulk new material creation',
        bulk_amend: 'Bulk material amendment',
        bulk_extend: 'Bulk plant extension',
        bulk_minmax: 'Bulk inventory setup / Min-Max'   // legacy requests only
    };

    // technical fields: changing any of these on an amendment requires
    // Technical approval; purely descriptive corrections do not
    const TECH_FIELDS = ['unspsc', 'unspscLabel', 'materialGroup', 'manufacturer', 'mfrPartNo',
        'model', 'matTypeChoice', 'baseUom', 'attributes'];

    /* ---------------- stage templates ---------------- */
    function mkStage(key, role, label, system) {
        return { key, role: role || '', label, system: !!system, done: false, doneTs: null, doneBy: '' };
    }
    function stagesFor(ptype) {
        if (ptype === 'bulk_create') return [
            mkStage('valuation', 'Accounting', 'Valuation class assignment'),
            mkStage('vconfirm', 'Requester', 'Valuation confirmation'),
            // 'budget' is inserted before 'technical' only when the line carries inventory data
            mkStage('technical', 'Technical SME', 'Technical approval'),
            mkStage('mdm', 'MDM Specialist', 'MDM review'),
            mkStage('sap', '', 'SAP creation', true)
        ];
        if (ptype === 'bulk_extend') return [
            mkStage('mdm', 'MDM Specialist', 'MDM check'),
            mkStage('sap', '', 'SAP plant extension', true)
        ];
        if (ptype === 'bulk_amend') return [
            mkStage('mdm', 'MDM Specialist', 'MDM review'),
            // 'budget' inserted when inventory data is part of the change
            mkStage('technical', 'Technical SME', 'Technical approval'),
            mkStage('final', 'MDM Specialist', 'Final MDM check'),
            mkStage('sap', '', 'SAP update', true)
        ];
        return [];
    }
    const FINANCIAL_STAGE = () => mkStage('financial', 'Department Budget Owner', 'Financial approval (Min/Max)');   // legacy lines
    const BUDGET_STAGE = () => mkStage('budget', 'Department Budget Owner', 'Budget owner approval');
    const TECHNICAL_STAGE = () => mkStage('technical', 'Technical SME', 'Technical approval');

    /* ---------------- helpers ---------------- */
    function pad3(n) { return ('00' + n).slice(-3); }
    function nowMemoDate(ts) {
        const d = new Date(ts || Date.now());
        const p2 = (x) => ('0' + x).slice(-2);
        return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear();
    }
    function currentStage(line) {
        return (line.stages || []).find(st => !st.done) || null;
    }
    function lineFinal(line) {
        return ['Completed', 'Rejected', 'Duplicate', 'Cancelled'].indexOf(line.status) !== -1;
    }
    // §8 reporting groups
    function lineGroup(line) {
        if (line.status === 'Duplicate') return 'Duplicates';
        if (line.status === 'Rejected' || line.status === 'Cancelled') return 'Rejected';
        if (line.status === 'Error') return 'Error / Exception';
        if (line.status === 'Waiting for Information') return 'Waiting for Information';
        if (line.status === 'Completed') return 'Completed';
        const st = currentStage(line);
        if (st && st.system) return 'In Progress';
        return 'Under Review / Approval';
    }
    const GROUPS = ['Completed', 'In Progress', 'Under Review / Approval', 'Waiting for Information', 'Duplicates', 'Rejected', 'Error / Exception'];

    function isLineAwaiting(line, role) {
        if (lineFinal(line) || line.status === 'Waiting for Information' || line.status === 'Error') return false;
        const st = currentStage(line);
        return !!(st && !st.system && st.role === role);
    }
    function isAwaiting(req, role) {
        if (!req.v2) return false;
        if (role === req.requesterRole && (req.lines || []).some(l => l.status === 'Waiting for Information')) return true;
        return (req.lines || []).some(l => isLineAwaiting(l, role));
    }
    // synthetic summary for consumers that expect a single request stage
    function summaryStage(req) {
        const open = (req.lines || []).filter(l => !lineFinal(l));
        if (!open.length) return { key: 'done', role: '', label: 'All lines final', system: false };
        const counts = {};
        open.forEach(l => {
            const g = lineGroup(l);
            const st = currentStage(l);
            const label = g === 'Under Review / Approval' && st ? st.label : g;
            counts[label] = (counts[label] || 0) + 1;
        });
        const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        const st = open.map(currentStage).find(s => s && s.label === top);
        return { key: 'lines', role: st ? st.role : '', label: top + ' (' + counts[top] + ' line' + (counts[top] === 1 ? '' : 's') + ')', system: false };
    }

    function pushLineHistory(line, entry) {
        const s = window.Store.session();
        line.history = line.history || [];
        line.history.push(Object.assign({ ts: Date.now(), actorRole: s.currentRole, actorUser: s.currentUser }, entry));
    }
    function pushReqHistory(req, entry) {
        const s = window.Store.session();
        req.history = req.history || [];
        req.history.push(Object.assign({ ts: Date.now(), actorRole: s.currentRole, actorUser: s.currentUser }, entry));
    }
    function notify(s, n) {
        s.notifications.unshift(Object.assign({ id: window.Store.uid('ntf'), read: false, ts: Date.now() }, n));
    }
    function reqNo(req) { return 'Request # ' + ('0000' + (req.no || 0)).slice(-4); }

    // request-level status derived from the lines; the request closes only when
    // every line has reached a final disposition (§9)
    function refresh(req) {
        const lines = req.lines || [];
        lines.forEach(l => {
            if (lineFinal(l) || l.status === 'Waiting for Information' || l.status === 'Error') return;
            const st = currentStage(l);
            if (!st) { l.status = 'Completed'; return; }
            l.status = st.system ? 'In Progress' : 'Under Review / Approval';
        });
        if (lines.length && lines.every(lineFinal)) {
            if (req.status !== 'Completed') {
                req.status = 'Completed';
                pushReqHistory(req, { actorRole: 'System', actorUser: 'System', action: 'completed', text: 'All lines reached final disposition — request closed' });
            }
        } else {
            req.status = 'In Review';
        }
    }

    /* ---------------- registration (§ steps 1–3 of each process) ---------------- */
    function create(opts) {
        // opts: { ptype, lines: [{desc, materialId?, payload?, changes?, minmax?, dup?}], title? }
        const sess = window.Store.session();
        let req = null;
        window.Store.set(s => {
            s.seq = s.seq || { req: 0 };
            s.seq.req += 1;
            req = {
                id: window.Store.uid('req'),
                no: s.seq.req,
                type: opts.ptype,
                bulk: true, v2: true, rev: 3,
                title: opts.title || TYPE_LABEL[opts.ptype],
                requesterUser: sess.currentUser,
                requesterRole: sess.currentRole,
                requesterPlant: sess.plant,
                createdTs: Date.now(),
                status: 'In Review',
                stages: [],                    // v2: stages live on the lines
                currentStageIndex: 0,
                jobId: null, estCost: null,
                history: [],
                lines: (opts.lines || []).map((ln, i) => {
                    const stages = stagesFor(opts.ptype);
                    const line = {
                        lineId: 'L' + pad3(i + 1),
                        desc: ln.desc || '',
                        materialId: ln.materialId || null,
                        payload: ln.payload || {},
                        changes: ln.changes || null,      // amend: {field: {from, to}}
                        catalog: ln.catalog || null,      // AI cataloguing data
                        dup: ln.dup || null,              // {matchId, name} — deduplication-stage flag
                        stages, status: 'Under Review / Approval',
                        waitingInfo: null, outcome: null,
                        sapId: null, sapError: null, resubmissions: 0,
                        history: []
                    };
                    const inv = ln.minmax || (line.payload || {}).inventory;
                    if (inv) applyMinMax(line, inv);
                    return line;
                })
            };
            pushReqHistory(req, { action: 'submitted', text: 'Submitted — ' + req.lines.length + ' line(s) registered under ' + reqNo(req) });
            req.lines.forEach(l => pushLineHistory(l, { action: 'submitted', text: 'Line registered' }));
            refresh(req);
            s.requests.unshift(req);
            const first = currentStage(req.lines[0]);
            if (first && first.role) {
                notify(s, { title: 'New bulk request in your queue', forRole: first.role, requestId: req.id,
                    body: TYPE_LABEL[opts.ptype] + ' ' + reqNo(req) + ' — ' + req.lines.length + ' line(s) awaiting ' + first.label + '.' });
            }
        });
        return req;
    }

    /* ---------------- conditional stages ---------------- */
    // Inventory data on a line inserts the Budget-owner approval before Technical
    // (rev3 chains); legacy v2 lines keep their 'financial' Min/Max stage instead.
    function applyMinMax(line, inv) {
        line.payload.inventory = Object.assign({}, line.payload.inventory || {}, inv);
        const iv = line.payload.inventory;
        const legacy = line.stages.some(st => st.key === 'steward' || st.key === 'financial' || st.key === 'release');
        if (legacy) {
            const has = String(iv.mrpControllerMin || '').trim() || String(iv.mrpControllerMax || '').trim();
            const fi = line.stages.findIndex(st => st.key === 'financial');
            if (has && fi === -1) {
                const ti = line.stages.findIndex(st => st.key === 'technical');
                line.stages.splice(ti === -1 ? line.stages.length - 1 : ti, 0, FINANCIAL_STAGE());
            } else if (!has && fi !== -1 && !line.stages[fi].done) {
                line.stages.splice(fi, 1);
            }
            return;
        }
        // rev3: ANY inventory value (Min/Max, reorder point, safety stock) commits budget
        const has = ['mrpControllerMin', 'mrpControllerMax', 'reorderPoint', 'safetyStock']
            .some(k => String(iv[k] || '').trim() !== '');
        const bi = line.stages.findIndex(st => st.key === 'budget');
        if (has && bi === -1) {
            const ti = line.stages.findIndex(st => st.key === 'technical');
            line.stages.splice(ti === -1 ? line.stages.length - 1 : ti, 0, BUDGET_STAGE());
        } else if (!has && bi !== -1 && !line.stages[bi].done) {
            line.stages.splice(bi, 1);
        }
    }
    // amendment: Technical approval only when technical fields changed;
    // change-based re-approval — a corrected technical field re-opens it
    function syncAmendStages(line) {
        const changed = Object.keys(line.changes || {});
        const needsTech = changed.some(f => TECH_FIELDS.indexOf(f) !== -1);
        const ti = line.stages.findIndex(st => st.key === 'technical');
        if (needsTech && ti === -1) {
            const si = line.stages.findIndex(st => st.key === 'sap');
            line.stages.splice(si === -1 ? line.stages.length : si, 0, TECHNICAL_STAGE());
        } else if (!needsTech && ti !== -1 && !line.stages[ti].done) {
            line.stages.splice(ti, 1);
        }
    }

    /* ---------------- SAP (simulated, per line) ---------------- */
    // deterministic pseudo-error on the FIRST attempt of ~1 line in 8 — so the
    // correction/resubmission path (§6) is demonstrable; a retry always succeeds
    function sapFails(req, line) {
        if (line.resubmissions > 0) return false;
        let h = 0;
        const key = req.id + ':' + line.lineId;
        for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
        return h % 8 === 0;
    }
    function sapMemo(s, m, req, summary) {
        // §10.1 — change history preserved on the material itself (SAP MRP4 memo)
        const sess = window.Store.session();
        m.sapMemos = m.sapMemos || [];
        m.sapMemos.push(nowMemoDate() + ' | ' + req.requesterUser + ' | ' + summary + ' | Ref: ' + reqNo(req).replace('Request # ', 'MCR-'));
        void sess;
    }
    function runSapForLine(s, req, line) {
        if (sapFails(req, line)) {
            line.status = 'Error';
            line.sapError = 'RFC_COMMUNICATION_FAILURE — connection to SAP timed out (simulated)';
            pushLineHistory(line, { actorRole: 'System', actorUser: 'SAP', action: 'error', text: 'SAP returned an error: ' + line.sapError });
            return false;
        }
        const W = window.Workflow;
        if (req.type === 'bulk_create') {
            const p = line.payload;
            if (!p.shortName && window.AI && window.AI.structuredDesc) {
                const sd = window.AI.structuredDesc(p);
                p.shortName = sd.shortName || p.name || line.desc;
                p.longDesc = p.longDesc || sd.longDesc;
            }
            const sapId = W.fakeSAP();
            const m = Object.assign({
                id: window.Store.uid('mat'),
                dmpId: String(1600 + s.materials.length + 1),
                sapId,
                itemStatus: 'Approved', blockStatus: null, requestStatus: 'Approved',
                plants: (p.plants && p.plants.length) ? p.plants.slice() : [req.requesterPlant],
                changelog: []
            }, W.materialFromPayload(p));
            if (p.inventory) window.UI.setInv(m, req.requesterPlant || (m.plants || [])[0], p.inventory);
            s.materials.unshift(m);
            line.materialId = m.id;
            line.sapId = sapId;
            line.outcome = p.recordType === 'Sourcing record' ? 'sourcing_record' : 'golden_record';
            W.logChange(m, req, []);
            sapMemo(s, m, req, 'Material created via bulk request (' + line.lineId + ')');
            if (window.I18N && window.I18N.stampItemAz) window.I18N.stampItemAz(m);
        } else if (req.type === 'bulk_extend') {
            const m = s.materials.find(x => x.id === line.materialId);
            if (!m) { line.status = 'Error'; line.sapError = 'Material no longer exists'; return false; }
            const plant = req.requesterPlant;
            m.plants = m.plants || [];
            if (plant && m.plants.indexOf(plant) === -1) {
                m.plants.push(plant);
                // the new plant has no inventory planning yet — raise the
                // Inventory-team inbox task (which also notifies the role)
                W.raiseInventorySetup(m.id, plant, { user: req.requesterUser, role: req.requesterRole });
            }
            line.sapId = m.sapId;
            line.outcome = 'plant_extension';
            W.logChange(m, req, [{ field: 'Plants', from: m.plants.filter(p => p !== plant).join(', ') || '—', to: m.plants.join(', ') }]);
            sapMemo(s, m, req, 'Extended to plant ' + plant + ' (' + line.lineId + ')');
        } else if (req.type === 'bulk_amend') {
            const m = s.materials.find(x => x.id === line.materialId);
            if (!m) { line.status = 'Error'; line.sapError = 'Material no longer exists'; return false; }
            const changes = [];
            Object.keys(line.changes || {}).forEach(f => {
                const ch = line.changes[f];
                if (f === 'attributes') { m.attributes = Object.assign({}, ch.to); }
                else if (f === 'inventory') {
                    const invPlant = req.requesterPlant || (m.plants || [])[0];
                    window.UI.setInv(m, invPlant, Object.assign({}, window.UI.invFor(m, invPlant) || {}, ch.to));
                }
                else {
                    // a changed part number keeps the old one on the record for traceability
                    if (f === 'mfrPartNo' && m.mfrPartNo && String(m.mfrPartNo) !== String(ch.to || '')) m.prevMfrPartNo = m.mfrPartNo;
                    m[f] = ch.to;
                }
                changes.push({ field: f, from: (typeof ch.from === 'object' ? JSON.stringify(ch.from) : (ch.from || '—')),
                               to: (typeof ch.to === 'object' ? JSON.stringify(ch.to) : (ch.to || '—')) });
            });
            line.sapId = m.sapId;
            line.outcome = 'amended';
            W.logChange(m, req, changes);
            sapMemo(s, m, req, 'Amended: ' + Object.keys(line.changes || {}).join(', '));
            delete m.i18n;
            if (window.I18N && window.I18N.stampItemAz) window.I18N.stampItemAz(m);
        } else if (req.type === 'bulk_minmax') {
            const m = s.materials.find(x => x.id === line.materialId);
            if (!m) { line.status = 'Error'; line.sapError = 'Material no longer exists'; return false; }
            const invPlant = req.requesterPlant || (m.plants || [])[0];
            const before = Object.assign({}, window.UI.invFor(m, invPlant) || {});
            const after = window.UI.setInv(m, invPlant, Object.assign({}, before, line.payload.inventory || {}));
            const changes = [];
            ['mrpControllerMin', 'mrpControllerMax', 'reorderPoint', 'safetyStock'].forEach(k => {
                if ((line.payload.inventory || {})[k] !== undefined && String(before[k] || '') !== String(after[k] || '')) {
                    changes.push({ field: 'Inventory — ' + k, from: before[k] || '—', to: after[k] || '—' });
                }
            });
            line.sapId = m.sapId;
            line.outcome = 'inventory_updated';
            W.logChange(m, req, changes);
            sapMemo(s, m, req, 'Min/Max inventory settings updated (' + line.lineId + ')');
        }
        const st = currentStage(line);
        if (st && st.system) { st.done = true; st.doneTs = Date.now(); st.doneBy = 'SAP'; }
        line.status = 'Completed';
        pushLineHistory(line, { actorRole: 'System', actorUser: 'SAP', action: 'completed',
            text: 'SAP responded — ' + (req.type === 'bulk_create' ? 'material created, SAP ID ' + line.sapId : 'update applied to SAP ID ' + line.sapId) });
        return true;
    }

    /* ---------------- line actions ---------------- */
    function withReq(reqId, fn) {
        let out = null;
        window.Store.set(s => {
            const req = s.requests.find(r => r.id === reqId);
            if (!req || !req.v2) return;
            out = fn(s, req) || null;
            refresh(req);
        });
        return out;
    }
    function linesOf(req, lineIds) {
        const set = lineIds && lineIds.length ? lineIds : null;
        return (req.lines || []).filter(l => !set || set.indexOf(l.lineId) !== -1);
    }

    // approve the CURRENT stage of each selected line the acting role owns;
    // perLine may carry stage inputs (e.g. {L001: {valuationClass: '3400'}})
    function approveLines(reqId, lineIds, data) {
        data = data || {};
        return withReq(reqId, (s, req) => {
            const role = window.Store.session().currentRole;
            let n = 0, sapOk = 0, sapErr = 0;
            const nextRoles = {};
            linesOf(req, lineIds).forEach(line => {
                if (!isLineAwaiting(line, role)) return;
                const st = currentStage(line);
                const inputs = (data.perLine || {})[line.lineId];
                if (inputs) Object.assign(line.payload, inputs);
                if (st.key === 'mdm' && req.type === 'bulk_amend' && !req.rev) syncAmendStages(line);
                st.done = true; st.doneTs = Date.now(); st.doneBy = window.Store.session().currentUser;
                pushLineHistory(line, { action: 'approved', text: 'Approved at ' + st.label, comment: data.comment });
                n += 1;
                let nxt = currentStage(line);
                if (nxt && nxt.system) {
                    if (runSapForLine(s, req, line)) sapOk += 1; else sapErr += 1;
                } else if (nxt && nxt.role) {
                    nextRoles[nxt.role] = (nextRoles[nxt.role] || 0) + 1;
                }
            });
            if (n) pushReqHistory(req, { action: 'approved', text: n + ' line(s) approved at ' + role + ' stage', comment: data.comment });
            Object.keys(nextRoles).forEach(r => notify(s, { title: 'Bulk lines in your queue', forRole: r, requestId: req.id,
                body: reqNo(req) + ' — ' + nextRoles[r] + ' line(s) now await your review.' }));
            if (sapOk) notify(s, { title: 'SAP processing complete', forRole: req.requesterRole, requestId: req.id, kind: 'success',
                body: reqNo(req) + ' — ' + sapOk + ' line(s) processed in SAP.' });
            if (sapErr) notify(s, { title: 'SAP errors on bulk lines', forRole: 'MDM Specialist', requestId: req.id, kind: 'danger',
                body: reqNo(req) + ' — ' + sapErr + ' line(s) failed in SAP and can be retried.' });
            return { approved: n, sapOk, sapErr };
        });
    }

    // return selected lines for information/correction (→ Waiting for Information)
    function returnLines(reqId, lineIds, data) {
        data = data || {};
        return withReq(reqId, (s, req) => {
            const role = window.Store.session().currentRole;
            let n = 0;
            linesOf(req, lineIds).forEach(line => {
                if (lineFinal(line) || line.status === 'Waiting for Information') return;
                const st = currentStage(line);
                line.status = 'Waiting for Information';
                line.waitingInfo = { note: data.comment || '', since: Date.now(), fromStage: st ? st.label : '', byRole: role };
                pushLineHistory(line, { action: 'returned', text: 'Returned for information at ' + (st ? st.label : '—'), comment: data.comment });
                n += 1;
            });
            if (n) {
                pushReqHistory(req, { action: 'returned', text: n + ' line(s) returned — waiting for information', comment: data.comment });
                notify(s, { title: 'Information requested on bulk lines', forRole: req.requesterRole, requestId: req.id, kind: 'danger',
                    body: reqNo(req) + ' — ' + n + ' line(s) are waiting for information.' + (data.comment ? ' “' + data.comment + '”' : '') });
            }
            return n;
        });
    }

    function rejectLines(reqId, lineIds, data) {
        data = data || {};
        return withReq(reqId, (s, req) => {
            let n = 0;
            linesOf(req, lineIds).forEach(line => {
                if (lineFinal(line)) return;
                line.status = 'Rejected';
                line.outcome = 'rejected';
                pushLineHistory(line, { action: 'declined', text: 'Rejected', comment: data.comment });
                n += 1;
            });
            if (n) {
                pushReqHistory(req, { action: 'declined', text: n + ' line(s) rejected', comment: data.comment });
                notify(s, { title: 'Bulk lines rejected', forRole: req.requesterRole, requestId: req.id, kind: 'danger',
                    body: reqNo(req) + ' — ' + n + ' line(s) were rejected.' + (data.comment ? ' “' + data.comment + '”' : '') });
            }
            return n;
        });
    }

    // cancel failed / returned lines (§6) — final disposition without processing
    function cancelLines(reqId, lineIds) {
        return withReq(reqId, (s, req) => {
            let n = 0;
            linesOf(req, lineIds).forEach(line => {
                if (line.status !== 'Error' && line.status !== 'Waiting for Information') return;
                line.status = 'Cancelled';
                line.outcome = line.outcome || 'cancelled';
                pushLineHistory(line, { action: 'cancelled', text: 'Line cancelled' });
                n += 1;
            });
            if (n) pushReqHistory(req, { action: 'cancelled', text: n + ' line(s) cancelled' });
            return n;
        });
    }

    // enrichment received → back to review at the SAME stage; change-based
    // re-approval (§7): earlier approvals stay valid unless an affected field changed
    function provideInfo(reqId, lineIds, updatesByLine, note) {
        return withReq(reqId, (s, req) => {
            let n = 0;
            linesOf(req, lineIds).forEach(line => {
                if (line.status !== 'Waiting for Information') return;
                const upd = (updatesByLine || {})[line.lineId] || {};
                const changedKeys = Object.keys(upd).filter(k => upd[k] !== undefined && String(upd[k]) !== String(line.payload[k] || ''));
                changedKeys.forEach(k => {
                    if (req.type === 'bulk_amend' && line.changes) {
                        line.changes[k] = { from: (line.changes[k] || {}).from, to: upd[k] };
                    }
                    line.payload[k] = upd[k];
                });
                if (upd.desc) line.desc = upd.desc;
                // §7: re-open only approvals affected by the corrected fields
                if (changedKeys.some(k => TECH_FIELDS.indexOf(k) !== -1)) {
                    (line.stages || []).forEach(st => { if (st.key === 'technical' && st.done) { st.done = false; st.doneTs = null; } });
                    if (req.type === 'bulk_amend' && !req.rev) syncAmendStages(line);
                }
                line.status = 'Under Review / Approval';
                line.waitingInfo = null;
                line.resubmissions += 1;
                pushLineHistory(line, { action: 'resubmitted', text: 'Information provided — line resubmitted' + (changedKeys.length ? ' (updated: ' + changedKeys.join(', ') + ')' : ''), comment: note });
                n += 1;
            });
            if (n) {
                pushReqHistory(req, { action: 'resubmitted', text: n + ' line(s) resubmitted after enrichment' });
                const roles = {};
                linesOf(req, lineIds).forEach(l => { const st = currentStage(l); if (st && st.role) roles[st.role] = 1; });
                Object.keys(roles).forEach(r => notify(s, { title: 'Enriched bulk lines returned to your queue', forRole: r, requestId: req.id,
                    body: reqNo(req) + ' — ' + n + ' line(s) resubmitted with the requested information.' }));
            }
            return n;
        });
    }

    // reopen an earlier (done) stage on selected lines — e.g. the Plant Data
    // Steward disagreeing with the assigned valuation sends those lines back to
    // Accounting while confirmed lines proceed
    function reopenStage(reqId, lineIds, stageKey, data) {
        data = data || {};
        return withReq(reqId, (s, req) => {
            let n = 0;
            const roles = {};
            linesOf(req, lineIds).forEach(line => {
                if (lineFinal(line)) return;
                const st = (line.stages || []).find(x => x.key === stageKey);
                if (!st || !st.done) return;
                st.done = false; st.doneTs = null; st.doneBy = '';
                line.status = 'Under Review / Approval';
                line.waitingInfo = null;
                pushLineHistory(line, { action: 'returned', text: 'Returned to ' + st.label, comment: data.comment });
                if (st.role) roles[st.role] = (roles[st.role] || 0) + 1;
                n += 1;
            });
            if (n) {
                pushReqHistory(req, { action: 'returned', text: n + ' line(s) returned to an earlier stage', comment: data.comment });
                Object.keys(roles).forEach(r => notify(s, { title: 'Bulk lines returned to your stage', forRole: r, requestId: req.id, kind: 'danger',
                    body: reqNo(req) + ' — ' + roles[r] + ' line(s) returned.' + (data.comment ? ' “' + data.comment + '”' : '') }));
            }
            return n;
        });
    }

    // retry SAP for error lines — the correction/resubmission path of §6
    function retrySap(reqId, lineIds) {
        return withReq(reqId, (s, req) => {
            let ok = 0;
            linesOf(req, lineIds).forEach(line => {
                if (line.status !== 'Error') return;
                line.resubmissions += 1;
                line.sapError = null;
                pushLineHistory(line, { action: 'resubmitted', text: 'Resubmitted to SAP' });
                if (runSapForLine(s, req, line)) ok += 1;
            });
            if (ok) pushReqHistory(req, { action: 'completed', text: ok + ' line(s) reprocessed in SAP after error', actorRole: 'System', actorUser: 'SAP' });
            return ok;
        });
    }

    /* ---- cataloguing decisions (bulk_create, MDM stage) ---- */
    function confirmDuplicate(reqId, lineId, materialId) {
        return withReq(reqId, (s, req) => {
            const line = (req.lines || []).find(l => l.lineId === lineId);
            if (!line) return;
            const m = s.materials.find(x => x.id === (materialId || (line.dup && line.dup.matchId) || (line.catalog && line.catalog.matchId)));
            line.status = 'Duplicate';
            line.outcome = 'confirmed_duplicate';
            line.sapId = m ? m.sapId : null;
            line.materialId = m ? m.id : line.materialId;
            pushLineHistory(line, { action: 'completed', text: 'Confirmed duplicate — existing material referenced' + (m ? ' (SAP ID ' + m.sapId + ')' : '') });
        });
    }
    function notDuplicate(reqId, lineId) {
        return withReq(reqId, (s, req) => {
            const line = (req.lines || []).find(l => l.lineId === lineId);
            if (!line) return;
            if (line.dup) line.dup.cleared = true;
            if (line.catalog) line.catalog.dupCleared = true;
            pushLineHistory(line, { action: 'approved', text: 'Reviewed as NOT a duplicate — continues as new material' });
        });
    }
    // route a line into the established single Plant-Extension / Reactivation process
    function routeLine(reqId, lineId, kind) {
        let linked = null;
        withReq(reqId, (s, req) => {
            const line = (req.lines || []).find(l => l.lineId === lineId);
            if (!line || !line.catalog || !line.catalog.matchId) return;
            const m = s.materials.find(x => x.id === line.catalog.matchId);
            if (!m) return;
            line.status = 'Completed';
            line.outcome = kind === 'extend' ? 'plant_extension' : 'reactivation';
            line.materialId = m.id;
            line.sapId = m.sapId;
            pushLineHistory(line, { action: 'completed', text: (kind === 'extend' ? 'Routed to Plant Extension' : 'Routed to Reactivation') + ' — linked request raised for ' + (m.shortName || m.name) });
            linked = { materialId: m.id, kind };
        });
        if (linked) {
            const req = window.Store.requestById(reqId);
            const payload = { shortName: '', name: '', unspsc: '', sapIdSource: '' };
            const m = window.Store.materialById(linked.materialId);
            Object.assign(payload, { shortName: m.shortName, name: m.name, unspsc: m.unspsc, sapIdSource: m.sapId, sourceBulk: reqNo(req) + ' / ' + lineId });
            return window.Workflow.createRequest({ type: linked.kind === 'extend' ? 'extend' : 'reactivate', materialId: linked.materialId, payload });
        }
        return null;
    }

    function setMinMax(reqId, lineId, inv) {
        return withReq(reqId, (s, req) => {
            const line = (req.lines || []).find(l => l.lineId === lineId);
            if (!line) return;
            applyMinMax(line, inv || {});
            pushLineHistory(line, { action: 'edited', text: (String((inv || {}).mrpControllerMin || '').trim() || String((inv || {}).mrpControllerMax || '').trim())
                ? 'Min/Max proposed — Financial approval added to the line' : 'Min/Max removed — Financial approval not required' });
        });
    }

    function updateLinePayload(reqId, lineId, updates, note) {
        return withReq(reqId, (s, req) => {
            const line = (req.lines || []).find(l => l.lineId === lineId);
            if (!line) return;
            Object.keys(updates || {}).forEach(k => {
                if (req.type === 'bulk_amend') {
                    const m = s.materials.find(x => x.id === line.materialId) || {};
                    line.changes = line.changes || {};
                    const same = (typeof updates[k] === 'object')
                        ? JSON.stringify(updates[k] || {}) === JSON.stringify(m[k] || {})
                        : String(updates[k]) === String(m[k] !== undefined ? m[k] : '');
                    if (!same) {
                        line.changes[k] = { from: m[k] !== undefined ? m[k] : '', to: updates[k] };
                    } else delete line.changes[k];
                }
                if (k === 'inventory') applyMinMax(line, updates[k] || {});
                else line.payload[k] = updates[k];
            });
            if (req.type === 'bulk_amend' && !req.rev) syncAmendStages(line);
            pushLineHistory(line, { action: 'edited', text: 'Line data edited (' + Object.keys(updates || {}).join(', ') + ')', comment: note });
        });
    }

    // requester fixes and resubmits DECLINED lines — the SAME request number is
    // kept and the line's chain restarts from its first stage
    function resubmitLines(reqId, lineIds, updatesByLine, note) {
        return withReq(reqId, (s, req) => {
            let n = 0;
            linesOf(req, lineIds).forEach(line => {
                if (line.status !== 'Rejected' && line.status !== 'Cancelled') return;
                const upd = (updatesByLine || {})[line.lineId] || {};
                Object.keys(upd).forEach(k => {
                    if (req.type === 'bulk_amend' && line.changes && k !== 'inventory') {
                        const m = s.materials.find(x => x.id === line.materialId) || {};
                        if (String(upd[k]) !== String(m[k] !== undefined ? m[k] : '')) {
                            line.changes[k] = { from: m[k] !== undefined ? m[k] : '', to: upd[k] };
                        } else delete line.changes[k];
                    }
                    if (k === 'inventory') applyMinMax(line, upd[k] || {});
                    else line.payload[k] = upd[k];
                });
                (line.stages || []).forEach(st => { st.done = false; st.doneTs = null; st.doneBy = ''; });
                line.status = 'Under Review / Approval';
                line.outcome = null;
                line.waitingInfo = null;
                line.resubmissions += 1;
                pushLineHistory(line, { action: 'resubmitted', text: 'Declined line corrected and resubmitted — chain restarted under ' + reqNo(req), comment: note });
                n += 1;
            });
            if (n) {
                pushReqHistory(req, { action: 'resubmitted', text: n + ' declined line(s) resubmitted under the same request number' });
                const first = (req.lines || []).map(currentStage).find(st => st && st.role);
                if (first) notify(s, { title: 'Resubmitted bulk lines in your queue', forRole: first.role, requestId: req.id,
                    body: reqNo(req) + ' — ' + n + ' corrected line(s) restarted at ' + first.label + '.' });
            }
            return n;
        });
    }

    /* ---- AI cataloguing attachment (bulk_create): job registered at upload,
       results attach to lines whenever they arrive — valuation can proceed
       meanwhile, per the spec's stage order ---- */
    const pollers = {};
    function armCatalogPoller(reqId) {
        if (pollers[reqId]) return;
        const tick = async () => {
            delete pollers[reqId];
            const req = window.Store.requestById(reqId);
            if (!req || !req.v2 || req.catalogDone) return;
            if (!req.jobId) { pollers[reqId] = setTimeout(tick, 4000); return; }
            let d;
            try { d = await window.AI.remoteJob(req.jobId); }
            catch (e) { pollers[reqId] = setTimeout(tick, 6000); return; }
            if (d.status === 'completed') {
                const byId = {};
                (d.results || []).forEach(r => { if (r && r.id !== undefined) byId[String(r.id)] = r; });
                window.Store.set(s => {
                    const rq = s.requests.find(x => x.id === reqId);
                    if (!rq) return;
                    rq.catalogDone = true;
                    (rq.lines || []).forEach((line, i) => {
                        const row = byId['r' + i];
                        if (!row || row.Success === false) {
                            line.catalog = { failed: (row && row.error_message) || 'The AI engine returned no result' };
                            return;
                        }
                        const mapped = window.AI.mapRemoteRow(line.desc, row);
                        const analysis = window.AI.assembleRemote(line.desc, JSON.parse(JSON.stringify(mapped.parsed)), mapped.meta);
                        const payload = window.AI.toPayload(analysis);
                        payload.recordType = line.payload.recordType || payload.recordType;
                        payload.valuationClass = line.payload.valuationClass || '';
                        if (line.payload.inventory) payload.inventory = line.payload.inventory;
                        line.payload = payload;
                        line.catalog = {
                            outcome: analysis.outcome,
                            matchId: analysis.exactMatch ? analysis.exactMatch.id : null,
                            matchBlocked: !!(analysis.exactMatch && analysis.exactMatch.blockStatus),
                            categorySuggestion: analysis.categorySuggestion ? JSON.parse(JSON.stringify(analysis.categorySuggestion)) : null,
                            unspsc: payload.unspsc, unspscLabel: payload.unspscLabel
                        };
                        if (!payload.shortName && window.AI.structuredDesc) {
                            const sd = window.AI.structuredDesc(payload);
                            payload.shortName = sd.shortName || line.desc;
                            payload.longDesc = payload.longDesc || sd.longDesc;
                        }
                    });
                    pushReqHistory(rq, { actorRole: 'System', actorUser: 'AI engine', action: 'completed',
                        text: 'Bulk cataloguing data ready for ' + (rq.lines || []).length + ' line(s)' });
                    notify(s, { title: 'Cataloguing data ready', forRole: 'MDM Specialist', requestId: rq.id,
                        body: reqNo(rq) + ' — AI cataloguing results are attached to all lines.' });
                });
                if (window.location.hash === '#/request/' + reqId && window.Views && window.Views.requestDetail) window.Views.requestDetail(reqId);
                return;
            }
            if (d.status === 'failed' || d.status === 'cancelled') {
                window.Store.set(s => { const rq = s.requests.find(x => x.id === reqId); if (rq) { rq.catalogDone = true; rq.catalogFailed = true; } });
                return;
            }
            pollers[reqId] = setTimeout(tick, 4000);
        };
        pollers[reqId] = setTimeout(tick, 100);
    }
    if (typeof document !== 'undefined' && !document.__bulkV2Vis) {
        document.__bulkV2Vis = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            (window.Store.requests() || []).forEach(r => { if (r.v2 && r.jobId && !r.catalogDone) armCatalogPoller(r.id); });
        });
    }

    window.BulkFlow = {
        TYPE_LABEL, GROUPS, TECH_FIELDS,
        create, refresh, reqNo,
        currentStage, lineFinal, lineGroup, isLineAwaiting, isAwaiting, summaryStage,
        approveLines, returnLines, rejectLines, cancelLines, provideInfo, retrySap, reopenStage,
        confirmDuplicate, notDuplicate, routeLine, setMinMax, updateLinePayload, resubmitLines,
        armCatalogPoller
    };
})();
