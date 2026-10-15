/* ============================================================
   views/dashboard.js — Central team analytics dashboard
   Requests, items, users, approval flow health & bottlenecks.
   Palette: validated categorical slots (blue #2a78d6, orange
   #eb6834, aqua #1baf7a) + reserved status colors for outcomes.
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    const esc = (s) => window.UI.esc(s);

    const C = {
        blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a',
        good: '#0ca30c', bad: '#d03b3b',
        ink: '#0b0b0b', ink2: '#52514e', muted: '#898781',
        grid: '#e1e0d9', axis: '#c3c2b7'
    };

    // stage attribution: the role that acted → the stage the time was spent in
    const ROLE_STAGE = {
        'Accounting': 'Accounting', 'Requester': 'Requester approval',
        'Technical SME': 'Technical review', 'MDM Specialist': 'MDM review',
        'Central team': 'Steward review', 'Inventory team': 'Inventory setup'
    };
    const STAGE_ORDER = ['Accounting', 'Requester approval', 'Technical review', 'MDM review', 'Steward review', 'Inventory setup'];

    // same chip styling as the inbox request list
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
        category: { label: 'New category', cls: 'tc-create' }
    };

    const S = {
        rangeDays: 14,   // 7 | 14 | 30 | 0 (= all time)
        collapsed: false,
        f: { frame: '', customCount: 6, customUnit: 'months', users: [], roles: [], plant: '', types: [], record: [], kind: [] }
    };
    const EMPTY_FILTERS = () => ({ frame: '', customCount: 6, customUnit: 'months', users: [], roles: [], plant: '', types: [], record: [], kind: [] });
    function filtersActive() {
        const f = S.f;
        return !!(f.frame || f.users.length || f.roles.length || f.plant || f.types.length || f.record.length || f.kind.length);
    }
    // custom time frame from the sidebar; null = follow the period tabs.
    // returns {label, fromTs, monthly, nDays?, monthsBack?} — windows longer than
    // ~2 months plot monthly points, shorter ones keep daily points.
    function frameSpec() {
        const f = S.f;
        if (!f.frame) return null;
        let count, unit;
        if (f.frame === 'custom') {
            count = Math.max(1, Math.min(999, Math.round(Number(f.customCount) || 1)));
            unit = f.customUnit === 'days' || f.customUnit === 'months' ? f.customUnit : 'years';
        } else { count = Number(f.frame); unit = 'years'; }
        const approxDays = unit === 'days' ? count : (unit === 'months' ? count * 30.44 : count * 365);
        const monthly = approxDays > 62;
        const label = 'last ' + (count === 1 ? unit.replace(/s$/, '') : count + ' ' + unit);
        if (monthly) {
            const monthsBack = unit === 'years' ? count * 12 : (unit === 'months' ? count : Math.ceil(count / 30.44));
            const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0);
            return { label, monthly, monthsBack,
                fromTs: new Date(m.getFullYear(), m.getMonth() - (monthsBack - 1), 1).getTime() };
        }
        const nDays = unit === 'days' ? count : Math.round(count * 30.44);
        const d = new Date(); d.setHours(0, 0, 0, 0);
        return { label, monthly, nDays, fromTs: d.getTime() - (nDays - 1) * 86400e3 };
    }

    // record-type helpers — how many sourcing / golden items a request carries
    const srcItems = (r) => {
        if (r.type !== 'create' || r.status === 'Draft') return 0;
        if (r.bulk) return (r.items || []).filter(it => ((it.payload || {}).recordType) === 'Sourcing record').length;
        return ((r.payload || {}).recordType) === 'Sourcing record' ? 1 : 0;
    };
    const goldItems = (r) => {
        if (r.type !== 'create' || r.status === 'Draft') return 0;
        if (r.bulk) return (r.items || []).filter(it => ((it.payload || {}).recordType) !== 'Sourcing record').length;
        return ((r.payload || {}).recordType) === 'Sourcing record' ? 0 : 1;
    };

    // sidebar filters: a request has to pass every active filter.
    // user / role filters match PARTICIPATION — the request was submitted by,
    // acted on by, or is currently waiting with the selected user / role.
    function passesFilters(r) {
        const f = S.f;
        if (f.users.length) {
            const acted = (r.history || []).some(h => f.users.indexOf(h.actorUser) !== -1);
            if (f.users.indexOf(r.requesterUser) === -1 && !acted) return false;
        }
        if (f.roles.length) {
            const st = window.Workflow.currentStage(r);
            const acted = (r.history || []).some(h => f.roles.indexOf(h.actorRole) !== -1);
            const holding = st && !st.system && f.roles.indexOf(st.role) !== -1;
            if (f.roles.indexOf(r.requesterRole) === -1 && !acted && !holding) return false;
        }
        if (f.plant && r.requesterPlant !== f.plant) return false;
        if (f.types.length && f.types.indexOf(r.type) === -1) return false;
        if (f.kind.length && f.kind.indexOf(r.bulk ? 'bulk' : 'single') === -1) return false;
        if (f.record.length) {
            const wantSrc = f.record.indexOf('Sourcing record') !== -1 && srcItems(r) > 0;
            const wantGold = f.record.indexOf('Golden record') !== -1 && goldItems(r) > 0;
            if (!wantSrc && !wantGold) return false;
        }
        return true;
    }

    /* ---------------- data crunching ---------------- */
    function inRange(ts, from) { return !from || ts >= from; }
    function rangeFrom() {
        const fs = frameSpec();
        if (fs) return fs.fromTs;
        if (!S.rangeDays) return 0;
        const d = new Date(); d.setHours(0, 0, 0, 0);
        return d.getTime() - (S.rangeDays - 1) * 86400e3;
    }
    function lastTs(r) { return (r.history && r.history.length) ? r.history[r.history.length - 1].ts : r.createdTs; }
    function fmtDur(ms) {
        if (ms < 60e3) return '<1 m';
        if (ms < 3600e3) return Math.round(ms / 60e3) + ' m';
        if (ms < 48 * 3600e3) return (ms / 3600e3).toFixed(1) + ' h';
        return (ms / 86400e3).toFixed(1) + ' d';
    }
    function hours(ms) { return ms / 3600e3; }
    function plural2(n, stem, one, many) { return n + ' ' + stem + (n === 1 ? one : many); }

    function crunch() {
        const allReqs = window.Store.requests();
        const reqs = allReqs.filter(passesFilters);
        const from = rangeFrom();
        const now = Date.now();

        const open = reqs.filter(r => r.status === 'In Review' || r.status === 'Approved');
        const completedAll = reqs.filter(r => r.status === 'Completed');
        const completed = completedAll.filter(r => inRange(lastTs(r), from));
        const declined = reqs.filter(r => r.status === 'Declined' && inRange(lastTs(r), from));

        // avg cycle time: submission → completion, for completed requests in range
        const cycles = completed.map(r => lastTs(r) - r.createdTs).filter(v => v > 0);
        const avgCycle = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;

        // current queue: how many requests sit at each human stage right now,
        // who owns the stage, and the longest wait among them
        const queue = {};
        open.forEach(r => {
            const st = window.Workflow.currentStage(r);
            if (!st || st.system) return;
            const q = queue[st.label] = queue[st.label] || { count: 0, maxMs: 0, role: st.role, reqs: [] };
            q.count += 1;
            const w = now - lastTs(r);
            q.maxMs = Math.max(q.maxMs, w);
            q.reqs.push({ id: r.id, no: r.no, title: r.title, type: r.type, bulk: !!r.bulk, ms: w });
        });

        // avg dwell per stage + decisions per role (from request history, scoped),
        // keeping the underlying requests so charts can list them on demand
        const dwell = {}, decisions = {};
        reqs.forEach(r => {
            const info = { id: r.id, no: r.no, title: r.title, type: r.type, bulk: !!r.bulk };
            let prev = r.createdTs;
            (r.history || []).forEach(h => {
                const dt = h.ts - prev; prev = h.ts;
                if (h.action !== 'approved' && h.action !== 'declined') return;
                if (!inRange(h.ts, from)) return;
                const stage = ROLE_STAGE[h.actorRole];
                if (stage && dt > 0) (dwell[stage] = dwell[stage] || []).push(Object.assign({ ms: dt }, info));
                const who = h.actorRole || '—';
                const dec = decisions[who] = decisions[who] || { approved: 0, declined: 0, reqsA: [], reqsD: [] };
                dec[h.action] += 1;
                (h.action === 'approved' ? dec.reqsA : dec.reqsD).push(info);
            });
        });

        // requests per day: submitted vs completed.
        // day buckets normally; month buckets when a year-scale time frame is set.
        const days = [];
        const fspec = frameSpec();
        if (fspec && fspec.monthly) {
            const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
            for (let i = fspec.monthsBack - 1; i >= 0; i--) {
                const dt = new Date(m0.getFullYear(), m0.getMonth() - i, 1);
                const end = new Date(m0.getFullYear(), m0.getMonth() - i + 1, 1);
                days.push({ t: dt.getTime(), end: end.getTime(),
                    label: dt.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), submitted: 0, completed: 0 });
            }
        } else {
            const span = fspec ? fspec.nDays
                : (S.rangeDays || Math.min(30, Math.ceil((now - Math.min(...reqs.map(r => r.createdTs), now)) / 86400e3) + 1));
            const d0 = new Date(); d0.setHours(0, 0, 0, 0);
            for (let i = span - 1; i >= 0; i--) {
                const t = d0.getTime() - i * 86400e3;
                days.push({ t, end: t + 86400e3, label: new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), submitted: 0, completed: 0 });
            }
        }
        const bucket = (ts) => days.find(d => ts >= d.t && ts < d.end);
        reqs.forEach(r => {
            const b = bucket(r.createdTs);
            if (b) {
                b.submitted += 1;
                (b.subReqs = b.subReqs || []).push({ id: r.id, no: r.no, title: r.title, type: r.type, bulk: !!r.bulk, status: r.status });
            }
            if (r.status === 'Completed') {
                const c = bucket(lastTs(r));
                if (c) {
                    c.completed += 1;
                    (c._cycles = c._cycles || []).push(lastTs(r) - r.createdTs);
                    (c.doneReqs = c.doneReqs || []).push({ id: r.id, no: r.no, title: r.title, type: r.type, bulk: !!r.bulk, ms: lastTs(r) - r.createdTs });
                }
            }
        });
        // backlog trend: how many requests were OPEN at the end of each day
        // (submitted by then, not yet completed/declined by then; drafts excluded)
        const submitted = reqs.filter(r => r.status !== 'Draft');
        days.forEach(d => {
            const end = d.end;
            const openList = submitted.filter(r => {
                if (r.createdTs >= end) return false;
                if (r.status === 'Completed' || r.status === 'Declined') return lastTs(r) >= end;
                return true;   // still open today
            });
            d.openN = openList.length;
            d.openReqs = openList.map(r => ({ id: r.id, no: r.no, title: r.title, type: r.type, bulk: !!r.bulk, extra: r.status }));
        });
        days.forEach(d => {
            if (d._cycles) {
                d.cycleH = hours(d._cycles.reduce((a, b) => a + b, 0) / d._cycles.length);
                d.cycleN = d._cycles.length;
                d.cycleMin = Math.min(...d._cycles);
                d.cycleMax = Math.max(...d._cycles);
            } else { d.cycleH = null; }
        });

        // churn / rework: requests that were sent back or had items declined at
        // least once — they needed additional data or a correction loop
        const inScope = reqs.filter(r => inRange(r.createdTs, from));
        const needsRework = (r) =>
            (r.history || []).some(h => h.action === 'declined') ||
            (r.items || []).some(it => it.status === 'Declined');
        const rework = { total: inScope.length, count: inScope.filter(needsRework).length, byStage: {} };
        reqs.forEach(r => (r.history || []).forEach(h => {
            if (h.action !== 'declined' || !inRange(h.ts, from)) return;
            const stage = ROLE_STAGE[h.actorRole];
            if (stage) {
                const e = rework.byStage[stage] = rework.byStage[stage] || { count: 0, reqs: [], items: [] };
                e.count += 1;
                e.reqs.push('# ' + String(r.no || 0).padStart(4, '0'));
                e.items.push({ id: r.id, no: r.no, title: r.title, type: r.type, bulk: !!r.bulk });
            }
        }));

        // AI duplicate matching: outcome of every AI-analysed bulk row
        const aiMatch = { exists_my_plant: 0, exists_other_plant: 0, not_found: 0, category_missing: 0, rows: 0 };
        (window.Store.get().bulkBatches || []).forEach(b => {
            if (b.pending || !window.Views._bulkProcessRow) return;
            if (S.f.users.length && S.f.users.indexOf(b.user) === -1) return;
            if (S.f.plant && b.plant !== S.f.plant) return;
            b.rows.forEach((row, i) => {
                const x = window.Views._bulkProcessRow(row, i);
                if (aiMatch[x.outcome] === undefined) return;
                aiMatch[x.outcome] += 1; aiMatch.rows += 1;
            });
        });

        // sourcing records: new-item requests/items tagged 'Sourcing record' —
        // technical attributes are optional there, so these enter the master
        // as incomplete records that need enrichment later
        const rinfo = (r, extra) => ({ id: r.id, no: r.no, title: r.title, type: r.type, bulk: !!r.bulk, extra });
        const src = { reqs: [], items: 0, goldenReqs: [], goldenItems: 0, all: [] };
        reqs.forEach(r => {
            const sn = srcItems(r), gn = goldItems(r);
            if (sn) src.all.push({ ts: r.createdTs, n: sn, info: rinfo(r, sn + ' item' + (sn === 1 ? '' : 's') + ' · ' + r.status) });
            if (!inRange(r.createdTs, from)) return;
            if (sn) { src.reqs.push(Object.assign({ n: sn, status: r.status }, rinfo(r))); src.items += sn; }
            if (gn) { src.goldenReqs.push(Object.assign({ n: gn, status: r.status }, rinfo(r))); src.goldenItems += gn; }
        });
        // records currently in the material master, by completeness
        // (scoped to the plant filter when one is set)
        const mats = window.Store.materials().filter(m => !S.f.plant || (m.plants || []).indexOf(S.f.plant) !== -1);
        const matSrc = mats.filter(m => m.recordType === 'Sourcing record').length;
        const matGold = mats.length - matSrc;

        // category requests: proposals for new catalog categories.
        // the chain is Central-only, so Completed means the category was added.
        const catItems = (r) => r.type !== 'category' || r.status === 'Draft' ? 0 : (r.bulk ? (r.items || []).length : 1);
        const catAddedItems = (r) => r.type !== 'category' || r.status !== 'Completed' ? 0
            : (r.bulk ? (r.items || []).filter(it => it.status !== 'Declined').length : 1);
        const cat = { reqs: [], items: 0, added: 0, addedAll: [], out: { done: [], open: [], declined: [] } };
        reqs.forEach(r => {
            const n = catItems(r);
            if (!n) return;
            const an = catAddedItems(r);
            if (an) cat.addedAll.push({ ts: lastTs(r), n: an, info: rinfo(r, plural2(an, 'categor', 'y', 'ies') + ' added') });
            if (inRange(r.createdTs, from)) {
                cat.reqs.push({ ts: r.createdTs, n, info: rinfo(r, plural2(n, 'categor', 'y', 'ies') + ' · ' + r.status) });
                cat.items += n;
            }
            if (inRange(lastTs(r), from) && r.status === 'Completed') cat.added += an;
            const bin = r.status === 'Completed' ? 'done' : (r.status === 'Declined' ? 'declined' : 'open');
            if (inRange(r.status === 'Completed' || r.status === 'Declined' ? lastTs(r) : r.createdTs, from))
                cat.out[bin].push(Object.assign({ n }, rinfo(r, plural2(n, 'categor', 'y', 'ies') + ' · ' + r.status)));
        });
        const catalogAll = (window.Store.get().datasets.CATEGORY_ATTRIBUTES || []);
        const catalogNow = catalogAll.length;
        const catalogFromReqs = catalogAll.filter(c => c.addedByRequest).length;

        // category per day: requests submitted + catalog size trend
        days.forEach(d => { d.catN = 0; d.catReqs = []; });
        cat.reqs.forEach(x => { const b = bucket(x.ts); if (b) { b.catN += 1; b.catReqs.push(x.info); } });
        // catalog size at the start of the window = size now minus additions inside it
        let catBase = catalogNow - cat.addedAll.filter(x => x.ts >= days[0].t).reduce((a, b) => a + b.n, 0);
        days.forEach(d => {
            const end = d.end;
            catBase += cat.addedAll.filter(x => x.ts >= d.t && x.ts < end).reduce((a, b) => a + b.n, 0);
            d.catCum = catBase;
            d.catCumReqs = cat.addedAll.filter(x => x.ts < end).map(x => x.info);
        });

        // sourcing per day: new sourcing items submitted + running accumulated total
        days.forEach(d => { d.srcN = 0; d.srcReqs = []; });
        let srcBase = 0;   // sourcing items created before the visible window
        src.all.forEach(x => {
            const b = bucket(x.ts);
            if (b) { b.srcN += x.n; b.srcReqs.push(x.info); }
            else if (x.ts < days[0].t) srcBase += x.n;
        });
        let srcRun = srcBase;
        days.forEach(d => {
            srcRun += d.srcN;
            d.srcCum = srcRun;
            const end = d.end;
            d.srcCumReqs = src.all.filter(x => x.ts < end).map(x => x.info);
        });

        // types (in range by creation)
        const types = {};
        reqs.filter(r => inRange(r.createdTs, from)).forEach(r => {
            const label = window.Workflow.typeLabel(r.type);
            const t = types[label] = types[label] || { count: 0, reqs: [] };
            t.count += 1;
            t.reqs.push({ id: r.id, no: r.no, title: r.title, type: r.type, bulk: !!r.bulk, status: r.status });
        });

        // longest-waiting open requests (now)
        const waiting = open.map(r => {
            const st = window.Workflow.currentStage(r);
            return { r, stage: st ? st.label : '—', role: st ? st.role : '—', ms: now - lastTs(r) };
        }).filter(w => w.stage !== '—').sort((a, b) => b.ms - a.ms).slice(0, 10);

        return { reqs, allReqs, open, completed, declined, avgCycle, queue, dwell, decisions, days, types, waiting,
                 rework, aiMatch, src, matSrc, matGold, cat, catalogNow, catalogFromReqs };
    }

    /* ---------------- SVG builders ---------------- */
    // horizontal bar chart — crisp HTML list rows (native text, no SVG scaling):
    //   Label ····································· value
    //   [■■■■■■■■■■■■■■■■■■■■------------------ rail ---]
    // rows: [{label, value, sub?, tip?}] — sub renders muted next to the value,
    // tip replaces the tooltip's context line for a fuller explanation
    function hbar(rows, color, fmt) {
        fmt = fmt || ((v) => String(v));
        const max = Math.max(1, ...rows.map(r => r.value));
        return `<div class="hbar">${rows.map(r => {
            const pct = Math.max(1.2, r.value / max * 100);
            return `<div class="hb-row viz-row" data-label="${esc(r.label)}" data-value="${esc(fmt(r.value))}"${r.tip ? ` data-tip="${esc(r.label + ' · ' + r.tip)}"` : ''}${r.list !== undefined ? ` data-list="${r.list}"` : ''}>
                <div class="hb-line"><span class="hb-label">${esc(r.label)}</span>
                    <span class="hb-value">${r.sub ? `<span class="hb-sub">${esc(r.sub)}</span>` : ''}${esc(fmt(r.value))}</span></div>
                <div class="hb-rail"><div class="hb-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
            </div>`;
        }).join('')}</div>`;
    }

    // single stacked bar — one rail split into colored segments, so the split
    // between outcomes is read as parts of one whole. rows: [{label, value, color, tip?, list?}]
    function stackBar(rows) {
        const total = rows.reduce((a, b) => a + b.value, 0);
        if (!total) return '';
        const segs = rows.map(r => {
            const pct = r.value / total * 100;
            return `<div class="stack-seg viz-row" style="width:${pct.toFixed(1)}%;background:${r.color}"
                data-label="${esc(r.label)}" data-value="${esc(r.value + ' (' + Math.round(pct) + '%)')}"${r.tip ? ` data-tip="${esc(r.label + ' · ' + r.tip)}"` : ''}${r.list !== undefined ? ` data-list="${r.list}"` : ''}>${pct >= 9 ? r.value : ''}</div>`;
        }).join('');
        const legend = rows.map(r =>
            `<span class="vl-item"><span class="vl-swatch" style="background:${r.color}"></span>${esc(r.label)} — ${r.value} (${Math.round(r.value / total * 100)}%)</span>`).join('');
        return `<div class="stack-rail">${segs}</div><div class="viz-legend" style="margin-top:10px">${legend}</div>`;
    }

    // grouped 2-series — one label line with a mini-summary + share, two rails beneath
    function hbarGrouped(rows, colA, colB, nameA, nameB) {
        const max = Math.max(1, ...rows.map(r => Math.max(r.a, r.b)));
        return `<div class="hbar">${rows.map(r => {
            const total = r.a + r.b;
            const rail = (val, col, name, list) => {
                const pct = Math.max(1.2, val / max * 100);
                const share = total ? Math.round(val / total * 100) : 0;
                return `<div class="hb-rail hb-rail-thin viz-row" data-label="${esc(r.label + ' — ' + name)}" data-value="${val}"
                    data-tip="${esc(`${r.label} · ${name.toLowerCase()} ${val} of ${total} decisions (${share}%)`)}"${list !== undefined ? ` data-list="${list}"` : ''}>
                    <div class="hb-bar" style="width:${pct.toFixed(1)}%;background:${col}"></div></div>`;
            };
            const rate = total ? Math.round(r.a / total * 100) : 0;
            return `<div class="hb-row hb-row-grouped">
                <div class="hb-line"><span class="hb-label">${esc(r.label)}</span>
                    <span class="hb-mini"><span class="hb-sub">${total ? rate + '% approved' : ''}</span>
                        <i style="background:${colA}"></i>${r.a}<i style="background:${colB}"></i>${r.b}</span></div>
                ${rail(r.a, colA, nameA, r.listA)}
                ${rail(r.b, colB, nameB, r.listB)}
            </div>`;
        }).join('')}</div>`;
    }

    // line chart over days; series: [{key, color, label, fmt?, area?, endValue?}]
    // null values leave gaps; area = soft fill under the line; endValue = label
    // the latest value (single-series trend) instead of the series name.
    // tipFor(day) optionally builds a richer tooltip line for a day.
    function lineChart(days, series, tipFor, opts) {
        opts = opts || {};
        const W = opts.wide ? 1450 : 640, H = opts.wide ? 280 : 190,
            padL = 34, padR = series.every(s => s.endValue) ? 64 : 96, padT = 14, padB = 26;
        const vals = [];
        days.forEach(d => series.forEach(s => { const v = d[s.key]; if (v !== null && v !== undefined) vals.push(v); }));
        const max = Math.max(2, ...vals);
        const iw = W - padL - padR, ih = H - padT - padB;
        const x = (i) => padL + (days.length === 1 ? iw / 2 : i / (days.length - 1) * iw);
        const y = (v) => padT + ih - (v / max) * ih;
        const path = (key) => {
            let dstr = '', pen = false;
            days.forEach((d, i) => {
                const v = d[key];
                if (v === null || v === undefined) { pen = false; return; }
                dstr += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1) + ' ';
                pen = true;
            });
            return dstr.trim();
        };
        const gridN = 3;
        let grid = '';
        for (let g = 0; g <= gridN; g++) {
            const gy = padT + ih - (g / gridN) * ih;
            const gv = Math.round(max * g / gridN * 10) / 10;
            grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="${C.grid}" stroke-width="1"></line>
                <text x="${padL - 6}" y="${gy}" text-anchor="end" dominant-baseline="middle" font-size="10.5" fill="${C.muted}">${gv}</text>`;
        }
        const ticks = days.map((d, i) => {
            if (days.length > 10 && i % Math.ceil(days.length / 7) !== 0 && i !== days.length - 1) return '';
            return `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${C.muted}">${esc(d.label)}</text>`;
        }).join('');
        const lastPt = (key) => { for (let i = days.length - 1; i >= 0; i--) { const v = days[i][key]; if (v !== null && v !== undefined) return { i, v }; } return null; };
        const fmt = (s, v) => (v === null || v === undefined) ? '—' : (s.fmt ? s.fmt(v) : String(v));
        // endpoint marker on every series; label = latest value (trend) or series name.
        // Labels that would land on top of each other are pushed apart vertically.
        const ends = series.map(s => { const p = lastPt(s.key); return p ? { s, p, ly: y(p.v) } : null; }).filter(Boolean);
        ends.sort((a, b) => a.ly - b.ly).forEach((e, i, arr) => {
            if (i && e.ly - arr[i - 1].ly < 14) e.ly = arr[i - 1].ly + 14;
        });
        const endLabs = ends.map(({ s, p, ly }) => {
            const dot = `<circle cx="${x(p.i)}" cy="${y(p.v)}" r="3.5" fill="${s.color}" stroke="#ffffff" stroke-width="2"></circle>`;
            return dot + (s.endValue
                ? `<text x="${x(p.i) + 9}" y="${ly}" dominant-baseline="middle" font-size="12" font-weight="700" fill="${C.ink}">${esc(fmt(s, p.v))}</text>`
                : `<text x="${W - padR + 10}" y="${ly}" dominant-baseline="middle" font-size="11.5" font-weight="600" fill="${s.color}">${esc(s.label)}</text>`);
        }).join('');
        // soft area fill: one closed shape per contiguous run of values
        const areas = series.filter(s => s.area).map(s => {
            let out = '', run = [];
            const flush = () => {
                if (run.length < 2) { run = []; return; }
                const base = padT + ih;
                out += `<path d="M${x(run[0]).toFixed(1)},${base} ` +
                    run.map(i => 'L' + x(i).toFixed(1) + ',' + y(days[i][s.key]).toFixed(1)).join(' ') +
                    ` L${x(run[run.length - 1]).toFixed(1)},${base} Z" fill="${s.color}" opacity="0.08"></path>`;
                run = [];
            };
            days.forEach((d, i) => { (d[s.key] === null || d[s.key] === undefined) ? flush() : run.push(i); });
            flush();
            return out;
        }).join('');
        const LIST_KEYS = { volume: ['subReqs', 'doneReqs'], backlog: ['openReqs'],
                            sourcing: ['srcReqs'], sourcingCum: ['srcCumReqs'],
                            catreq: ['catReqs'], catCum: ['catCumReqs'], cycle: ['doneReqs'] };
        const hits = days.map((d, i) => {
            const hasList = opts.seeList && (LIST_KEYS[opts.kind || 'cycle'] || []).some(k => d[k] && d[k].length);
            return `<g class="viz-day" data-di="${i}"${hasList ? ` data-see="1" data-kind="${esc(opts.kind || 'cycle')}"` : ''} data-label="${esc(d.label)}" data-sub="${esc(tipFor ? tipFor(d) : series.map(s => s.label + ' ' + fmt(s, d[s.key])).join(' · '))}">
            <rect x="${(i === 0 ? padL : (x(i) + x(i - 1)) / 2).toFixed(1)}" y="${padT}" width="${(days.length === 1 ? iw : iw / (days.length - 1)).toFixed(1)}" height="${ih}" fill="transparent"></rect>
            <line class="viz-cross" x1="${x(i)}" y1="${padT}" x2="${x(i)}" y2="${padT + ih}" stroke="${C.axis}" stroke-width="1" opacity="0"></line>
            ${series.map(s => (d[s.key] === null || d[s.key] === undefined) ? '' :
                `<circle cx="${x(i)}" cy="${y(d[s.key])}" r="4" fill="${s.color}" opacity="0" class="viz-dot"></circle>`).join('')}
        </g>`; }).join('');
        const lines = series.map(s => `<path d="${path(s.key)}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 1.5 : 2}"${s.dash ? ' stroke-dasharray="6 4" opacity="0.75"' : ''} stroke-linejoin="round"></path>` +
            days.map((d, i) => {
                // isolated point (gap either side) would be invisible as a line — draw a dot
                const v = d[s.key];
                if (v === null || v === undefined) return '';
                const prev = i > 0 ? days[i - 1][s.key] : null, next = i < days.length - 1 ? days[i + 1][s.key] : null;
                return (prev === null || prev === undefined) && (next === null || next === undefined)
                    ? `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"></circle>` : '';
            }).join('')).join('');
        return `<svg class="viz viz-line" viewBox="0 0 ${W} ${H}" role="img">${grid}${areas}${lines}${endLabs}${ticks}${hits}</svg>`;
    }

    /* ---------------- page ---------------- */
    function tile(label, value, sub) {
        return `<div class="stat-tile"><div class="st-label">${esc(label)}</div>
            <div class="st-value">${esc(value)}</div>${sub ? `<div class="st-sub">${esc(sub)}</div>` : ''}</div>`;
    }
    function card(title, sub, bodyHtml, cls) {
        return `<div class="panel-card viz-card ${cls || ''}"><div class="pc-title">${esc(title)}</div>
            ${sub ? `<div class="viz-sub">${esc(sub)}</div>` : ''}${bodyHtml}</div>`;
    }

    function sidebarHtml() {
        const f = S.f;
        const ds = window.Store.get().datasets;
        // Central team view — offer the FULL master data, not just values seen in requests
        const users = (window.Store.get().users || []).map(u => u.name).sort();
        const roles = (ds.ROLES || []).slice();
        const plants = (ds.PLANTS || []).slice();
        const types = [...new Set(window.Store.requests().map(r => r.type))];
        const cb = (group, val, label) => `<label class="checkbox-label"><input type="checkbox" data-dash-filter="${group}" value="${esc(val)}" ${f[group].indexOf(val) !== -1 ? 'checked' : ''}> ${esc(label || val)}</label>`;
        return `<aside class="sidebar ${S.collapsed ? 'collapsed' : ''}">
            <div class="sidebar-collapse-icon" data-act="toggle-sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
            </div>
            <div class="filter-section first">
                <div class="filter-title">Custom time frame</div>
                <select class="filter-select" id="dash-frame">
                    <option value="">Select years…</option>
                    <option value="1" ${f.frame === '1' ? 'selected' : ''}>Last year</option>
                    <option value="3" ${f.frame === '3' ? 'selected' : ''}>Last 3 years</option>
                    <option value="custom" ${f.frame === 'custom' ? 'selected' : ''}>Custom…</option>
                </select>
                ${f.frame === 'custom' ? `<div style="display:flex;gap:8px;margin-top:8px">
                    <input type="number" id="dash-count" class="form-input" min="1" max="999" step="1" value="${esc(f.customCount)}" style="width:74px" placeholder="Count">
                    <select class="filter-select" id="dash-unit" style="flex:1;margin:0">
                        <option value="days" ${f.customUnit === 'days' ? 'selected' : ''}>Days</option>
                        <option value="months" ${f.customUnit === 'months' ? 'selected' : ''}>Months</option>
                        <option value="years" ${f.customUnit === 'years' ? 'selected' : ''}>Years</option>
                    </select>
                </div>` : ''}
                ${f.frame ? `<div class="muted" style="font-size:11.5px;margin-top:6px">Overrides the period tabs${frameSpec() && frameSpec().monthly ? ' · monthly trend points' : ''}.</div>` : ''}
            </div>
            <div class="filter-section">
                <div class="filter-title">Plant</div>
                <select class="filter-select" id="dash-plant">
                    <option value="">All plants</option>
                    ${plants.map(p => `<option value="${esc(p.code)}" ${f.plant === p.code ? 'selected' : ''}>${esc(p.code + ' — ' + p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="filter-section">
                <div class="filter-title">User</div>
                <div class="checkbox-group">${users.map(u => cb('users', u)).join('')}</div>
                <div class="muted" style="font-size:11.5px;margin-top:6px">Requests they submitted, acted on, or are holding.</div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Role</div>
                <div class="checkbox-group">${roles.map(r => cb('roles', r)).join('')}</div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Request type</div>
                <div class="checkbox-group">${types.map(t => cb('types', t, window.Workflow.typeLabel(t))).join('')}</div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Record type</div>
                <div class="checkbox-group">
                    ${cb('record', 'Golden record', 'Golden record (complete)')}
                    ${cb('record', 'Sourcing record', 'Sourcing record (incomplete)')}
                </div>
            </div>
            <div class="filter-section">
                <div class="filter-title">Request kind</div>
                <div class="checkbox-group">
                    ${cb('kind', 'single', 'Single requests')}
                    ${cb('kind', 'bulk', 'Bulk requests')}
                </div>
            </div>
            <div class="filter-section">
                <button class="btn btn-outline btn-sm" data-act="clear-dash-filters" ${filtersActive() ? '' : 'disabled'}>Clear filters</button>
            </div>
        </aside>`;
    }

    window.Views.dashboard = function () {
        const root = document.getElementById('view');
        const s = window.Store.session();
        if (s.currentRole !== 'Central team') {
            root.innerHTML = `<div class="page-narrow"><div class="banner info" style="margin-top:24px"><span class="banner-icon">🔒</span>
                <div class="banner-body"><div class="banner-title">Central team only</div>
                This analytics dashboard is available to the Central team. Switch role to <strong>Central team</strong> to view it.</div></div></div>`;
            return;
        }
        const d = crunch();
        const fy = frameSpec();
        const rangeLabel = fy ? fy.label : (S.rangeDays ? 'last ' + S.rangeDays + ' days' : 'all time');

        // request lists behind each bar — referenced by index from data-list attrs
        const LISTS = [];
        const regList = (title, sub, items) => { LISTS.push({ title, sub, items }); return LISTS.length - 1; };
        // one request can appear several times (rework loops) — keep the slowest pass
        const uniq = (items) => {
            const m = new Map();
            items.forEach(x => { const e = m.get(x.id); if (!e || (x.ms || 0) > (e.ms || 0)) m.set(x.id, x); });
            return [...m.values()];
        };

        const queueRows = STAGE_ORDER.filter(st => d.queue[st]).map(st => {
            const q = d.queue[st];
            return { label: st, value: q.count, sub: 'longest ' + fmtDur(q.maxMs),
                tip: `${q.count} request${q.count === 1 ? '' : 's'} waiting · longest ${fmtDur(q.maxMs)} · with ${q.role}`,
                list: regList('Waiting at ' + st, `${q.count} request${q.count === 1 ? '' : 's'} · with ${q.role}`,
                    q.reqs.slice().sort((a, b) => b.ms - a.ms).map(r => Object.assign({}, r, { extra: fmtDur(r.ms) }))) };
        });
        const dwellRows = STAGE_ORDER.map(st => {
            const arr = d.dwell[st] || [];
            if (!arr.length) return null;
            const avg = arr.reduce((a, b) => a + b.ms, 0) / arr.length;
            const slowestMs = Math.max(...arr.map(x => x.ms));
            return { label: st, value: hours(avg), n: arr.length, sub: arr.length + ' decision' + (arr.length === 1 ? '' : 's'),
                tip: `avg ${fmtDur(avg)} across ${arr.length} decision${arr.length === 1 ? '' : 's'} · slowest single ${fmtDur(slowestMs)}`,
                list: regList('Decisions at ' + st, `${arr.length} decision${arr.length === 1 ? '' : 's'} · avg ${fmtDur(avg)}`,
                    uniq(arr).sort((a, b) => b.ms - a.ms).map(r => Object.assign({}, r, { extra: fmtDur(r.ms) }))) };
        }).filter(Boolean);
        const slowest = dwellRows.length ? dwellRows.reduce((a, b) => (b.value > a.value ? b : a)) : null;
        const decRows = Object.keys(d.decisions)
            .sort((a, b) => (d.decisions[b].approved + d.decisions[b].declined) - (d.decisions[a].approved + d.decisions[a].declined))
            .map(role => {
                const dec = d.decisions[role];
                return { label: role, a: dec.approved, b: dec.declined,
                    listA: dec.reqsA.length ? regList(role + ' — approved', dec.approved + ' approval decision' + (dec.approved === 1 ? '' : 's'),
                        uniq(dec.reqsA).map(r => Object.assign({}, r, { extra: 'Approved' }))) : undefined,
                    listB: dec.reqsD.length ? regList(role + ' — declined', dec.declined + ' decline decision' + (dec.declined === 1 ? '' : 's'),
                        uniq(dec.reqsD).map(r => Object.assign({}, r, { extra: 'Declined' }))) : undefined };
            });
        const typeTotal = Object.values(d.types).reduce((a, b) => a + b.count, 0);
        const typeRows = Object.keys(d.types).sort((a, b) => d.types[b].count - d.types[a].count).map(t => {
            const e = d.types[t];
            const share = typeTotal ? Math.round(e.count / typeTotal * 100) : 0;
            return { label: t, value: e.count, sub: share + '%',
                tip: `${e.count} of ${typeTotal} requests (${share}%)`,
                list: regList(t + ' requests', `${e.count} submitted in the period`,
                    e.reqs.slice().sort((a, b) => (b.no || 0) - (a.no || 0)).map(r => Object.assign({}, r, { extra: r.status }))) };
        });

        // sourcing section: incomplete (sourcing) vs complete (golden) new items
        const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
        const srcAvg = d.src.reqs.length ? d.src.items / d.src.reqs.length : 0;
        const recTotal = d.src.items + d.src.goldenItems;
        const recRows = [
            { label: 'Sourcing record (incomplete)', value: d.src.items, reqs: d.src.reqs },
            { label: 'Golden record (complete)', value: d.src.goldenItems, reqs: d.src.goldenReqs }
        ].filter(r => r.value).map(r => {
            const share = recTotal ? Math.round(r.value / recTotal * 100) : 0;
            return { label: r.label, value: r.value, sub: plural(r.reqs.length, 'request') + ' · ' + share + '%',
                tip: `${r.value} of ${recTotal} new items requested (${share}%) · across ${plural(r.reqs.length, 'request')}`,
                list: regList(r.label, `${plural(r.reqs.length, 'request')} · ${plural(r.value, 'item')}`,
                    r.reqs.slice().sort((a, b) => (b.no || 0) - (a.no || 0))
                        .map(x => Object.assign({}, x, { extra: plural(x.n, 'item') + ' · ' + x.status }))) };
        });
        const perReqRows = d.src.reqs.slice().sort((a, b) => b.n - a.n).slice(0, 10).map(r => ({
            label: '# ' + String(r.no || 0).padStart(4, '0') + ' · ' + r.title,
            value: r.n, sub: r.status,
            tip: `${plural(r.n, 'sourcing item')} · ${r.status}`,
            list: regList('Request # ' + String(r.no || 0).padStart(4, '0'), plural(r.n, 'sourcing item'),
                [Object.assign({}, r, { extra: r.status })]) }));

        // category section: outcomes of category requests, with drill-downs
        const catOutRows = [
            { label: 'Approved & added to catalog', key: 'done', color: C.good },
            { label: 'In review', key: 'open', color: C.blue },
            { label: 'Declined', key: 'declined', color: C.bad }
        ].map(o => {
            const list = d.cat.out[o.key];
            if (!list.length) return null;
            const n = list.reduce((a, b) => a + b.n, 0);
            return { label: o.label, value: n, color: o.color,
                tip: `${plural2(n, 'categor', 'y', 'ies')} across ${plural(list.length, 'request')}`,
                list: regList(o.label, `${plural(list.length, 'request')} · ${plural2(n, 'categor', 'y', 'ies')}`,
                    list.slice().sort((a, b) => (b.no || 0) - (a.no || 0))) };
        }).filter(Boolean);

        root.innerHTML = `
            <div class="sub-header"><span class="crumb-link" data-act="home">Material Master</span> › Analytics dashboard</div>
            <div class="workspace">
            ${sidebarHtml()}
            <main class="content-panel dash">
                <div class="form-header" style="margin-bottom:10px">
                    <div>
                        <h2 style="font-size:22px;font-weight:600">Analytics dashboard</h2>
                        <div class="muted" style="font-size:14px;margin-top:3px">How request work is flowing — volumes, decisions and where it slows down. Central team view.</div>
                        ${filtersActive() ? `<div class="muted" style="font-size:13px;margin-top:6px">Filtered — ${d.reqs.length} of ${d.allReqs.length} requests match. <button class="btn-link" data-act="clear-dash-filters">Clear filters</button></div>` : ''}
                    </div>
                    <div style="display:flex;gap:8px">
                        <button class="btn btn-black btn-sm" data-act="export-pdf">⬇ Export PDF</button>
                        <button class="btn btn-outline btn-sm" data-act="items-report">📋 Created items report ›</button>
                    </div>
                </div>
                <div class="print-head">
                    <div class="ph-title">dmp — Analytics dashboard</div>
                    <div class="ph-sub">${esc(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))} · ${esc(rangeLabel)}${filtersActive() ? ` · filtered: ${d.reqs.length} of ${d.allReqs.length} requests` : ''} · Central team view</div>
                </div>
                <div class="dash-filters">
                    <span class="bab-label">Period</span>
                    <div class="mode-tabs dash-period">
                        ${[7, 14, 30, 0].map(v => `<button class="mode-tab ${S.rangeDays === v && !fy ? 'active' : ''}" data-act="range" data-v="${v}">${v ? 'Last ' + v + ' days' : 'All time'}</button>`).join('')}
                    </div>
                </div>

                <div class="dash-tiles">
                    ${tile('Open requests now', d.open.length, d.waiting.length ? 'longest waiting ' + fmtDur(d.waiting[0].ms) : '')}
                    ${tile('Completed', d.completed.length, rangeLabel)}
                    ${tile('Avg approval time', d.avgCycle ? fmtDur(d.avgCycle) : '—', 'submission → completed, ' + rangeLabel)}
                    ${tile('Rework rate', d.rework.total ? Math.round(d.rework.count / d.rework.total * 100) + '%' : '—',
                        d.rework.count + ' of ' + d.rework.total + ' requests sent back, ' + rangeLabel)}
                    ${tile('Matched Items count', d.aiMatch.exists_my_plant + d.aiMatch.exists_other_plant,
                        'of ' + d.aiMatch.rows + ' AI-analysed bulk rows')}
                </div>

                <div class="dash-grid">
                    ${card('Open requests trend', 'How many requests were open at the end of each day — a rising line means work is piling up faster than it is approved · ' + rangeLabel,
                        lineChart(d.days, [{ key: 'openN', color: '#4a3aa7', label: 'Open', fmt: (v) => v + ' open', area: true, endValue: true }],
                            (day) => `${day.openN} request${day.openN === 1 ? '' : 's'} open at end of day`,
                            { seeList: true, kind: 'backlog', wide: true }), 'dash-span2')}
                    ${card('Waiting in the queue right now', 'Open requests sitting at each approval stage',
                        queueRows.length ? hbar(queueRows, C.blue, (v) => v + ' req') : '<div class="muted">No open requests — the queue is clear.</div>')}
                    ${card('Average time spent per stage', 'From arriving at a stage to its decision · ' + rangeLabel + (slowest ? ' · slowest: ' + slowest.label : ''),
                        dwellRows.length ? hbar(dwellRows, C.orange, (v) => v < 48 ? v.toFixed(1) + ' h' : (v / 24).toFixed(1) + ' d')
                        : '<div class="muted">No decisions in this period.</div>')}
                    ${card('Cycle time trend', 'Avg end-to-end approval time per completion day — is it improving? · ' + rangeLabel,
                        d.days.some(x => x.cycleH !== null)
                            ? lineChart(d.days,
                                [{ key: 'cycleH', color: C.orange, label: 'Avg cycle', fmt: (v) => v.toFixed(1) + ' h', area: true, endValue: true }],
                                (day) => day.cycleH === null ? 'No requests completed'
                                    : `${day.cycleN} request${day.cycleN === 1 ? '' : 's'} completed · avg ${day.cycleH.toFixed(1)} h` +
                                      (day.cycleN > 1 ? ` · fastest ${fmtDur(day.cycleMin)} · slowest ${fmtDur(day.cycleMax)}` : ''),
                                { seeList: true, kind: 'cycle' })
                            : '<div class="muted">No completions in this period.</div>')}
                    ${card('Requests per day', 'Submitted vs completed · ' + rangeLabel,
                        lineChart(d.days, [{ key: 'submitted', color: C.blue, label: 'Submitted' }, { key: 'completed', color: C.aqua, label: 'Completed' }],
                            null, { seeList: true, kind: 'volume' }))}
                    ${card('Decisions by reviewer', 'Approved vs declined · ' + rangeLabel,
                        decRows.length ? `<div class="viz-legend">
                            <span class="vl-item"><span class="vl-swatch" style="background:${C.good}"></span>Approved</span>
                            <span class="vl-item"><span class="vl-swatch" style="background:${C.bad}"></span>Declined</span></div>`
                            + hbarGrouped(decRows, C.good, C.bad, 'Approved', 'Declined')
                        : '<div class="muted">No decisions in this period.</div>')}
                    ${card('Requests by type', 'Submitted · ' + rangeLabel,
                        typeRows.length ? hbar(typeRows, C.blue, (v) => String(v)) : '<div class="muted">No requests in this period.</div>')}
                    ${card('Rework generated by stage', 'Where requests get sent back for additional data · ' + rangeLabel,
                        Object.keys(d.rework.byStage).length
                            ? hbar(STAGE_ORDER.filter(st => d.rework.byStage[st]).map(st => {
                                const e = d.rework.byStage[st];
                                const list = e.reqs.slice(0, 3).join(', ') + (e.reqs.length > 3 ? ' +' + (e.reqs.length - 3) + ' more' : '');
                                return { label: st, value: e.count, sub: list,
                                    tip: `${e.count} send-back${e.count === 1 ? '' : 's'} · requests ${list}`,
                                    list: regList('Sent back at ' + st, `${e.count} send-back${e.count === 1 ? '' : 's'}`,
                                        uniq(e.items).map(r => Object.assign({}, r, { extra: 'Sent back' }))) };
                              }), C.orange, (v) => v + '×')
                            : '<div class="muted">No rework in this period — nothing was sent back.</div>')}
                    ${card('AI matching', 'Outcome of every AI-analysed bulk upload row · all time',
                        d.aiMatch.rows
                            ? hbar([
                                { label: 'Already in your plant', value: d.aiMatch.exists_my_plant, hint: 'duplicate prevented' },
                                { label: 'In another plant', value: d.aiMatch.exists_other_plant, hint: 'duplicate prevented — extension offered' },
                                { label: 'No match — new item', value: d.aiMatch.not_found, hint: 'genuinely new — creation offered' },
                                { label: 'Category missing', value: d.aiMatch.category_missing, hint: 'sent to category proposal' }
                              ].filter(r => r.value).map(r => {
                                const share = Math.round(r.value / d.aiMatch.rows * 100);
                                return { label: r.label, value: r.value, sub: share + '%',
                                    tip: `${r.value} of ${d.aiMatch.rows} analysed rows (${share}%) · ${r.hint}` };
                              }), C.blue, (v) => v + ' row' + (v === 1 ? '' : 's'))
                            : '<div class="muted">No bulk uploads analysed yet.</div>')}
                </div>

                ${card('Longest-waiting open requests', 'Right now — top 10, who is holding what',
                    d.waiting.length ? `<div class="cat-attr-wrap"><table class="data-table">
                        <thead><tr><th>Request</th><th>Type</th><th>Item</th><th>Waiting at</th><th>With</th><th>Waiting for</th></tr></thead>
                        <tbody>${d.waiting.map(w => {
                            const tc = TYPE_CHIP[w.r.type] || { label: window.Workflow.typeLabel(w.r.type), cls: '' };
                            return `<tr class="clickable" data-act="open-req" data-id="${w.r.id}">
                            <td class="it-no"># ${String(w.r.no || 0).padStart(4, '0')}</td>
                            <td><span class="type-chip ${tc.cls}">${esc(tc.label)}</span>${w.r.bulk ? '<span class="type-chip tc-bulk">Bulk</span>' : ''}</td>
                            <td style="font-weight:600">${esc(w.r.title)}</td>
                            <td>${esc(w.stage)}</td>
                            <td>${esc(w.role)}</td>
                            <td style="font-weight:600">${fmtDur(w.ms)}</td>
                        </tr>`; }).join('')}</tbody></table></div>`
                    : '<div class="muted">Nothing is waiting — all requests are resolved.</div>')}

                <div class="dash-section">
                    <div class="ds-title">Sourcing records</div>
                    <div class="ds-sub">Items requested with the sourcing tag skip mandatory technical attributes — they enter the master as incomplete records that need enrichment later.</div>
                </div>
                <div class="dash-tiles">
                    ${tile('Sourcing requests', d.src.reqs.length, rangeLabel)}
                    ${tile('Sourcing items', d.src.items, d.src.reqs.length ? srcAvg.toFixed(1) + ' items per request, ' + rangeLabel : rangeLabel)}
                    ${tile('Incomplete share', recTotal ? Math.round(d.src.items / recTotal * 100) + '%' : '—',
                        'of new items requested carry the sourcing tag, ' + rangeLabel)}
                    ${tile('Incomplete records in master', d.matSrc, 'sourcing record items, right now')}
                    ${tile('Complete records in master', d.matGold, 'golden record items, right now')}
                </div>
                <div class="dash-grid">
                    ${card('New sourcing items per day', 'Sourcing-tagged items submitted each day · ' + rangeLabel,
                        d.days.some(x => x.srcN)
                            ? lineChart(d.days, [{ key: 'srcN', color: C.aqua, label: 'Sourcing items', fmt: (v) => plural(v, 'item'), area: true, endValue: true }],
                                (day) => `${plural(day.srcN, 'sourcing item')} submitted`,
                                { seeList: true, kind: 'sourcing' })
                            : '<div class="muted">No sourcing record requests in this period.</div>')}
                    ${card('Open Sourcing Items Request Trend', 'Running total of all sourcing items ever requested — the enrichment backlog building up',
                        d.days.length && d.days[d.days.length - 1].srcCum
                            ? lineChart(d.days, [{ key: 'srcCum', color: C.orange, label: 'Total', fmt: (v) => v + ' total', area: true, endValue: true }],
                                (day) => `${plural(day.srcCum, 'sourcing item')} in total by end of day` + (day.srcN ? ` · +${day.srcN} that day` : ''),
                                { seeList: true, kind: 'sourcingCum' })
                            : '<div class="muted">No sourcing record items yet.</div>')}
                    ${card('Incomplete vs complete — new items', 'Items requested as sourcing records (incomplete) vs golden records (complete) · ' + rangeLabel,
                        recRows.length ? hbar(recRows, C.blue, (v) => plural(v, 'item'))
                        : '<div class="muted">No new-item requests in this period.</div>')}
                    ${card('Items per sourcing request', 'How many items each sourcing request carries · ' + rangeLabel,
                        perReqRows.length ? hbar(perReqRows, C.aqua, (v) => plural(v, 'item'))
                        : '<div class="muted">No sourcing record requests in this period.</div>')}
                </div>

                <div class="dash-section">
                    <div class="ds-title">Category catalog</div>
                    <div class="ds-sub">New categories proposed by requesters and reviewed by the Central team — approved requests add the category and its attributes to the catalog.</div>
                </div>
                <div class="dash-tiles">
                    ${tile('Category requests', d.cat.reqs.length, d.cat.items !== d.cat.reqs.length ? d.cat.items + ' categories proposed, ' + rangeLabel : rangeLabel)}
                    ${tile('New categories added', d.cat.added, 'approved & added to the catalog, ' + rangeLabel)}
                    ${tile('Catalog size', d.catalogNow, d.catalogFromReqs + ' of them added via requests, all time')}
                </div>
                <div class="dash-grid">
                    ${card('Category request outcomes', 'Where category proposals ended up — one bar, split by outcome · ' + rangeLabel,
                        catOutRows.length ? stackBar(catOutRows)
                        : '<div class="muted">No category requests in this period.</div>', 'dash-span2')}
                    ${card('New category requests per day', 'Category proposals submitted each day · ' + rangeLabel,
                        d.days.some(x => x.catN)
                            ? lineChart(d.days, [{ key: 'catN', color: C.blue, label: 'Requests', fmt: (v) => plural(v, 'request'), area: true, endValue: true }],
                                (day) => `${plural(day.catN, 'category request')} submitted`,
                                { seeList: true, kind: 'catreq' })
                            : '<div class="muted">No category requests in this period.</div>')}
                    ${card('Catalog growth', 'Total categories in the catalog at the end of each day',
                        lineChart(d.days, [{ key: 'catCum', color: C.aqua, label: 'Catalog', fmt: (v) => v + ' categories', area: true, endValue: true }],
                            (day) => `${day.catCum} categories in the catalog`,
                            { seeList: true, kind: 'catCum' }))}
                </div>
            </main>
            </div>
            <div id="viz-tip" class="viz-tip" hidden></div>`;

        window.UI.bindActions(root, {
            'home': () => window.UI.go('#/master'),
            'range': (t) => { S.rangeDays = Number(t.getAttribute('data-v')); S.f.frame = ''; window.Views.dashboard(); },
            'open-req': (t) => window.UI.go('#/request/' + t.getAttribute('data-id')),
            'items-report': () => window.UI.go('#/items-report'),
            'export-pdf': () => window.UI.exportPdf(root.querySelector('.content-panel'),
                'dmp_dashboard_' + new Date().toISOString().slice(0, 10) + '.pdf'),
            'clear-dash-filters': () => { S.f = EMPTY_FILTERS(); window.Views.dashboard(); },
            'toggle-sidebar': () => { S.collapsed = !S.collapsed; root.querySelector('.sidebar').classList.toggle('collapsed', S.collapsed); }
        });

        // sidebar filter bindings — every change recomputes the whole dashboard
        root.querySelector('#dash-frame').addEventListener('change', (e) => { S.f.frame = e.target.value; window.Views.dashboard(); });
        const countInput = root.querySelector('#dash-count');
        if (countInput) countInput.addEventListener('change', (e) => {
            S.f.customCount = Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1)));
            window.Views.dashboard();
        });
        const unitSelect = root.querySelector('#dash-unit');
        if (unitSelect) unitSelect.addEventListener('change', (e) => { S.f.customUnit = e.target.value; window.Views.dashboard(); });
        root.querySelector('#dash-plant').addEventListener('change', (e) => { S.f.plant = e.target.value; window.Views.dashboard(); });
        root.querySelectorAll('[data-dash-filter]').forEach(el => el.addEventListener('change', (e) => {
            const group = e.target.getAttribute('data-dash-filter');
            const i = S.f[group].indexOf(e.target.value);
            if (e.target.checked && i === -1) S.f[group].push(e.target.value);
            if (!e.target.checked && i !== -1) S.f[group].splice(i, 1);
            window.Views.dashboard();
        }));

        /* hover layer: one tooltip for bars and day-columns */
        const tip = root.querySelector('#viz-tip');
        let tipTarget = null;   // {list} or {day, kind} behind the tooltip's "See requests"
        function showTip(x, y, strong, sub, withButton) {
            tip.replaceChildren();
            const v = document.createElement('div'); v.className = 'vt-value'; v.textContent = strong;
            const l = document.createElement('div'); l.className = 'vt-label'; l.textContent = sub;
            tip.append(v, l);
            if (withButton) {
                const b = document.createElement('button'); b.className = 'vt-btn'; b.type = 'button';
                b.textContent = 'See requests ›';
                tip.append(b);
            }
            tip.classList.toggle('viz-tip-live', !!withButton);
            tip.hidden = false;
            const pad = 12;
            tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - pad, x + pad) + 'px';
            tip.style.top = Math.max(pad, y - tip.offsetHeight - pad) + 'px';
        }
        // generic request-list modal: entry = {title, sub, items:[{id,no,title,type,bulk,extra}]}
        function listModal(entry) {
            tip.hidden = true;
            const chip = (r) => {
                const tc = TYPE_CHIP[r.type] || { label: window.Workflow.typeLabel(r.type), cls: '' };
                return `<span class="type-chip ${tc.cls}">${esc(tc.label)}</span>${r.bulk ? '<span class="type-chip tc-bulk">Bulk</span>' : ''}`;
            };
            const rows = entry.items.map(r => `
                <div class="dm-row" data-req="${esc(r.id)}">
                    <span class="it-no"># ${String(r.no || 0).padStart(4, '0')}</span>
                    ${chip(r)}
                    <span class="dm-title">${esc(r.title)}</span>
                    ${r.extra ? `<span class="dm-dur">${esc(r.extra)}</span>` : ''}
                    <span class="dm-go">›</span>
                </div>`).join('');
            window.UI.openModal({
                title: entry.title,
                bodyHtml: `<div class="muted" style="margin-bottom:12px">${esc(entry.sub)} · click a request to open it</div>
                    <div class="dm-list">${rows}</div>`,
                buttons: [{ label: 'Close', cls: 'btn-outline', onClick: (o) => o.remove() }],
                onOpen: (o) => o.addEventListener('click', (e) => {
                    const r = e.target.closest('[data-req]');
                    if (r) { o.remove(); window.UI.go('#/request/' + r.getAttribute('data-req')); }
                })
            });
        }
        function dayEntry(day, kind) {
            if (kind === 'backlog') {
                return { title: 'Open requests — end of ' + day.label,
                    sub: `${day.openN} request${day.openN === 1 ? '' : 's'} open`, items: day.openReqs };
            }
            if (kind === 'sourcing') {
                return { title: 'Sourcing requests — ' + day.label,
                    sub: `${day.srcN} sourcing item${day.srcN === 1 ? '' : 's'} submitted`, items: day.srcReqs };
            }
            if (kind === 'sourcingCum') {
                return { title: 'Sourcing requests — up to ' + day.label,
                    sub: `${day.srcCum} sourcing item${day.srcCum === 1 ? '' : 's'} accumulated in total`, items: day.srcCumReqs };
            }
            if (kind === 'catreq') {
                return { title: 'Category requests — ' + day.label,
                    sub: `${day.catN} request${day.catN === 1 ? '' : 's'} submitted`, items: day.catReqs };
            }
            if (kind === 'catCum') {
                return { title: 'Categories added via requests — up to ' + day.label,
                    sub: `catalog size ${day.catCum} at end of day`, items: day.catCumReqs };
            }
            if (kind === 'volume') {
                const done = (day.doneReqs || []).slice().sort((a, b) => b.ms - a.ms)
                    .map(r => Object.assign({}, r, { extra: 'Completed · ' + fmtDur(r.ms) }));
                const sub = (day.subReqs || []).slice().sort((a, b) => (b.no || 0) - (a.no || 0))
                    .map(r => Object.assign({}, r, { extra: 'Submitted · ' + r.status }));
                return { title: 'Requests — ' + day.label,
                    sub: `${day.submitted} submitted · ${day.completed} completed`, items: done.concat(sub) };
            }
            return { title: 'Requests completed — ' + day.label,
                sub: `${day.doneReqs.length} request${day.doneReqs.length === 1 ? '' : 's'} · avg cycle ${day.cycleH.toFixed(1)} h`,
                items: day.doneReqs.slice().sort((a, b) => b.ms - a.ms).map(r => Object.assign({}, r, { extra: fmtDur(r.ms) })) };
        }
        function openTarget(t) {
            if (!t) return;
            listModal(t.list ? t.list : dayEntry(t.day, t.kind));
        }
        root.addEventListener('pointermove', (e) => {
            if (e.target.closest('#viz-tip')) return;   // keep the tooltip while hovering its button
            const row = e.target.closest('.viz-row, .viz-day');
            if (!row) { tip.hidden = true; tipTarget = null; return; }
            root.querySelectorAll('.viz-day .viz-cross, .viz-day .viz-dot').forEach(el => { el.style.opacity = 0; });
            if (row.classList.contains('viz-day')) {
                row.querySelectorAll('.viz-cross, .viz-dot').forEach(el => { el.style.opacity = 1; });
                tipTarget = row.hasAttribute('data-see')
                    ? { day: d.days[Number(row.getAttribute('data-di'))], kind: row.getAttribute('data-kind') } : null;
                showTip(e.clientX, e.clientY, row.getAttribute('data-label'), row.getAttribute('data-sub'), !!tipTarget);
            } else {
                const li = row.getAttribute('data-list');
                tipTarget = li !== null ? { list: LISTS[Number(li)] } : null;
                showTip(e.clientX, e.clientY, row.getAttribute('data-value'), row.getAttribute('data-tip') || row.getAttribute('data-label'), !!tipTarget);
            }
        });
        tip.addEventListener('click', (e) => {
            if (e.target.closest('.vt-btn')) openTarget(tipTarget);
        });
        // clicking the mark itself (day column or bar row) also opens the list
        root.addEventListener('click', (e) => {
            const day = e.target.closest('.viz-day[data-see]');
            if (day) { openTarget({ day: d.days[Number(day.getAttribute('data-di'))], kind: day.getAttribute('data-kind') }); return; }
            const bar = e.target.closest('.viz-row[data-list]');
            if (bar) openTarget({ list: LISTS[Number(bar.getAttribute('data-list'))] });
        });
        root.addEventListener('pointerleave', () => { tip.hidden = true; tipTarget = null; });
    };
})();
