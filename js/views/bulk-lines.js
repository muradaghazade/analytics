/* ============================================================
   views/bulk-lines.js — worklist panel for v2 bulk requests

   Renders the per-line worklist of a v2 bulk request (all three processes):
   status summary (§8 reporting groups), Filter → Select → Bulk Action (§5),
   role-specific stage actions, cataloguing exception handling, waiting-for-
   information with Excel enrichment round-trip, SAP error retry/cancel, and
   per-line detail/history. Called by request-detail for req.v2 requests.
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);
    const BF = () => window.BulkFlow;

    // per-request panel UI state (survives re-renders)
    const STATE = {};
    function st8(reqId) {
        if (!STATE[reqId]) STATE[reqId] = { q: '', group: '', stage: '', sel: {},
            cat: '', mfr: '', rt: '', vc: '', inv: '', dup: '', attrs: {}, fltOpen: false };
        const S = STATE[reqId];
        if (!S.attrs) Object.assign(S, { cat: S.cat || '', mfr: S.mfr || '', rt: S.rt || '', vc: S.vc || '', inv: S.inv || '', dup: S.dup || '', attrs: {}, fltOpen: false });
        return S;
    }

    const GROUP_CLS = {
        'Completed': 'approved', 'In Progress': 'in-review', 'Under Review / Approval': 'in-review',
        'Waiting for Information': 'pill-nocat', 'Duplicates': 'pill-exists', 'Rejected': 'declined',
        'Error / Exception': 'declined'
    };

    /* ---------------- issue detection (bulk_create cataloguing) ---------------- */
    function lineIssue(req, line) {
        if (req.rev === 3) {
            // rev3: the only line exception is the deduplication flag from triage,
            // decided by the MDM Specialist during MDM review (or the legacy
            // dedicated dedup stage on requests registered before the flow change)
            if (req.type !== 'bulk_create' || BF().lineFinal(line)) return null;
            const st = BF().currentStage(line);
            if (line.dup && !line.dup.cleared && st && (st.key === 'mdm' || st.key === 'dedup')) {
                return { key: 'dup3', label: 'Possible duplicate' + (line.dup.name ? ' — ' + line.dup.name : '') };
            }
            return null;
        }
        if (req.type !== 'bulk_create') return null;
        const c = line.catalog;
        if (!c) return req.catalogDone ? null : { key: 'pending', label: 'Cataloguing…' };
        if (c.failed) return { key: 'failed', label: 'Not classifiable' };
        if ((c.outcome === 'exists_my_plant' || c.outcome === 'exists_other_plant') && !c.dupCleared) {
            if (c.matchBlocked) return { key: 'blocked', label: 'Existing material — blocked' };
            if (c.outcome === 'exists_other_plant') return { key: 'extend', label: 'Existing — not in plant' };
            return { key: 'dup', label: 'Potential duplicate' };
        }
        if (c.outcome === 'category_missing') {
            const have = window.UI.categorySchema(c.unspsc || (line.payload || {}).unspsc);
            if (!have) return { key: 'nocat', label: 'Category not in system' };
        }
        return null;
    }

    /* ---------------- rendering ---------------- */
    function summaryChips(req, S, lines) {
        lines = lines || req.lines || [];
        const counts = {};
        BF().GROUPS.forEach(g => counts[g] = 0);
        lines.forEach(l => { counts[BF().lineGroup(l)] += 1; });
        return `<div class="bulk-summary" style="margin-bottom:10px">${BF().GROUPS.map(g =>
            counts[g] ? `<span class="bulk-sum ${GROUP_CLS[g] || ''} ${S.group === g ? 'sel' : ''}" data-act="grp" data-g="${esc(g)}" style="cursor:pointer${S.group === g ? ';outline:2px solid var(--primary-green)' : ''}">${counts[g]} ${esc(g)}</span>` : '').join('')}
            <span class="muted" style="font-size:12px;align-self:center">${lines.length} line(s) total</span>
        </div>`;
    }

    function lineDetailsCell(req, line) {
        const p = line.payload || {};
        const bits = [];
        if (req.type === 'bulk_create') {
            const catLabel = (line.catalog && line.catalog.unspscLabel) || p.unspscLabel;
            const catCode = (line.catalog && line.catalog.unspsc) || p.unspsc;
            if (catLabel) bits.push(esc(catLabel) + (catCode ? ' · ' + esc(catCode) : ''));
            if (req.rev === 3 && p.recordType) bits.push(esc(p.recordType));
            if (p.valuationClass) bits.push('Valuation ' + esc(p.valuationClass));
            const inv = p.inventory || {};
            if (inv.mrpControllerMin || inv.mrpControllerMax) bits.push('Min/Max ' + esc(inv.mrpControllerMin || '—') + '/' + esc(inv.mrpControllerMax || '—'));
        } else if (req.type === 'bulk_extend') {
            bits.push('Extend to plant ' + esc(req.requesterPlant || '—'));
        } else if (req.type === 'bulk_amend') {
            const ch = Object.keys(line.changes || {});
            bits.push(ch.length ? 'Changes: ' + esc(ch.join(', ')) : '<span class="muted">no changes proposed yet</span>');
        } else if (req.type === 'bulk_minmax') {
            const inv = (line.payload || {}).inventory || {};
            bits.push('Min ' + esc(inv.mrpControllerMin || '—') + ' · Max ' + esc(inv.mrpControllerMax || '—') +
                (inv.reorderPoint ? ' · Reorder ' + esc(inv.reorderPoint) : '') + (inv.safetyStock ? ' · Safety ' + esc(inv.safetyStock) : ''));
        }
        return bits.join('<br>');
    }

    function stageCell(line) {
        if (line.status === 'Completed') return `<span class="status-pill approved">Completed</span>`;
        if (line.status === 'Duplicate') return `<span class="status-pill pill-exists">Duplicate</span>`;
        if (line.status === 'Rejected') return `<span class="status-pill declined">Rejected</span>`;
        if (line.status === 'Cancelled') return `<span class="status-pill declined">Cancelled</span>`;
        if (line.status === 'Error') return `<span class="status-pill declined">SAP error</span><div class="muted" style="font-size:11px;margin-top:2px">${esc(line.sapError || '')}</div>`;
        if (line.status === 'Waiting for Information') return `<span class="status-pill pill-nocat">Waiting for info</span>` +
            (line.waitingInfo && line.waitingInfo.note ? `<div class="muted" style="font-size:11px;margin-top:2px">“${esc(line.waitingInfo.note)}”</div>` : '');
        const cs = BF().currentStage(line);
        return `<span class="status-pill in-review">${esc(cs ? cs.label : '—')}</span>` +
            (cs && cs.role ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(cs.role)}</div>` : '');
    }

    function outcomeCell(line) {
        const OUT = { golden_record: 'New golden record', sourcing_record: 'New sourcing record', confirmed_duplicate: 'Confirmed duplicate',
            plant_extension: 'Plant extension', reactivation: 'Reactivation', amended: 'Amended', inventory_updated: 'Inventory updated',
            rejected: 'Rejected', cancelled: 'Cancelled' };
        const bits = [];
        if (line.sapId) bits.push('SAP ' + esc(line.sapId));
        if (line.outcome) bits.push(esc(OUT[line.outcome] || line.outcome));
        return bits.join('<br>') || '<span class="muted">—</span>';
    }

    function issueChip(req, line, role) {
        const iss = lineIssue(req, line);
        if (!iss) return '';
        const acts = (role === 'MDM Specialist' && BF().isLineAwaiting(line, 'MDM Specialist')) ? {
            dup: `<button class="btn-mini" data-act="dup-yes" data-l="${line.lineId}">Duplicate</button>
                  <button class="btn-mini" data-act="dup-no" data-l="${line.lineId}">Not duplicate</button>`,
            dup3: `<button class="btn-mini" data-act="dup-yes" data-l="${line.lineId}">Duplicate</button>
                  <button class="btn-mini" data-act="dup-no" data-l="${line.lineId}">Not duplicate</button>`,
            extend: `<button class="btn-mini" data-act="route-ext" data-l="${line.lineId}">↗ Plant extension</button>
                  <button class="btn-mini" data-act="dup-no" data-l="${line.lineId}">Continue as new</button>`,
            blocked: `<button class="btn-mini" data-act="route-react" data-l="${line.lineId}">♻ Reactivation</button>
                  <button class="btn-mini" data-act="dup-no" data-l="${line.lineId}">Continue as new</button>`,
            nocat: `<button class="btn-mini" data-act="line-cat" data-l="${line.lineId}">Request category</button>`,
            failed: `<button class="btn-mini" data-act="line-edit" data-l="${line.lineId}">✎ Fix data</button>`
        }[iss.key] || '' : '';
        return `<div style="margin-top:3px"><span class="status-pill pill-nocat" style="font-size:10.5px">${esc(iss.label)}</span> ${acts}</div>`;
    }

    function rowHtml(req, line, role, S) {
        const searchTxt = esc([line.lineId, line.desc, (line.payload || {}).shortName || '', line.sapId || ''].join(' ').toLowerCase());
        const canSelect = !BF().lineFinal(line);
        const m = line.materialId ? window.Store.materialById(line.materialId) : null;
        // Accounting at the valuation stage: per-line assignment next to the bulk apply
        let vcInline = '';
        if (role === 'Accounting' && BF().isLineAwaiting(line, 'Accounting')) {
            const st = BF().currentStage(line);
            if (st && (st.key === 'valuation' || st.key === 'finance')) {
                const ds = window.Store.get().datasets;
                const cur = (line.payload || {}).valuationClass || '';
                vcInline = `<select class="form-select no-ss bl-vc-line" data-l="${line.lineId}" style="height:30px;font-size:12px;margin-top:5px;max-width:180px">
                        <option value="">Valuation class…</option>
                        ${ds.VALUATION_CLASSES.map(v => `<option value="${esc(v.code)}" ${cur === v.code ? 'selected' : ''}>${esc(v.code + ' — ' + v.desc)}</option>`).join('')}
                    </select>`;
            }
        }
        return `<tr data-search="${searchTxt}" data-g="${esc(BF().lineGroup(line))}" data-stage="${esc((BF().currentStage(line) || {}).label || '')}" data-l="${line.lineId}">
            <td>${canSelect ? `<input type="checkbox" class="bl-sel" data-l="${line.lineId}" ${S.sel[line.lineId] !== false ? 'checked' : ''}>` : ''}</td>
            <td class="muted" style="white-space:nowrap">${esc(line.lineId)}</td>
            <td style="max-width:250px">
                <div style="font-weight:600">${esc((line.payload || {}).shortName || line.desc)}</div>
                ${m ? `<div class="muted" style="font-size:11.5px">SAP ${esc(m.sapId || '—')} · ${esc(m.shortName || '')}</div>` : ''}
                ${(line.payload || {}).shortName && line.desc && (line.payload || {}).shortName !== line.desc ? `<div class="muted" style="font-size:11.5px">${esc(line.desc)}</div>` : ''}
                ${issueChip(req, line, role)}
            </td>
            <td class="muted" style="font-size:12.5px;max-width:220px">${lineDetailsCell(req, line)}${vcInline}</td>
            <td>${stageCell(line)}</td>
            <td style="font-size:12.5px">${outcomeCell(line)}</td>
            <td style="white-space:nowrap">
                ${req.type === 'bulk_amend' && Object.keys(line.changes || {}).length ? `<button class="btn-mini" data-act="line-changes" data-l="${line.lineId}" title="Show changes">⇄ Changes</button>` : ''}
                ${lineEditAllowed(req, line, role) ? `<button class="btn-mini" data-act="line-edit" data-l="${line.lineId}" title="Edit line">✎</button>` : ''}
                ${(role === 'MDM Specialist' && req.type === 'bulk_create' && !BF().lineFinal(line)) ||
                  (role === 'Department Budget Owner' && BF().isLineAwaiting(line, 'Department Budget Owner'))
                    ? `<button class="btn-mini" data-act="line-minmax" data-l="${line.lineId}" title="Edit inventory / Min-Max">⚙</button>` : ''}
                <button class="btn-mini" data-act="line-info" data-l="${line.lineId}" title="Details & history">ⓘ</button>
            </td>
        </tr>`;
    }

    function lineEditAllowed(req, line, role) {
        // declined lines: the requester corrects and resubmits under the same request number
        if (line.status === 'Rejected' && req.rev === 3) return role === req.requesterRole;
        if (BF().lineFinal(line)) return false;
        if (line.status === 'Waiting for Information') return role === req.requesterRole;
        if (role === 'MDM Specialist') return BF().isLineAwaiting(line, 'MDM Specialist');
        return false;
    }

    /* ---- filterable line values: payload merged with the referenced material ---- */
    function lineVals(req, line) {
        const p = line.payload || {};
        const m = line.materialId ? window.Store.materialById(line.materialId) : null;
        let attributes = Object.assign({}, m ? m.attributes : null, p.attributes || null);
        if (line.changes && line.changes.attributes) attributes = Object.assign({}, attributes, line.changes.attributes.to);
        const inv = p.inventory || (line.changes && line.changes.inventory && line.changes.inventory.to) || {};
        return {
            unspsc: p.unspsc || (line.catalog && line.catalog.unspsc) || (m && m.unspsc) || '',
            unspscLabel: p.unspscLabel || (line.catalog && line.catalog.unspscLabel) || (m && m.unspscLabel) || '',
            manufacturer: p.manufacturer || (m && m.manufacturer) || '',
            recordType: p.recordType || (m && m.recordType) || '',
            valuationClass: p.valuationClass || (m && m.valuationClass) || '',
            hasInv: ['mrpControllerMin', 'mrpControllerMax', 'reorderPoint', 'safetyStock'].some(k => String(inv[k] || '').trim() !== ''),
            dupFlag: !!(line.dup && !line.dup.cleared),
            attributes
        };
    }
    // same matching rules as the Material Master attribute filters
    function matchesAttrFilters(fa, attrs) {
        const keys = Object.keys(fa || {});
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
    // schema-driven attribute filter controls for the selected category — a
    // sidebar filter-section, same look as the Material Master attribute filters
    function attrFilterZoneHtml(S) {
        if (!S.cat) return '';
        const schema = window.UI.categorySchema(S.cat);
        if (!schema || !schema.attributes.length) return '';
        const controls = schema.attributes.map(a => {
            const t = a.fieldType || 'Text';
            const cur = S.attrs[a.name] || {};
            const uom = a.uom ? ` <span class="attr-uom">(${esc(a.uom.toLowerCase())})</span>` : '';
            if (t === 'Number' || t === 'Range') {
                return `<div class="af-row"><div class="af-label">${esc(a.name)}${uom}</div>
                    <div class="af-minmax">
                        <input class="form-input af-num" type="number" step="any" placeholder="Min" data-attr-num="${esc(a.name)}" data-bound="min" value="${esc(cur.min !== undefined ? cur.min : '')}">
                        <span class="muted">–</span>
                        <input class="form-input af-num" type="number" step="any" placeholder="Max" data-attr-num="${esc(a.name)}" data-bound="max" value="${esc(cur.max !== undefined ? cur.max : '')}">
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
            <div class="filter-title">${esc(schema.label || S.cat)} attributes</div>
            ${controls}
        </div>`;
    }

    /* ---- role toolbar: actions on the SELECTED + VISIBLE + eligible lines ---- */
    function toolbarHtml(req, role, ds) {
        const isReqOwner = role === req.requesterRole;
        const anyAwait = (req.lines || []).some(l => BF().isLineAwaiting(l, role));
        const anyWaiting = (req.lines || []).some(l => l.status === 'Waiting for Information');
        const anyError = (req.lines || []).some(l => l.status === 'Error');
        const stageKey = (() => {
            const l = (req.lines || []).find(x => BF().isLineAwaiting(x, role));
            return l ? BF().currentStage(l).key : null;
        })();
        let inputs = '', buttons = '';
        if (anyAwait) {
            if (stageKey === 'finance' || stageKey === 'valuation') {
                inputs = `<div style="width:280px"><select class="form-select" id="bl-vc">
                        <option value="">Valuation class…</option>
                        ${ds.VALUATION_CLASSES.map(v => `<option value="${esc(v.code)}">${esc(v.code + ' — ' + v.desc)}</option>`).join('')}
                    </select></div>
                    <button class="btn btn-outline btn-sm" data-act="vc-apply">Apply to selected</button>`;
                buttons = `<button class="btn btn-green" data-act="bl-approve">Approve selected</button>`;
            } else if (stageKey === 'dedup') {
                buttons = `<button class="btn btn-green" data-act="bl-approve">Approve selected — no duplicates</button>
                    <button class="btn btn-danger-outline" data-act="bl-reject">Decline selected</button>`;
            } else if (stageKey === 'steward' || stageKey === 'vconfirm') {
                buttons = `<button class="btn btn-green" data-act="bl-approve">Confirm selected</button>
                    <button class="btn btn-danger-outline" data-act="bl-disagree">Disagree — return to Accounting</button>`;
            } else if (stageKey === 'mdm' && req.rev === 3) {
                buttons = `<button class="btn btn-green" data-act="bl-approve">${req.type === 'bulk_create' ? 'Approve selected — release to SAP' : 'Approve selected'}</button>
                    <button class="btn btn-danger-outline" data-act="bl-reject">Decline selected</button>`;
            } else if (stageKey === 'mdm') {
                buttons = `<button class="btn btn-green" data-act="bl-approve">${req.type === 'bulk_amend' ? 'Approve changes (selected)' : 'Approve cataloguing (selected)'}</button>
                    <button class="btn btn-outline" data-act="bl-return">Request information</button>
                    <button class="btn btn-danger-outline" data-act="bl-reject">Reject selected</button>`;
            } else if (stageKey === 'financial') {
                buttons = `<button class="btn btn-green" data-act="bl-approve">Approve Min/Max (selected)</button>
                    <button class="btn btn-outline" data-act="bl-return">Return selected</button>
                    <button class="btn btn-danger-outline" data-act="bl-reject">Reject selected</button>`;
            } else if (stageKey === 'budget') {
                buttons = `<button class="btn btn-green" data-act="bl-approve">Approve selected</button>
                    <button class="btn btn-danger-outline" data-act="bl-reject">Decline selected</button>`;
            } else if (stageKey === 'technical') {
                buttons = `<button class="btn btn-green" data-act="bl-approve">Approve selected</button>
                    ${req.rev === 3 ? '' : `<button class="btn btn-outline" data-act="bl-return">Return selected</button>`}
                    <button class="btn btn-danger-outline" data-act="bl-reject">${req.rev === 3 ? 'Decline selected' : 'Reject selected'}</button>`;
            } else if (stageKey === 'final') {
                buttons = `<button class="btn btn-green" data-act="bl-approve">Approve selected — release to SAP</button>
                    <button class="btn btn-danger-outline" data-act="bl-reject">Decline selected</button>`;
            } else if (stageKey === 'release') {
                buttons = `<button class="btn btn-green" data-act="bl-approve">Release selected to SAP</button>
                    <button class="btn btn-outline" data-act="bl-return">Return selected</button>`;
            }
        }
        let extra = '';
        const anyRejected = (req.lines || []).some(l => l.status === 'Rejected');
        if (req.rev === 3 && anyRejected && isReqOwner) {
            extra += `<button class="btn btn-outline btn-sm" data-act="bl-resubmit">↻ Resubmit selected declined (same request #)</button>`;
        }
        if (anyError && (role === 'MDM Specialist' || isReqOwner)) {
            extra += `<button class="btn btn-outline btn-sm" data-act="bl-retry">↻ Retry SAP (selected errors)</button>
                <button class="btn btn-danger-outline btn-sm" data-act="bl-cancel">Cancel selected</button>`;
        }
        if (anyWaiting && isReqOwner) {
            extra += `<button class="btn btn-outline btn-sm" data-act="bl-export-wait">⇩ Export waiting lines (Excel)</button>
                <button class="btn btn-outline btn-sm" data-act="bl-import-wait">⇧ Upload enrichment</button>
                <button class="btn btn-danger-outline btn-sm" data-act="bl-cancel">Cancel selected</button>
                <input type="file" id="bl-enrich-file" accept=".xlsx,.xls,.csv" hidden>`;
        }
        if (!inputs && !buttons && !extra) return '';
        return `<div class="bulk-actions-bar" style="margin:10px 0;flex-wrap:wrap">
                <span class="bab-label">Bulk actions</span>${inputs}${buttons}${extra}
                <span class="muted" style="font-size:12px">Selected lines only — filters scope the selection.</span>
            </div>
            <div class="field" style="margin:10px 0"><label>Comment <span class="muted" style="font-weight:400">(mandatory for return / reject / disagree)</span></label>
                <textarea class="form-textarea" id="bl-comment" placeholder="Add a note…"></textarea></div>`;
    }

    /* ---------------- main panel ---------------- */
    window.Views.bulkLinesPanel = function (root, req) {
        const zone = document.getElementById('action-zone');
        const role = window.Store.session().currentRole;
        const ds = window.Store.get().datasets;
        const S = st8(req.id);
        // the Department Budget Owner sees ONLY the lines that carry inventory
        // data (create) or inventory changes (amend) — i.e. lines whose chain
        // includes the budget / legacy financial stage
        let viewLines = req.lines || [];
        let scopeNote = '';
        if (role === 'Department Budget Owner') {
            const rel = viewLines.filter(l => (l.stages || []).some(st => st.key === 'budget' || st.key === 'financial'));
            if (rel.length !== viewLines.length) {
                scopeNote = `<div class="banner info" style="margin-bottom:10px"><div class="banner-body">Showing ${rel.length} of ${viewLines.length} line(s) — only items with inventory (Min/Max) data require Budget-owner approval.</div></div>`;
            }
            viewLines = rel;
        }
        const stages = [...new Set(viewLines.map(l => (BF().currentStage(l) || {}).label).filter(Boolean))];

        const catalogBanner = (req.type === 'bulk_create' && !req.rev && !req.catalogDone)
            ? `<div class="banner info" style="margin-bottom:10px"><span class="banner-icon">✦</span><div class="banner-body">
                <div class="banner-title">AI cataloguing in progress</div>
                Valuation and confirmation can proceed — classification, attributes and duplicate checks attach to each line when ready${req.estCost ? ' · est. $' + Number(req.estCost).toFixed(2) : ''}.</div></div>`
            : (req.catalogFailed ? `<div class="banner warn" style="margin-bottom:10px"><div class="banner-body">The AI cataloguing job failed — lines can be catalogued manually via ✎.</div></div>` : '');

        // filter options derived from the lines themselves
        const vals = {};
        viewLines.forEach(l => { vals[l.lineId] = lineVals(req, l); });
        const catOpts = [];
        Object.keys(vals).forEach(id => {
            const v = vals[id];
            if (v.unspsc && !catOpts.some(c => c.code === v.unspsc)) catOpts.push({ code: v.unspsc, label: v.unspscLabel || v.unspsc });
        });
        catOpts.sort((a, b) => a.label.localeCompare(b.label));
        const mfrOpts = [...new Set(Object.keys(vals).map(id => vals[id].manufacturer).filter(Boolean))].sort();
        const vcOpts = [...new Set(Object.keys(vals).map(id => vals[id].valuationClass).filter(Boolean))].sort();
        const anyDupFlag = Object.keys(vals).some(id => vals[id].dupFlag);
        const filtersActive = () => !!(S.q || S.group || S.stage || S.cat || S.mfr || S.rt || S.vc || S.inv || S.dup || Object.keys(S.attrs).length);

        // active-filter count for the sidebar header / collapsed badge
        const nActive = ['group', 'stage', 'cat', 'mfr', 'rt', 'vc', 'inv', 'dup'].filter(k => S[k]).length + Object.keys(S.attrs).length;
        const fltIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`;
        const sec = (title, body) => `<div class="filter-section">
                <div class="filter-title">${title}</div>${body}</div>`;
        const sidebarHtml = `
            <aside class="bl-sidebar ${S.fltOpen ? '' : 'collapsed'}">
                <div class="bl-flt-head">
                    <span class="filter-title" style="margin:0">Filters${nActive ? ' (' + nActive + ')' : ''}</span>
                    <button class="bl-flt-collapse" data-act="bl-flt-toggle" title="${S.fltOpen ? 'Collapse filters' : 'Expand filters'}">
                        ${fltIcon}${!S.fltOpen && nActive ? `<span class="bl-flt-badge">${nActive}</span>` : ''}
                    </button>
                </div>
                <div class="bl-flt-body">
                    ${sec('Status', `<select class="filter-select" id="bl-grp">
                        <option value="">All statuses</option>
                        ${BF().GROUPS.map(g => `<option value="${esc(g)}" ${S.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
                    </select>`)}
                    ${sec('Stage', `<select class="filter-select" id="bl-stage">
                        <option value="">All stages</option>
                        ${stages.map(sg => `<option value="${esc(sg)}" ${S.stage === sg ? 'selected' : ''}>${esc(sg)}</option>`).join('')}
                    </select>`)}
                    ${catOpts.length ? sec('Category', `<select class="filter-select" id="bl-cat">
                        <option value="">All categories</option>
                        ${catOpts.map(c => `<option value="${esc(c.code)}" ${S.cat === c.code ? 'selected' : ''}>${esc(c.label + ' · ' + c.code)}</option>`).join('')}
                    </select>`) : ''}
                    ${attrFilterZoneHtml(S)}
                    ${mfrOpts.length ? sec('Manufacturer', `<select class="filter-select" id="bl-mfr">
                        <option value="">All manufacturers</option>
                        ${mfrOpts.map(m => `<option value="${esc(m)}" ${S.mfr === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
                    </select>`) : ''}
                    ${req.type === 'bulk_create' ? sec('Record type', `<select class="filter-select" id="bl-rt">
                        <option value="">All record types</option>
                        <option value="Golden record" ${S.rt === 'Golden record' ? 'selected' : ''}>Golden record</option>
                        <option value="Sourcing record" ${S.rt === 'Sourcing record' ? 'selected' : ''}>Sourcing record</option>
                    </select>`) : ''}
                    ${vcOpts.length ? sec('Valuation class', `<select class="filter-select" id="bl-vcf">
                        <option value="">All valuation classes</option>
                        ${vcOpts.map(v => `<option value="${esc(v)}" ${S.vc === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
                    </select>`) : ''}
                    ${sec('Inventory / Min-Max', `<select class="filter-select" id="bl-invf">
                        <option value="">Min/Max — any</option>
                        <option value="with" ${S.inv === 'with' ? 'selected' : ''}>With Min/Max</option>
                        <option value="without" ${S.inv === 'without' ? 'selected' : ''}>Without Min/Max</option>
                    </select>`)}
                    ${anyDupFlag ? sec('Duplicates', `<select class="filter-select" id="bl-dupf">
                        <option value="">Duplicates — all lines</option>
                        <option value="flagged" ${S.dup === 'flagged' ? 'selected' : ''}>Flagged duplicates only</option>
                    </select>`) : ''}
                    <div class="filter-section">
                        <button class="btn btn-outline btn-sm" data-act="bl-clear" ${filtersActive() ? '' : 'disabled'}>Clear filters</button>
                    </div>
                </div>
            </aside>`;
        zone.innerHTML = `
            <div class="result-block">
                <div class="rb-title" style="margin-bottom:8px">${esc(window.Workflow.typeLabel(req.type))} — line worklist</div>
                ${catalogBanner}
                ${summaryChips(req, S, viewLines)}
                ${scopeNote}
                <div class="bl-layout">
                    ${sidebarHtml}
                    <div class="bl-main">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                            <input type="text" class="form-input" id="bl-q" placeholder="Search lines…" style="max-width:260px" value="${esc(S.q)}">
                            <span class="muted" id="bl-note" style="font-size:12.5px"></span>
                        </div>
                        ${toolbarHtml(req, role, ds)}
                        <div class="cat-attr-wrap"><table class="data-table bulk-review-table">
                            <thead><tr>
                                <th style="width:30px"><input type="checkbox" id="bl-all" checked title="Select shown"></th>
                                <th style="width:52px">Line</th><th>Item</th><th>Details</th><th style="width:150px">Stage / status</th>
                                <th style="width:130px">Result</th><th style="width:100px"></th>
                            </tr></thead>
                            <tbody>${viewLines.map(l => rowHtml(req, l, role, S)).join('')}</tbody>
                        </table></div>
                    </div>
                </div>
            </div>`;

        /* ---- filtering (search + status + stage + category/attributes + operational filters) ---- */
        const applyFilters = () => {
            const gv = (id) => { const el = zone.querySelector('#' + id); return el ? el.value : ''; };
            const q = (gv('bl-q') || '').trim().toLowerCase();
            S.q = q; S.group = gv('bl-grp'); S.stage = gv('bl-stage');
            S.cat = gv('bl-cat'); S.mfr = gv('bl-mfr'); S.rt = gv('bl-rt'); S.vc = gv('bl-vcf');
            S.inv = gv('bl-invf'); S.dup = gv('bl-dupf');
            let shown = 0, total = 0;
            zone.querySelectorAll('tr[data-l]').forEach(tr => {
                total += 1;
                const v = vals[tr.getAttribute('data-l')] || {};
                let show = !q || tr.getAttribute('data-search').indexOf(q) !== -1;
                if (show && S.group) show = tr.getAttribute('data-g') === S.group;
                if (show && S.stage) show = tr.getAttribute('data-stage') === S.stage;
                if (show && S.cat) show = v.unspsc === S.cat;
                if (show && S.mfr) show = v.manufacturer === S.mfr;
                if (show && S.rt) show = v.recordType === S.rt;
                if (show && S.vc) show = v.valuationClass === S.vc;
                if (show && S.inv) show = S.inv === 'with' ? v.hasInv : !v.hasInv;
                if (show && S.dup === 'flagged') show = v.dupFlag;
                if (show && S.cat) show = matchesAttrFilters(S.attrs, v.attributes);
                tr.style.display = show ? '' : 'none';
                if (show) shown += 1;
            });
            const note = zone.querySelector('#bl-note');
            if (note) note.textContent = filtersActive() ? shown + ' of ' + total + ' line(s) match' : '';
            const clr = zone.querySelector('[data-act="bl-clear"]');
            if (clr) clr.disabled = !filtersActive();
        };
        const rerenderPanel = () => window.Views.requestDetail(req.id);
        zone.querySelector('#bl-q').addEventListener('input', applyFilters);
        ['bl-grp', 'bl-stage', 'bl-mfr', 'bl-rt', 'bl-vcf', 'bl-invf', 'bl-dupf'].forEach(id => {
            const el = zone.querySelector('#' + id);
            if (el) el.addEventListener('change', applyFilters);
        });
        // category change rebuilds the panel so the attribute filter controls follow the schema
        const catSel = zone.querySelector('#bl-cat');
        if (catSel) catSel.addEventListener('change', () => { S.cat = catSel.value; S.attrs = {}; rerenderPanel(); });
        // attribute filter inputs → live filtering, no rebuild
        zone.querySelectorAll('[data-attr-num]').forEach(el => el.addEventListener('input', () => {
            const name = el.getAttribute('data-attr-num'), bound = el.getAttribute('data-bound');
            const f = S.attrs[name] || (S.attrs[name] = {});
            const n = parseFloat(el.value);
            if (isNaN(n)) { delete f[bound]; if (f.min === undefined && f.max === undefined) delete S.attrs[name]; }
            else f[bound] = n;
            applyFilters();
        }));
        zone.querySelectorAll('[data-attr-sel]').forEach(el => el.addEventListener('change', () => {
            const name = el.getAttribute('data-attr-sel');
            if (el.value) S.attrs[name] = { val: el.value }; else delete S.attrs[name];
            applyFilters();
        }));
        zone.querySelectorAll('[data-attr-text]').forEach(el => el.addEventListener('input', () => {
            const name = el.getAttribute('data-attr-text');
            if (el.value.trim()) S.attrs[name] = { text: el.value.trim() }; else delete S.attrs[name];
            applyFilters();
        }));
        applyFilters();

        const selAll = zone.querySelector('#bl-all');
        if (selAll) selAll.addEventListener('change', () => {
            zone.querySelectorAll('.bl-sel').forEach(c => {
                if (c.closest('tr').style.display !== 'none') {
                    c.checked = selAll.checked;
                    S.sel[c.getAttribute('data-l')] = selAll.checked;
                }
            });
        });
        zone.addEventListener('change', (e) => {
            if (e.target.classList && e.target.classList.contains('bl-sel')) {
                S.sel[e.target.getAttribute('data-l')] = e.target.checked;
            }
            if (e.target.classList && e.target.classList.contains('bl-vc-line')) {
                const id = e.target.getAttribute('data-l');
                BF().updateLinePayload(req.id, id, { valuationClass: e.target.value }, 'Assigned per line by Accounting');
                window.UI.toast({ title: 'Valuation class set', body: id + ' — ' + (e.target.value || '—') + '. Approve the line to move it on.', kind: 'info' });
                window.Views.requestDetail(req.id);
            }
        });

        const selectedIds = (pred) => [...zone.querySelectorAll('.bl-sel:checked')]
            .filter(c => c.closest('tr').style.display !== 'none')
            .map(c => c.getAttribute('data-l'))
            .filter(id => {
                const line = (req.lines || []).find(l => l.lineId === id);
                return line && (!pred || pred(line));
            });
        const comment = () => (zone.querySelector('#bl-comment') || {}).value || '';
        const needComment = () => {
            const el = zone.querySelector('#bl-comment');
            if (el) { el.classList.add('error'); el.focus(); }
            window.UI.toast({ title: 'Comment required', body: 'Please write a full sentence — a few words explaining the reason.', kind: 'danger' });
        };
        const rerender = () => window.Views.requestDetail(req.id);

        window.UI.bindActions(zone, {
            'grp': (t) => { S.group = S.group === t.getAttribute('data-g') ? '' : t.getAttribute('data-g'); zone.querySelector('#bl-grp').value = S.group; applyFilters(); },
            'bl-clear': () => {
                Object.assign(S, { q: '', group: '', stage: '', cat: '', mfr: '', rt: '', vc: '', inv: '', dup: '', attrs: {} });
                rerenderPanel();
            },
            'bl-flt-toggle': () => { S.fltOpen = !S.fltOpen; rerenderPanel(); },
            'vc-apply': () => {
                const vc = (zone.querySelector('#bl-vc') || {}).value;
                if (!vc) { window.UI.toast({ title: 'Select a valuation class', body: 'Pick the class to apply to the selected lines.', kind: 'danger' }); return; }
                const ids = selectedIds(l => BF().isLineAwaiting(l, role));
                ids.forEach(id => BF().updateLinePayload(req.id, id, { valuationClass: vc }));
                window.UI.toast({ title: 'Applied', body: vc + ' set on ' + ids.length + ' line(s). Approve them to move on.', kind: 'info' });
                rerender();
            },
            'bl-approve': () => {
                const ids = selectedIds(l => BF().isLineAwaiting(l, role));
                if (!ids.length) { window.UI.toast({ title: 'Nothing to approve', body: 'No selected line is currently at your stage.', kind: 'danger' }); return; }
                // stage guards
                const lines = (req.lines || []).filter(l => ids.indexOf(l.lineId) !== -1);
                const key = BF().currentStage(lines[0]).key;
                if (key === 'finance' || key === 'valuation') {
                    const missing = lines.filter(l => !(l.payload || {}).valuationClass);
                    if (missing.length) { window.UI.toast({ title: 'Valuation missing', body: missing.length + ' selected line(s) have no valuation class yet.', kind: 'danger' }); return; }
                }
                if (key === 'dedup' || (key === 'mdm' && req.rev === 3 && req.type === 'bulk_create')) {
                    const open = lines.filter(l => l.dup && !l.dup.cleared);
                    if (open.length) { window.UI.toast({ title: 'Unresolved duplicates', body: open.length + ' selected line(s) are flagged as possible duplicates — decide “Duplicate” or “Not duplicate” first, or deselect them.', kind: 'danger' }); return; }
                }
                if (key === 'mdm' && req.type === 'bulk_create') {
                    const open = lines.filter(l => lineIssue(req, l));
                    if (open.length) { window.UI.toast({ title: 'Unresolved exceptions', body: open.length + ' selected line(s) still have cataloguing exceptions (duplicates, routing, category or data issues). Resolve or deselect them.', kind: 'danger' }); return; }
                }
                if (key === 'mdm' && req.type === 'bulk_amend') {
                    const empty = lines.filter(l => !Object.keys(l.changes || {}).length);
                    if (empty.length) { window.UI.toast({ title: 'No changes proposed', body: empty.length + ' selected line(s) have no proposed changes — edit them first (✎) or deselect.', kind: 'danger' }); return; }
                }
                const res = BF().approveLines(req.id, ids, { comment: comment() });
                window.UI.toast({ title: 'Lines processed', body: res.approved + ' line(s) approved' + (res.sapOk ? ', ' + res.sapOk + ' created/updated in SAP' : '') + (res.sapErr ? ', ' + res.sapErr + ' SAP error(s)' : '') + '.', kind: 'info' });
                rerender();
            },
            'bl-return': () => {
                const ids = selectedIds(l => BF().isLineAwaiting(l, role));
                if (!ids.length) { window.UI.toast({ title: 'Nothing selected', body: 'No selected line is at your stage.', kind: 'danger' }); return; }
                if (!window.UI.isSentence(comment())) { needComment(); return; }
                const n = BF().returnLines(req.id, ids, { comment: comment() });
                window.UI.toast({ title: 'Returned', body: n + ' line(s) are now waiting for information.', kind: 'info' });
                rerender();
            },
            'bl-reject': () => {
                const ids = selectedIds(l => BF().isLineAwaiting(l, role));
                if (!ids.length) { window.UI.toast({ title: 'Nothing selected', body: 'No selected line is at your stage.', kind: 'danger' }); return; }
                if (!window.UI.isSentence(comment())) { needComment(); return; }
                const n = BF().rejectLines(req.id, ids, { comment: comment() });
                window.UI.toast({ title: 'Rejected', body: n + ' line(s) rejected.', kind: 'info' });
                rerender();
            },
            'bl-disagree': () => {
                const ids = selectedIds(l => BF().isLineAwaiting(l, role));
                if (!ids.length) { window.UI.toast({ title: 'Nothing selected', body: 'No selected line is at your stage.', kind: 'danger' }); return; }
                if (!window.UI.isSentence(comment())) { needComment(); return; }
                const n = BF().reopenStage(req.id, ids, req.rev === 3 ? 'valuation' : 'finance', { comment: comment() });
                window.UI.toast({ title: 'Returned to Accounting', body: n + ' line(s) returned for a new valuation class.', kind: 'info' });
                rerender();
            },
            'bl-resubmit': () => {
                const ids = selectedIds(l => l.status === 'Rejected');
                if (!ids.length) { window.UI.toast({ title: 'No declined lines selected', body: 'Select the declined lines to resubmit (edit them first via ✎ if data must change).', kind: 'danger' }); return; }
                const n = BF().resubmitLines(req.id, ids, {}, comment());
                window.UI.toast({ title: 'Resubmitted', body: n + ' line(s) restarted under ' + window.Workflow.reqNo(req) + '.', kind: 'info' });
                rerender();
            },
            'bl-retry': () => {
                const ids = selectedIds(l => l.status === 'Error');
                if (!ids.length) { window.UI.toast({ title: 'No error lines selected', body: 'Select the SAP-error lines to retry.', kind: 'danger' }); return; }
                const ok = BF().retrySap(req.id, ids);
                window.UI.toast({ title: 'Resubmitted to SAP', body: ok + ' line(s) processed successfully.', kind: 'info' });
                rerender();
            },
            'bl-cancel': () => {
                const ids = selectedIds(l => l.status === 'Error' || l.status === 'Waiting for Information');
                if (!ids.length) { window.UI.toast({ title: 'Nothing cancellable selected', body: 'Only error or waiting lines can be cancelled.', kind: 'danger' }); return; }
                const n = BF().cancelLines(req.id, ids);
                window.UI.toast({ title: 'Cancelled', body: n + ' line(s) cancelled.', kind: 'info' });
                rerender();
            },
            'bl-export-wait': () => exportWaiting(req),
            'bl-import-wait': () => { const fi = zone.querySelector('#bl-enrich-file'); if (fi) fi.click(); },
            'dup-yes': (t) => { BF().confirmDuplicate(req.id, t.getAttribute('data-l')); window.UI.toast({ title: 'Confirmed duplicate', body: 'The line references the existing SAP material and is finalized.', kind: 'info' }); rerender(); },
            'dup-no': (t) => { BF().notDuplicate(req.id, t.getAttribute('data-l')); rerender(); },
            'route-ext': (t) => {
                const linked = BF().routeLine(req.id, t.getAttribute('data-l'), 'extend');
                window.UI.toast({ title: 'Routed to Plant Extension', body: linked ? window.Workflow.reqNo(linked) + ' raised and linked to this line.' : 'Line routed.', kind: 'info' });
                rerender();
            },
            'route-react': (t) => {
                const linked = BF().routeLine(req.id, t.getAttribute('data-l'), 'react');
                window.UI.toast({ title: 'Routed to Reactivation', body: linked ? window.Workflow.reqNo(linked) + ' raised and linked to this line.' : 'Line routed.', kind: 'info' });
                rerender();
            },
            'line-cat': (t) => {
                const line = (req.lines || []).find(l => l.lineId === t.getAttribute('data-l'));
                const cs = line && line.catalog && line.catalog.categorySuggestion;
                if (!cs) { window.UI.toast({ title: 'No proposal available', body: 'The AI produced no category proposal for this line.', kind: 'danger' }); return; }
                const catReq = window.Workflow.createRequest({ type: 'category',
                    payload: Object.assign({ sourceText: line.desc, name: cs.categoryName, shortName: cs.categoryName }, JSON.parse(JSON.stringify(cs))) });
                window.UI.toast({ title: 'Category request raised', body: window.Workflow.reqNo(catReq) + ' — “' + cs.categoryName + '” sent to the Central team. The line continues once the category is approved.', kind: 'info' });
                rerender();
            },
            'line-changes': (t) => changesModal(req, t.getAttribute('data-l')),
            'line-edit': (t) => lineEditModal(req, t.getAttribute('data-l'), rerender),
            'line-minmax': (t) => minMaxModal(req, t.getAttribute('data-l'), rerender),
            'line-info': (t) => lineInfoModal(req, t.getAttribute('data-l'))
        });

        const enrichInput = zone.querySelector('#bl-enrich-file');
        if (enrichInput) enrichInput.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (f) importEnrichment(req, f, rerender);
        });
        void root;
    };

    /* ---------------- modals ---------------- */
    const CHANGE_FIELD_LABELS = {
        shortName: 'Short name', longDesc: 'Long description', manufacturer: 'Manufacturer',
        mfrPartNo: 'Part number', model: 'Model', baseUom: 'Base UoM',
        unspsc: 'UNSPSC', unspscLabel: 'Category', materialGroup: 'Material group',
        matTypeChoice: 'Material type', mrpControllerMin: 'Min qty', mrpControllerMax: 'Max qty',
        reorderPoint: 'Reorder point', safetyStock: 'Safety stock'
    };
    // amendment diff viewer: changed field → old value → new value
    function changesModal(req, lineId) {
        const line = (req.lines || []).find(l => l.lineId === lineId);
        if (!line || !Object.keys(line.changes || {}).length) return;
        const m = line.materialId ? window.Store.materialById(line.materialId) : null;
        const rows = [];
        Object.keys(line.changes).forEach(f => {
            const ch = line.changes[f] || {};
            if (f === 'attributes' || f === 'inventory') {
                const from = ch.from || {}, to = ch.to || {};
                [...new Set([...Object.keys(from), ...Object.keys(to)])].forEach(k => {
                    if (String(from[k] === undefined ? '' : from[k]) !== String(to[k] === undefined ? '' : to[k])) {
                        rows.push({ label: (f === 'inventory' ? (CHANGE_FIELD_LABELS[k] || k) : k), from: from[k], to: to[k] });
                    }
                });
            } else {
                rows.push({ label: CHANGE_FIELD_LABELS[f] || f, from: ch.from, to: ch.to });
            }
        });
        const val = (v) => (v === undefined || v === null || String(v).trim() === '')
            ? '<span class="muted">(empty)</span>'
            : esc(typeof v === 'object' ? JSON.stringify(v) : String(v));
        window.UI.openModal({
            title: 'Proposed changes — ' + lineId + (m ? ' · ' + (m.shortName || m.name) : ''),
            wide: true,
            bodyHtml: `
                ${m ? `<div class="muted" style="margin-bottom:10px;font-size:12.5px">Existing material: ${esc(m.shortName || m.name)} · SAP ${esc(m.sapId || '—')}</div>` : ''}
                <table class="data-table">
                    <thead><tr><th style="width:32%">Changed field</th><th>Old value</th><th>New value</th></tr></thead>
                    <tbody>${rows.map(r => `<tr>
                        <td style="font-weight:600">${esc(r.label)}</td>
                        <td><span style="text-decoration:line-through;color:var(--danger)">${val(r.from)}</span></td>
                        <td style="font-weight:600;color:var(--primary-green)">${val(r.to)}</td>
                    </tr>`).join('')}</tbody>
                </table>`,
            buttons: [{ label: 'Close', cls: 'btn-outline', onClick: (o) => o.remove() }]
        });
    }
    function lineInfoModal(req, lineId) {
        const line = (req.lines || []).find(l => l.lineId === lineId);
        if (!line) return;
        const p = line.payload || {};
        const stages = (line.stages || []).map(st =>
            `<div class="history-item"><span class="h-dot" style="background:${st.done ? 'var(--primary-green)' : '#c9ccc6'}"></span>
                <div class="h-body"><strong>${esc(st.label)}</strong>${st.role ? ' — ' + esc(st.role) : ''}
                ${st.done ? `<div class="h-meta">Done · ${esc(st.doneBy || '')} · ${window.UI.nowLabel(st.doneTs)}</div>` : '<div class="h-meta">Pending</div>'}</div></div>`).join('');
        const hist = (line.history || []).slice().reverse().map(h =>
            `<div class="history-item"><span class="h-dot" style="background:${h.action === 'declined' || h.action === 'error' || h.action === 'returned' ? 'var(--danger)' : 'var(--primary-green)'}"></span>
                <div class="h-body"><strong>${esc(h.actorRole || '')}</strong> — ${esc(h.text || '')}
                ${h.comment ? `<div style="margin-top:2px">“${esc(h.comment)}”</div>` : ''}
                <div class="h-meta">${esc(h.actorUser || '')} · ${window.UI.nowLabel(h.ts)}</div></div></div>`).join('');
        const kv = (k, v) => v ? `<div class="tech-row"><span class="tk">${esc(k)}</span><span class="tv">${esc(v)}</span></div>` : '';
        const chv = (v) => v === undefined || v === null || v === '' ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
        const changes = req.type === 'bulk_amend' ? Object.keys(line.changes || {}).map(f =>
            `<div class="tech-row"><span class="tk">${esc(f)}</span><span class="tv">${esc(chv((line.changes[f] || {}).from))} → <strong>${esc(chv((line.changes[f] || {}).to))}</strong></span></div>`).join('') : '';
        window.UI.openModal({
            title: line.lineId + ' — ' + (p.shortName || line.desc),
            wide: true,
            bodyHtml: `
                <div class="tech-grid" style="margin-bottom:12px">
                    ${kv('Status', line.status)}${kv('Outcome', line.outcome)}${kv('SAP ID', line.sapId)}
                    ${kv('Category', p.unspscLabel ? p.unspscLabel + ' · ' + (p.unspsc || '') : '')}
                    ${kv('Manufacturer', p.manufacturer)}${kv('Part #', p.mfrPartNo)}${kv('Model', p.model)}
                    ${kv('Valuation class', p.valuationClass)}
                    ${kv('Min/Max', (p.inventory && (p.inventory.mrpControllerMin || p.inventory.mrpControllerMax)) ? (p.inventory.mrpControllerMin || '—') + ' / ' + (p.inventory.mrpControllerMax || '—') : '')}
                    ${kv('Resubmissions', line.resubmissions ? String(line.resubmissions) : '')}
                </div>
                ${changes ? `<div class="rb-title" style="margin:8px 0 4px">Proposed changes</div><div class="tech-grid">${changes}</div>` : ''}
                <div class="rb-title" style="margin:12px 0 4px">Stages</div><div class="history-list">${stages}</div>
                <div class="rb-title" style="margin:12px 0 4px">Line history</div><div class="history-list">${hist || '<div class="muted">No events.</div>'}</div>`,
            buttons: [{ label: 'Close', cls: 'btn-outline', onClick: (o) => o.remove() }]
        });
    }

    const EDIT_FIELDS = [
        { k: 'shortName', label: 'Short name' },
        { k: 'longDesc', label: 'Long description', type: 'textarea' },
        { k: 'manufacturer', label: 'Manufacturer' },
        { k: 'mfrPartNo', label: 'Manufacturer part #' },
        { k: 'model', label: 'Model' },
        { k: 'baseUom', label: 'Base UoM', type: 'select' }
    ];
    function lineEditModal(req, lineId, onSaved) {
        const line = (req.lines || []).find(l => l.lineId === lineId);
        if (!line) return;
        const ds = window.Store.get().datasets;
        const m = line.materialId ? window.Store.materialById(line.materialId) : null;
        const p = line.payload || {};
        const cur = (k) => p[k] !== undefined && p[k] !== '' ? p[k] : (m ? (m[k] || '') : '');
        const F = window.UI.field;
        const isWaiting = line.status === 'Waiting for Information';
        const isRejected = line.status === 'Rejected' && req.rev === 3;
        const rejectNote = isRejected ? (line.history || []).slice().reverse().find(h => h.action === 'declined') : null;
        // rev3: every field is editable — including technical attribute values and inventory data
        const attrUnspsc = req.type === 'bulk_create' ? p.unspsc : (m ? m.unspsc : '');
        const attrVals = req.type === 'bulk_create' ? (p.attributes || {}) : (m ? Object.assign({}, m.attributes, (line.changes && line.changes.attributes ? line.changes.attributes.to : {})) : {});
        const attrsHtml = req.rev === 3 && attrUnspsc && window.UI.attrEditorHtml
            ? `<div class="rb-title" style="margin:12px 0 6px">Technical attributes</div>
               <div class="form-grid" id="ble-attrs">${window.UI.attrEditorHtml(attrUnspsc, attrVals, p.recordType === 'Sourcing record')}</div>`
            : '';
        const inv = p.inventory || (m && window.UI.invFor(m, req.requesterPlant)) || {};
        const invHtml = req.rev === 3
            ? `<div class="rb-title" style="margin:12px 0 6px">Inventory / Min-Max <span class="muted" style="font-weight:400;font-size:11.5px">(any value adds Budget-owner approval)</span></div>
               <div class="form-grid">
                    ${F({ label: 'Min qty', name: 'ble-inv::mrpControllerMin', value: inv.mrpControllerMin || '' })}
                    ${F({ label: 'Max qty', name: 'ble-inv::mrpControllerMax', value: inv.mrpControllerMax || '' })}
                    ${F({ label: 'Reorder point', name: 'ble-inv::reorderPoint', value: inv.reorderPoint || '' })}
                    ${F({ label: 'Safety stock', name: 'ble-inv::safetyStock', value: inv.safetyStock || '' })}
               </div>`
            : '';
        window.UI.openModal({
            title: (isRejected ? 'Correct declined line — ' : (req.type === 'bulk_amend' ? 'Propose changes — ' : 'Edit line — ')) + lineId,
            wide: true,
            bodyHtml: `
                ${isWaiting && line.waitingInfo && line.waitingInfo.note ? `<div class="banner warn" style="margin-bottom:10px"><div class="banner-body"><strong>Requested:</strong> ${esc(line.waitingInfo.note)}</div></div>` : ''}
                ${isRejected ? `<div class="banner warn" style="margin-bottom:10px"><div class="banner-body"><strong>Declined${rejectNote && rejectNote.comment ? ':</strong> “' + esc(rejectNote.comment) + '”' : '.</strong>'} Correct the data and resubmit — the line keeps ${esc(window.Workflow.reqNo(req))}.</div></div>` : ''}
                ${m ? `<div class="muted" style="margin-bottom:10px;font-size:12.5px">Existing material: ${esc(m.shortName || m.name)} · SAP ${esc(m.sapId || '—')}. Only changed fields become part of the amendment.</div>` : ''}
                <div class="form-grid" id="ble-grid">
                    ${EDIT_FIELDS.map(f => F({ label: f.label, name: 'ble::' + f.k, value: cur(f.k),
                        type: f.type === 'select' ? 'select' : (f.type || 'text'),
                        options: f.type === 'select' ? ds.UOM : undefined,
                        span: f.type === 'textarea' ? 3 : undefined })).join('')}
                </div>
                ${attrsHtml}
                ${invHtml}`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: isRejected ? 'Save & resubmit' : (isWaiting ? 'Save & return to review' : 'Save'), cls: 'btn-green', onClick: (o) => {
                    const upd = {};
                    EDIT_FIELDS.forEach(f => {
                        const el = o.querySelector(`[name="ble::${f.k}"]`);
                        if (el && String(el.value) !== String(cur(f.k))) upd[f.k] = el.value;
                    });
                    if (req.rev === 3) {
                        const attrZone = o.querySelector('#ble-attrs');
                        if (attrZone && window.UI.collectAttrEditor) {
                            const attrs = window.UI.collectAttrEditor(attrZone, attrUnspsc);
                            if (JSON.stringify(attrs) !== JSON.stringify(attrVals)) {
                                upd.attributes = attrs;
                                // record type follows the catalogue's mandatory attributes
                                if (req.type === 'bulk_create') {
                                    const schema = window.UI.categorySchema(attrUnspsc);
                                    if (schema) {
                                        const mand = schema.attributes.filter(x => x.mandatory);
                                        upd.recordType = mand.every(x => String(attrs[x.name] || '').trim() !== '') ? 'Golden record' : 'Sourcing record';
                                    }
                                }
                            }
                        }
                        const newInv = {};
                        ['mrpControllerMin', 'mrpControllerMax', 'reorderPoint', 'safetyStock'].forEach(k => {
                            const el = o.querySelector(`[name="ble-inv::${k}"]`);
                            if (el) newInv[k] = String(el.value).trim();
                        });
                        if (Object.keys(newInv).length && JSON.stringify(newInv) !== JSON.stringify({
                            mrpControllerMin: String(inv.mrpControllerMin || ''), mrpControllerMax: String(inv.mrpControllerMax || ''),
                            reorderPoint: String(inv.reorderPoint || ''), safetyStock: String(inv.safetyStock || '') })) {
                            upd.inventory = newInv;
                        }
                    }
                    o.remove();
                    if (isRejected) {
                        BF().resubmitLines(req.id, [lineId], { [lineId]: upd });
                        window.UI.toast({ title: 'Line resubmitted', body: lineId + ' corrected and restarted under ' + window.Workflow.reqNo(req) + '.', kind: 'info' });
                    } else if (isWaiting) {
                        BF().provideInfo(req.id, [lineId], { [lineId]: upd });
                        window.UI.toast({ title: 'Line resubmitted', body: lineId + ' returned to review with the provided information.', kind: 'info' });
                    } else if (Object.keys(upd).length) {
                        BF().updateLinePayload(req.id, lineId, upd);
                        window.UI.toast({ title: 'Line updated', body: lineId + ' — ' + Object.keys(upd).join(', ') + ' saved.', kind: 'info' });
                    }
                    if (onSaved) onSaved();
                } }
            ]
        });
    }

    function minMaxModal(req, lineId, onSaved) {
        const line = (req.lines || []).find(l => l.lineId === lineId);
        if (!line) return;
        const role = window.Store.session().currentRole;
        const isDbo = role === 'Department Budget Owner';
        const inv = (line.payload || {}).inventory || {};
        const F = window.UI.field;
        window.UI.openModal({
            title: (isDbo ? 'Adjust inventory — ' : 'Propose Min/Max — ') + lineId,
            bodyHtml: `<div class="muted" style="margin-bottom:10px;font-size:12.5px">${isDbo
                    ? 'Adjust the inventory commitment before approving — editing is optional. Clearing every value removes the Budget-owner approval from this line.'
                    : 'Any inventory value adds a Budget-owner approval to the line before Technical approval.'}</div>
                <div class="form-grid">
                    ${F({ label: 'Min qty', name: 'mm::min', value: inv.mrpControllerMin || '' })}
                    ${F({ label: 'Max qty', name: 'mm::max', value: inv.mrpControllerMax || '' })}
                    ${F({ label: 'Reorder point', name: 'mm::rp', value: inv.reorderPoint || '' })}
                    ${F({ label: 'Safety stock', name: 'mm::ss', value: inv.safetyStock || '' })}
                </div>`,
            buttons: [
                { label: 'Cancel', cls: 'btn-outline', onClick: (o) => o.remove() },
                { label: 'Save', cls: 'btn-green', onClick: (o) => {
                    const v = (n) => (o.querySelector(`[name="mm::${n}"]`) || {}).value || '';
                    // updateLinePayload keeps amendment change-tracking (old → new) in sync
                    BF().updateLinePayload(req.id, lineId, { inventory: {
                        mrpControllerMin: v('min'), mrpControllerMax: v('max'),
                        reorderPoint: v('rp'), safetyStock: v('ss') } },
                        isDbo ? 'Inventory adjusted by the Department Budget Owner' : '');
                    o.remove();
                    if (onSaved) onSaved();
                } }
            ]
        });
    }

    /* ---------------- Excel enrichment round-trip (§2.3) ---------------- */
    function exportWaiting(req) {
        const waiting = (req.lines || []).filter(l => l.status === 'Waiting for Information');
        if (!waiting.length) { window.UI.toast({ title: 'Nothing to export', body: 'No lines are waiting for information.', kind: 'danger' }); return; }
        const rows = [['Line ID', 'Description', 'Requested information', 'Short name', 'Long description', 'Manufacturer', 'Part number', 'Model']];
        waiting.forEach(l => rows.push([
            l.lineId, l.desc || '', (l.waitingInfo && l.waitingInfo.note) || '',
            (l.payload || {}).shortName || '', (l.payload || {}).longDesc || '',
            (l.payload || {}).manufacturer || '', (l.payload || {}).mfrPartNo || '', (l.payload || {}).model || ''
        ]));
        window.UI.exportXlsx(rows, 'Enrichment', 'dmp_' + window.Workflow.reqNo(req).replace(/\D/g, '') + '_enrichment.xlsx');
    }
    const ENRICH_COLS = [
        { key: 'lineId', match: /line/i, required: true },
        { key: 'shortName', match: /short/i },
        { key: 'longDesc', match: /long/i },
        { key: 'manufacturer', match: /manufacturer|mfr(?!.*part)/i },
        { key: 'mfrPartNo', match: /part/i },
        { key: 'model', match: /model/i },
        { key: 'desc', match: /^description$/i }
    ];
    async function importEnrichment(req, f, onDone) {
        let tbl;
        try {
            const rows = await window.Spreadsheet.parseFile(f);
            tbl = window.Spreadsheet.extractTable(rows, ENRICH_COLS);
        } catch (err) {
            window.UI.toast({ title: 'Could not read the file', body: String(err && err.message || err), kind: 'danger' });
            return;
        }
        if (tbl.error) { window.UI.toast({ title: 'File not usable', body: tbl.error, kind: 'danger' }); return; }
        const updates = {}, ids = [];
        tbl.records.forEach(rec => {
            const line = (req.lines || []).find(l => l.lineId === rec.lineId && l.status === 'Waiting for Information');
            if (!line) return;
            const upd = {};
            ['shortName', 'longDesc', 'manufacturer', 'mfrPartNo', 'model', 'desc'].forEach(k => { if (rec[k]) upd[k] = rec[k]; });
            updates[line.lineId] = upd;
            ids.push(line.lineId);
        });
        if (!ids.length) { window.UI.toast({ title: 'No matching lines', body: 'No Line IDs in the file match lines waiting for information.', kind: 'danger' }); return; }
        const n = BF().provideInfo(req.id, ids, updates, 'Enriched via Excel upload — ' + f.name);
        window.UI.toast({ title: 'Enrichment applied', body: n + ' line(s) resubmitted to review.', kind: 'info' });
        if (onDone) onDone();
    }
})();
