/* ============================================================
   views/sap-log.js — SAP integration dashboard (Central team)
   Every SAP recording call (dmp → SAP) and every inbound change
   merged back (SAP → dmp): item, status, failure reason — plus
   the failure rate and the most common failure causes.
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);

    const OP_LABEL = {
        create: 'Material create (BAPI_MATERIAL_SAVEDATA)',
        amend: 'Material update (BAPI_MATERIAL_SAVEDATA)',
        extend: 'Plant extension (MARC insert)',
        block: 'Plant block (MM06)', reactivate: 'Reactivation (MM06)',
        block_proc: 'Procurement block (MM02)', block_total: 'Total block (MM06)',
        unblock_central: 'Unblock (MM02)', valuation: 'Valuation update (MR21)',
        inventory_update: 'MRP data update (MM02)', category: 'Category sync'
    };
    const S = { tab: 'all', q: '' };

    /* ---- demo integration events: failures, retries and inbound merges.
       Generated once against real master items, then persisted.
       Data consistency (UoM, descriptions, valuation…) is validated in dmp
       BEFORE the call — so realistic SAP failures are connection and
       SAP-side runtime issues, never bad data. ---- */
    function ensureDemoLog() {
        const st = window.Store.get();
        if (Array.isArray(st.sapLog) && st.__sapLogV2) return;
        const mats = window.Store.materials();
        if (!mats.length) { window.Store.set(s => { s.sapLog = []; s.__sapLogV2 = true; }); return; }
        const pick = (i) => mats[i % mats.length];
        const D = 86400e3, now = Date.now();
        const mk = (daysAgo, dir, m, op, status, message, reason) => ({
            id: 'sap_' + daysAgo + '_' + (m ? m.id : 'x') + '_' + status,
            ts: now - daysAgo * D - 3600e3 * ((daysAgo * 5) % 8) - 60e3 * ((daysAgo * 13) % 50),
            dir, materialId: m ? m.id : null, itemName: m ? (m.shortName || m.name) : '—',
            op, status, message, reason: reason || ''
        });
        const log = [
            mk(9, 'out', pick(3), 'Material create (BAPI_MATERIAL_SAVEDATA)', 'failed',
                'RFC_COMMUNICATION_FAILURE — connection to ECC lost during commit', 'RFC connection timeout'),
            mk(9, 'out', pick(3), 'Material create — retry', 'success', 'Created on retry after RFC reconnect'),
            mk(7, 'out', pick(6), 'Plant extension (MARC insert)', 'failed',
                'Message server not reachable — SAP system in planned maintenance window', 'SAP system unavailable'),
            mk(6, 'out', pick(6), 'Plant extension — retry', 'success', 'Extended after the maintenance window closed'),
            mk(6, 'out', pick(8), 'Material update (BAPI_MATERIAL_SAVEDATA)', 'failed',
                'RFC_COMMUNICATION_FAILURE — read timeout after 60 s waiting for ECC response', 'RFC connection timeout'),
            mk(5, 'out', pick(8), 'Material update — retry', 'success', 'Committed after RFC reconnect'),
            mk(4, 'out', pick(11), 'MRP data update (MM02)', 'failed',
                'E M3 022 — Material locked by user BATCH_PROC (update session still open)', 'Object locked in SAP'),
            mk(3, 'out', pick(11), 'MRP data update — retry', 'success', 'Updated after the SAP lock was released'),
            mk(2, 'out', pick(14), 'Material create (BAPI_MATERIAL_SAVEDATA)', 'failed',
                'RFC_LOGON_FAILURE — logon ticket for RFC user RFC_DMP expired', 'RFC logon expired'),
            mk(2, 'out', pick(14), 'Material create — retry', 'success', 'Created after the RFC logon ticket was renewed'),
            mk(1, 'out', pick(5), 'Valuation update (MR21)', 'failed',
                'Gateway GW_MAX_CONN exceeded — no free RFC connection available', 'Gateway connection limit'),
            // inbound: something changed IN SAP and was merged back to dmp
            mk(8, 'in', pick(1), 'Inbound: price update (MR21)', 'success', 'Standard price change in SAP — merged to dmp'),
            mk(5, 'in', pick(4), 'Inbound: storage location change (MM02)', 'success', 'Storage location E002 → E001 in SAP — merged to dmp'),
            mk(3, 'in', pick(9), 'Inbound: material blocked in SAP (MM06)', 'success', 'Plant block set in SAP — block flag merged to dmp'),
            mk(1, 'in', pick(2), 'Inbound: PO unit change (MM02)', 'success', 'PO unit conversion changed in SAP — merged to dmp')
        ];
        window.Store.set(s => { s.sapLog = log; s.__sapLogV2 = true; });
    }

    /* ---- real outbound successes: every System/SAP stage that ran ---- */
    function successEvents() {
        const out = [];
        window.Store.requests().forEach(r => (r.history || []).forEach(h => {
            if (h.actorRole !== 'System' || h.action !== 'completed') return;
            out.push({
                id: r.id + ':' + h.ts, ts: h.ts, dir: 'out',
                materialId: r.materialId || null, reqId: r.id,
                itemName: r.title || '—',
                op: OP_LABEL[r.type] || 'SAP call', status: 'success',
                message: (h.text || 'Processed') + ' — ' + window.Workflow.reqNo(r)
            });
        }));
        return out;
    }
    function allEvents() {
        ensureDemoLog();
        return successEvents().concat(window.Store.get().sapLog || []).sort((a, b) => b.ts - a.ts);
    }

    function fmtTs(ts) {
        return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' +
               new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function matches(e) {
        if (S.tab === 'failed' && e.status !== 'failed') return false;
        if (S.tab === 'success' && (e.status !== 'success' || e.dir !== 'out')) return false;
        if (S.tab === 'in' && e.dir !== 'in') return false;
        const q = S.q.trim().toLowerCase();
        if (q && [e.itemName, e.op, e.message, e.reason].filter(Boolean).join(' ').toLowerCase().indexOf(q) === -1) return false;
        return true;
    }

    function listHtml(events) {
        const shown = events.filter(matches);
        if (!shown.length) return '<div class="empty-state">No SAP calls match.</div>';
        return `<div class="panel-card" style="padding:0;overflow:hidden">
            <div class="cat-attr-wrap"><table class="data-table sap-table">
                <thead><tr><th style="padding-left:20px">Time</th><th>Direction</th><th>Item</th><th>Operation</th><th>Status</th><th>Message</th></tr></thead>
                <tbody>${shown.map(e => `
                    <tr class="${e.materialId || e.reqId ? 'clickable' : ''}" ${e.materialId ? `data-act="open-item" data-id="${esc(e.materialId)}"` : (e.reqId ? `data-act="open-req" data-id="${esc(e.reqId)}"` : '')}>
                        <td style="padding-left:20px;white-space:nowrap">${esc(fmtTs(e.ts))}</td>
                        <td>${e.dir === 'in' ? '<span class="type-chip tc-extend">SAP → dmp</span>' : '<span class="type-chip tc-create">dmp → SAP</span>'}</td>
                        <td style="font-weight:600;max-width:220px">${esc(e.itemName)}</td>
                        <td style="font-size:12.5px">${esc(e.op)}</td>
                        <td>${e.status === 'failed' ? '<span class="status-pill blocked">Failed</span>' : '<span class="status-pill approved">Success</span>'}</td>
                        <td style="font-size:12.5px;max-width:340px" class="${e.status === 'failed' ? 'sap-fail-msg' : 'muted'}">${esc(e.message)}${e.reason ? `<div class="sap-reason">Reason: ${esc(e.reason)}</div>` : ''}</td>
                    </tr>`).join('')}</tbody>
            </table></div></div>
            <div class="seen-all">${shown.length} call(s) shown.</div>`;
    }

    window.Views.sapLog = function () {
        const root = document.getElementById('view');
        if (window.Store.session().currentRole !== 'Central team') {
            root.innerHTML = `<div class="page-narrow"><div class="banner info" style="margin-top:24px"><span class="banner-icon">🔒</span>
                <div class="banner-body"><div class="banner-title">Central team only</div>
                The SAP integration dashboard is available to the Central team.</div></div></div>`;
            return;
        }
        const events = allEvents();
        const outCalls = events.filter(e => e.dir === 'out');
        const failed = outCalls.filter(e => e.status === 'failed');
        const inbound = events.filter(e => e.dir === 'in');
        const failPct = outCalls.length ? Math.round(failed.length / outCalls.length * 100) : 0;

        // most common failure reasons
        const reasons = {};
        failed.forEach(e => { const k = e.reason || 'Other'; reasons[k] = (reasons[k] || 0) + 1; });
        const reasonRows = Object.keys(reasons).sort((a, b) => reasons[b] - reasons[a]);
        const maxReason = Math.max(1, ...reasonRows.map(k => reasons[k]));

        const tile = (label, value, sub) => `<div class="stat-tile"><div class="st-label">${esc(label)}</div>
            <div class="st-value">${esc(value)}</div>${sub ? `<div class="st-sub">${esc(sub)}</div>` : ''}</div>`;
        const tab = (key, label) => `<button class="mode-tab ${S.tab === key ? 'active' : ''}" data-act="tab" data-v="${key}">${label}</button>`;

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> › SAP integration</div>
            <div class="page-full dash">
                <div class="form-header" style="margin-bottom:14px">
                    <div>
                        <h2 style="font-size:22px;font-weight:600">SAP integration</h2>
                        <div class="muted" style="font-size:14px;margin-top:3px">Every recording call sent to SAP and every SAP-side change merged back to dmp. Central team view.</div>
                    </div>
                    <button class="btn btn-outline btn-sm" data-act="export-pdf">⬇ Export PDF</button>
                </div>
                <div class="print-head">
                    <div class="ph-title">dmp — SAP integration</div>
                    <div class="ph-sub">${esc(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))} · ${outCalls.length} outbound calls · ${100 - failPct}% success · ${inbound.length} inbound merges · Central team view</div>
                </div>

                <div class="dash-tiles">
                    ${tile('SAP calls', outCalls.length, 'outbound recording calls, all time')}
                    ${tile('Success rate', (100 - failPct) + '%', (outCalls.length - failed.length) + ' of ' + outCalls.length + ' calls succeeded')}
                    ${tile('Failed calls', failed.length, failed.length ? 'see reasons below' : 'no failures')}
                    ${tile('Inbound merges', inbound.length, 'SAP-side changes merged to dmp')}
                </div>

                <div class="dash-grid">
                    ${`<div class="panel-card viz-card"><div class="pc-title">Call outcome</div>
                        <div class="viz-sub">Outbound recording calls — success vs failed</div>
                        <div class="stack-rail">
                            <div class="stack-seg" style="width:${Math.max(2, 100 - failPct)}%;background:#0ca30c">${outCalls.length - failed.length}</div>
                            <div class="stack-seg" style="width:${Math.max(2, failPct)}%;background:#d03b3b">${failed.length}</div>
                        </div>
                        <div class="viz-legend" style="margin-top:10px">
                            <span class="vl-item"><span class="vl-swatch" style="background:#0ca30c"></span>Success — ${outCalls.length - failed.length} (${100 - failPct}%)</span>
                            <span class="vl-item"><span class="vl-swatch" style="background:#d03b3b"></span>Failed — ${failed.length} (${failPct}%)</span>
                        </div>
                    </div>`}
                    ${`<div class="panel-card viz-card"><div class="pc-title">Most common failure reasons</div>
                        <div class="viz-sub">Data consistency is validated in dmp before the call — failures are connection &amp; SAP-side runtime issues</div>
                        ${reasonRows.length ? `<div class="hbar">${reasonRows.map(k => `
                            <div class="hb-row">
                                <div class="hb-line"><span class="hb-label">${esc(k)}</span><span class="hb-value">${reasons[k]}×</span></div>
                                <div class="hb-rail"><div class="hb-bar" style="width:${(reasons[k] / maxReason * 100).toFixed(1)}%;background:#d03b3b"></div></div>
                            </div>`).join('')}</div>`
                        : '<div class="muted">No failures recorded.</div>'}
                    </div>`}
                </div>

                <div class="form-header" style="margin:6px 0 12px;align-items:center">
                    <div class="mode-tabs dash-period" style="max-width:520px">
                        ${tab('all', 'All calls')}${tab('success', 'Successful')}${tab('failed', 'Failed')}${tab('in', 'SAP → dmp')}
                    </div>
                    <div style="display:flex;gap:8px;align-items:stretch">
                        <button class="btn btn-black" data-act="export-excel" style="white-space:nowrap;height:38px;padding:0 14px;border:none">⬇ Export Excel</button>
                        <input type="text" class="form-input" id="sap-q" value="${esc(S.q)}" placeholder="Search item, operation or message…" style="width:300px">
                    </div>
                </div>
                <div id="sap-list">${listHtml(events)}</div>
            </div>`;

        root.querySelector('#sap-q').addEventListener('input', (e) => {
            S.q = e.target.value;
            root.querySelector('#sap-list').innerHTML = listHtml(events);
        });
        window.UI.bindActions(root, {
            'home': () => window.UI.go('#/master'),
            'tab': (t) => { S.tab = t.getAttribute('data-v'); window.Views.sapLog(); },
            'export-pdf': () => window.UI.exportPdf(root.querySelector('.page-full'),
                'dmp_sap_integration_' + new Date().toISOString().slice(0, 10) + '.pdf'),
            'export-excel': () => {
                const shown = events.filter(matches);
                const header = ['Time', 'Direction', 'Item', 'Operation', 'Status', 'Message', 'Failure reason'];
                const rows = shown.map(e => [
                    new Date(e.ts).toLocaleString(), e.dir === 'in' ? 'SAP → dmp' : 'dmp → SAP',
                    e.itemName || '', e.op || '', e.status === 'failed' ? 'Failed' : 'Success',
                    e.message || '', e.reason || ''
                ]);
                window.UI.exportXlsx([header].concat(rows), 'SAP calls',
                    'dmp_sap_calls_' + new Date().toISOString().slice(0, 10) + '.xlsx');
                window.UI.toast({ title: 'Excel exported', body: shown.length + ' call(s) exported' +
                    (S.tab !== 'all' || S.q.trim() ? ' (filtered list)' : '') + '.', kind: 'info' });
            },
            'open-item': (t) => window.UI.go('#/item/' + t.getAttribute('data-id')),
            'open-req': (t) => window.UI.go('#/request/' + t.getAttribute('data-id'))
        });
    };
})();
