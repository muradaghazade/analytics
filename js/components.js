/* ============================================================
   components.js — shared render helpers & chrome (header, toast, modal)
   ============================================================ */
(function () {

    // Sourcing module cross-link: absolute localhost port when running under the
    // dev python servers, relative sibling folder on a static host (GitHub Pages)
    window.SOURCING_URL = window.SOURCING_URL || (location.port === '8123' ? 'http://127.0.0.1:8124' : '../sourcing');

    /* ---------- tiny utils ---------- */
    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    function go(hash) { window.location.hash = hash; }
    function nowLabel(ts) {
        const d = new Date(ts);
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    // delegate helper: attach one handler, match by [data-act].
    // Replaces any handler previously attached by bindActions on this root
    // (roots persist across re-renders, so addEventListener would otherwise stack).
    function bindActions(root, map) {
        if (root.__actHandler) root.removeEventListener('click', root.__actHandler);
        const handler = e => {
            const t = e.target.closest('[data-act]');
            if (!t || !root.contains(t)) return;
            const fn = map[t.getAttribute('data-act')];
            if (fn) fn(t, e);
        };
        root.__actHandler = handler;
        root.addEventListener('click', handler);
    }

    /* ---------- dataset lookups ---------- */
    function ds() { return window.Store.get().datasets; }
    function plantName(code) { const p = ds().PLANTS.find(x => x.code === code); return p ? p.name : code; }
    function plantLabel(code) { return code + ' — ' + plantName(code); }
    function groupDesc(code) { const g = ds().MATERIAL_GROUPS.find(x => x.code === code); return g ? g.desc : ''; }
    function valuationDesc(code) { const v = ds().VALUATION_CLASSES.find(x => x.code === code); return v ? v.desc : ''; }
    function categorySchema(unspsc) { return (ds().CATEGORY_ATTRIBUTES || []).find(c => c.unspsc === unspsc) || null; }
    function abcDesc(code) { const a = (ds().ABC_CODES || []).find(x => x.code === code); return a ? a.desc : ''; }
    // storage locations belong to a plant; plants without their own list fall back to the generic one
    /* ---- supporting documents: shared list rendering ---- */
    function docKB(size) { return (size / 1024).toFixed(2) + ' KB'; }
    const DOC_CLIP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
    const DOC_TRASH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
    // read-only list (request detail / item page); pass {deletable:true} for the form
    function docListHtml(docs, opts) {
        opts = opts || {};
        if (!docs || !docs.length) return '';
        return `<div class="doc-table">
            <div class="doc-thead"><span>File</span><span>${opts.deletable ? 'Action' : ''}</span></div>
            ${docs.map((d, i) => `<div class="doc-row">
                <span class="doc-name"><span class="doc-clip">${DOC_CLIP}</span>
                    <a href="${d.data}" download="${esc(d.name)}" title="Download">${esc(d.name)} (${docKB(d.size || 0)})</a></span>
                ${opts.deletable ? `<button type="button" class="doc-del" data-doc-del="${i}" title="Remove">${DOC_TRASH}</button>` : '<span></span>'}
            </div>`).join('')}
        </div>`;
    }

    function storageOptionsFor(plant) {
        const list = (window.STORAGE_LOCATIONS_BY_PLANT || {})[String(plant || '')];
        if (list && list.length) return list.map(l => ({ value: l.code, label: l.code + ' — ' + l.name }));
        return (ds().STORAGE_LOCATIONS || []).slice();
    }

    // read-only display of the inventory-planning section (same def-grid style
    // as the Product details / Technical Details cards)
    function inventoryRows(inv) {
        if (!inv) return '<div class="muted">Inventory data not set yet.</div>';
        const rows = [
            ['Material (MMR)', inv.material],
            ['Plant', inv.plant],
            ['MRP Group', inv.mrpGroup],
            ['ABC Code', inv.abcCode ? inv.abcCode + ' — ' + abcDesc(inv.abcCode) : ''],
            ['MRP Type', inv.mrpType],
            ['Reorder point', inv.reorderPoint],
            ['Min qty', inv.mrpControllerMin],
            ['Max qty', inv.mrpControllerMax],
            ['Lot-size', inv.lotSize],
            ['Fixed lot size', inv.fixedLotSize],
            ['Procurement Type', inv.procurementType || 'F'],
            ['Planned Delivery Time (Days)', inv.plannedDeliveryDays],
            ['Safety Stock', inv.safetyStock]
        ];
        return `<div class="def-grid">${rows.map(r =>
            `<div class="def-row"><div class="def-k">${esc(r[0])}</div><div class="def-v">${esc((r[1] === undefined || r[1] === null || r[1] === '') ? '—' : r[1])}</div></div>`).join('')}</div>`;
    }

    /* ---- inventory rule: MRP type ND + lot-size EX → Min/Max levels are not
       applicable; grey them out, disable and clear them (live on change) ---- */
    function invMinMaxOff(container) {
        const g = (n) => container.querySelector(`[name="inv::${n}"]`);
        const mt = g('mrpType'), ls = g('lotSize');
        return !!(mt && ls && mt.value === 'ND' && ls.value === 'EX');
    }
    function bindInvMinMaxRule(container) {
        const apply = () => {
            const off = invMinMaxOff(container);
            ['mrpControllerMin', 'mrpControllerMax'].forEach(n => {
                const el = container.querySelector(`[name="inv::${n}"]`);
                if (!el) return;
                el.disabled = off;
                if (off) { el.value = ''; el.classList.remove('error'); }
                const field = el.closest('.field');
                if (field) {
                    field.classList.toggle('field-disabled', off);
                    // the mandatory mark goes away while the field is not applicable
                    const lab = field.querySelector('label');
                    if (lab) {
                        lab.classList.toggle('req-label', !off);
                        const star = lab.querySelector('.req');
                        if (star) star.style.display = off ? 'none' : '';
                    }
                    const hint = field.querySelector('.hint');
                    if (hint) hint.textContent = off ? 'Not applicable — MRP type ND with lot-size EX' : 'Numeric';
                    const err = field.querySelector('.field-error');
                    if (err && off) err.textContent = '';
                }
            });
        };
        container.addEventListener('change', (e) => {
            if (e.target.name === 'inv::mrpType' || e.target.name === 'inv::lotSize') apply();
        });
        apply();
    }

    /* ---------- toast ---------- */
    function toast(opts) {
        if (typeof opts === 'string') opts = { body: opts };
        const root = document.getElementById('toast-root');
        const el = document.createElement('div');
        el.className = 'toast ' + (opts.kind || '');
        el.innerHTML = (opts.title ? `<div class="toast-title">${esc(opts.title)}</div>` : '') +
            `<div>${esc(opts.body)}</div>`;
        root.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, opts.duration || 4200);
    }

    /* ---------- modal ---------- */
    function openModal(opts) {
        const root = document.getElementById('modal-root');
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal${opts.wide ? ' modal-wide' : ''}">
                <div class="modal-head">${esc(opts.title || '')}</div>
                <div class="modal-body">${opts.bodyHtml || ''}</div>
                <div class="modal-foot" id="modal-foot"></div>
            </div>`;
        root.appendChild(overlay);
        const foot = overlay.querySelector('#modal-foot');
        (opts.buttons || []).forEach(b => {
            const btn = document.createElement('button');
            btn.className = 'btn ' + (b.cls || 'btn-outline');
            btn.textContent = b.label;
            btn.onclick = () => { if (b.onClick) b.onClick(overlay); };
            foot.appendChild(btn);
        });
        overlay.addEventListener('click', e => { if (e.target === overlay && opts.dismissable !== false) close(); });
        function close() { overlay.remove(); }
        if (opts.onOpen) opts.onOpen(overlay);
        return { overlay, close };
    }
    function closeModals() { document.getElementById('modal-root').innerHTML = ''; }

    /* ---------- workspaces ----------
       'standard' is the full Demand Planning; 'socar' is the SOCAR variant with
       NO shopping-cart functionality. The only way in or out is the nav drawer. */
    function isSocar() {
        return (window.Store.session().workspace || 'standard') === 'socar';
    }
    function setWorkspace(ws) {
        if ((window.Store.session().workspace || 'standard') === ws) return;
        window.Store.set(s => { s.session.workspace = ws; });
        toast({ title: ws === 'socar' ? 'SOCAR Demand Planning' : 'Demand Planning',
            body: ws === 'socar' ? 'You are now in the SOCAR workspace — shopping-cart functionality is not available here.'
                                 : 'You are back in the standard workspace.' });
        if (window.location.hash === '#/master') window.Router.render();
        else go('#/master');
        renderHeader();
    }

    /* ---------- shopping cart (Sourcing handoff) ---------- */
    function cartCount() {
        return (window.Store.get().cart || []).length;
    }
    function addToCart(materialId) {
        // the SOCAR workspace has no cart at all — refuse even programmatic adds
        if (isSocar()) {
            toast({ title: 'Not available', body: 'The shopping cart is not available in SOCAR Demand Planning.', kind: 'danger' });
            return;
        }
        const m = window.Store.materialById(materialId);
        if (!m) return;
        let bumped = false;
        window.Store.set(s => {
            if (!Array.isArray(s.cart)) s.cart = [];
            const hit = s.cart.find(c => c.materialId === materialId);
            if (hit) { hit.qty = (Number(hit.qty) || 1) + 1; bumped = true; }
            else s.cart.push({ materialId, qty: 1, addedTs: Date.now() });
        });
        toast({ title: bumped ? 'Quantity increased' : 'Added to cart', body: (m.shortName || m.name) + (bumped ? ' — quantity +1.' : ' is now in the shopping cart.') });
        renderHeader();   // refresh the cart badge immediately
    }

    /* ---------- header ---------- */
    function inboxCountFor(role) {
        return window.Store.requests().filter(r => window.Workflow.isAwaiting(r, role)).length;
    }
    // Requester attention count: declined requests + own requests waiting for
    // the requester's approval (valuation class sign-off)
    function requesterCount(s) {
        return window.Store.requests().filter(r => r.requesterUser === s.currentUser &&
            (r.status === 'Declined' || window.Workflow.isAwaiting(r, 'Requester'))).length;
    }
    // notifications addressed to a specific role are only shown while acting as it
    function visibleNotifications() {
        const role = window.Store.session().currentRole;
        return window.Store.notifications().filter(n => !n.forRole || n.forRole === role);
    }
    function renderHeader() {
        const s = window.Store.session();
        const roles = ds().ROLES;
        const unread = visibleNotifications().filter(n => !n.read).length;
        const myCount = s.currentRole === 'Requester'
            ? requesterCount(s)
            : inboxCountFor(s.currentRole);

        const header = document.getElementById('app-header');
        header.innerHTML = `
            <div class="header-left">
                <button class="menu-toggle" data-act="nav-drawer" title="Menu">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
                <div class="logo-area" data-act="home">
                    <img class="logo-img" src="img/logo.svg" alt="dmp — Digital Material Purchasing">
                    <div class="divider"></div>
                    <div class="app-title">${isSocar() ? 'SOCAR DEMAND PLANNING' : 'DEMAND PLANNING'}</div>
                </div>
            </div>
            <div class="header-right">
                <div class="lang-switcher">
                    <button class="lang-switch-btn" data-act="lang-toggle" title="Language / Dil">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                        <span class="lang-label">${(s.lang || 'en').toUpperCase()}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <div class="lang-menu" id="lang-menu">
                        <div class="lang-menu-item ${(s.lang || 'en') === 'en' ? 'active' : ''}" data-act="lang-pick" data-lang="en"><span>EN</span><span class="lang-name">English</span></div>
                        <div class="lang-menu-item ${s.lang === 'az' ? 'active' : ''}" data-act="lang-pick" data-lang="az"><span>AZ</span><span class="lang-name">Azərbaycan dili</span></div>
                    </div>
                </div>
                <div class="role-switcher">
                    <button class="role-switcher-btn" data-act="role-toggle">
                        <span class="role-dot"></span>
                        <span>Acting as <span class="role-label">${esc(s.currentRole)}</span></span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <div class="role-menu" id="role-menu">
                        <div class="role-menu-head">Switch role (demo)</div>
                        ${roles.map(r => {
                            const c = r === 'Requester' ? requesterCount(s) : inboxCountFor(r);
                            return `<div class="role-menu-item ${r === s.currentRole ? 'active' : ''}" data-act="role-pick" data-role="${esc(r)}">
                                <span>${esc(r)}</span>${c ? `<span class="badge">${c}</span>` : ''}</div>`;
                        }).join('')}
                        <div class="role-menu-head" style="border-top:1px solid var(--border-soft);border-bottom:none">Demo</div>
                        <div class="role-menu-item" data-act="reset-demo"><span>↻ Reset demo data</span></div>
                    </div>
                </div>
                <button class="icon-btn" data-act="inbox">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                    <span>Inbox</span>
                    ${myCount ? `<span class="count-badge">${myCount}</span>` : ''}
                </button>
                ${isSocar() ? '' : `<button class="icon-btn" data-act="cart">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                    <span>Shopping cart</span>
                    ${cartCount() ? `<span class="count-badge">${cartCount()}</span>` : ''}
                </button>`}
                <button class="icon-btn" data-act="notif">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    <span>Notifications</span>
                    ${unread ? `<span class="count-badge">${unread}</span>` : ''}
                </button>
                <div class="user-profile">
                    <div class="user-avatar"></div>
                    <div class="user-info">
                        <div class="user-name">${esc(s.currentUser)}</div>
                        <div class="user-company">${esc(s.company)} · Plant ${esc(s.plant)}</div>
                    </div>
                </div>
            </div>`;

        bindActions(header, {
            // the dmp logo leads to the platform landing page — /main under the dev
            // server, the parent folder on the static/Pages build
            'home': () => { window.location.href = location.port === '8123' ? '/main' : '../'; },
            'inbox': () => go('#/inbox'),
            'cart': () => go('#/cart'),
            'nav-drawer': () => openNavDrawer(),
            'role-toggle': () => document.getElementById('role-menu').classList.toggle('open'),
            'role-pick': (t) => {
                document.getElementById('role-menu').classList.remove('open');
                window.Store.setRole(t.getAttribute('data-role'));
                // re-render the current page in place so role-specific actions
                // (e.g. Central team blocks on the item page) appear immediately
                window.Router.render();
            },
            'notif': () => toggleNotifPanel(),
            'lang-toggle': () => document.getElementById('lang-menu').classList.toggle('open'),
            'lang-pick': (t) => {
                document.getElementById('lang-menu').classList.remove('open');
                if (window.I18N) window.I18N.setLang(t.getAttribute('data-lang'));
            },
            'reset-demo': () => {
                document.getElementById('role-menu').classList.remove('open');
                window.Store.reset();
                toast({ title: 'Demo reset', body: 'All requests cleared and material master re-seeded.' });
                go('#/master');
            }
        });
        // close menus on outside click (single persistent listener)
        if (!document.__menuCloseBound) {
            document.__menuCloseBound = true;
            document.addEventListener('click', outsideClose);
        }
    }
    function outsideClose(e) {
        if (!e.target.closest('.role-switcher')) { const m = document.getElementById('role-menu'); if (m) m.classList.remove('open'); }
        if (!e.target.closest('.lang-switcher')) { const lm = document.getElementById('lang-menu'); if (lm) lm.classList.remove('open'); }
        if (!e.target.closest('.notif-panel') && !e.target.closest('[data-act="notif"]')) { const p = document.getElementById('notif-panel'); if (p) p.classList.remove('open'); }
    }

    function toggleNotifPanel() {
        const panel = document.getElementById('notif-panel');
        const open = panel.classList.contains('open');
        if (open) { panel.classList.remove('open'); return; }
        const notifs = visibleNotifications();
        panel.innerHTML = `
            <div class="notif-head"><span>Notifications</span>
                <button class="btn-link" data-act="mark-read">Mark all read</button></div>
            ${notifs.length ? notifs.map(n => `
                <div class="notif-item ${n.read ? '' : 'unread'}">
                    <span class="n-dot" style="${n.read ? 'background:#ccc' : ''}"></span>
                    <div><div style="font-weight:600">${esc(n.title || '')}</div>
                    <div>${esc(n.body || '')}</div>
                    <div class="n-time">${nowLabel(n.ts)}</div></div>
                </div>`).join('') : `<div class="empty-state">No notifications</div>`}`;
        panel.classList.add('open');
        bindActions(panel, { 'mark-read': () => { window.Store.markAllNotificationsRead(); toggleNotifPanel(); toggleNotifPanel(); } });
        setTimeout(() => document.addEventListener('click', outsideClose, { once: true }), 0);
    }

    /* ---------- navigation drawer (burger menu) ---------- */
    function openNavDrawer() {
        const root = document.getElementById('drawer-root');
        if (!root) return;
        const s = window.Store.session();
        const isCentral = s.currentRole === 'Central team';
        const ic = {
            list: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
            inbox: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
            grid: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
            factory: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>`,
            upload: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
            users: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
            chart: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
        };
        const link = (hash, icon, label) => `<div class="drawer-link" data-go="${hash}">${icon}<span>${esc(label)}</span></div>`;
        root.innerHTML = `
            <div class="drawer-backdrop" data-close="1"></div>
            <aside class="nav-drawer">
                <div class="drawer-head">
                    <img class="logo-img" src="img/logo.svg" alt="dmp">
                    <button class="drawer-close" data-close="1">✕</button>
                </div>
                <div class="drawer-section">Navigation</div>
                ${link('#/master', ic.list, 'Material Master')}
                ${link('#/inbox', ic.inbox, s.currentRole === 'Requester' ? 'My Requests' : 'Inbox')}
                ${link('#/bulk', ic.upload, 'Bulk upload')}
                ${isSocar() ? '' : link('#/cart', `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`, 'Shopping cart')}
                <div class="drawer-section">Modules</div>
                <div class="drawer-link ${isSocar() ? '' : 'drawer-link-active'}" data-ws="standard">${ic.chart}<span>Demand Planning</span></div>
                <div class="drawer-link ${isSocar() ? 'drawer-link-active' : ''}" data-ws="socar">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>
                    <span>SOCAR Demand Planning</span></div>
                <div class="drawer-link" data-href="${esc(window.SOURCING_URL || 'http://127.0.0.1:8124')}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                    <span>Sourcing</span></div>
                ${isCentral ? `
                    <div class="drawer-section">Administration <span class="drawer-role-chip">Central team</span></div>
                    ${link('#/dashboard', ic.chart, 'Analytics dashboard')}
                    ${link('#/sap', `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h10"/><circle cx="19" cy="17" r="2.6"/></svg>`, 'SAP integration')}
                    ${link('#/categories', ic.grid, 'Category catalog')}
                    ${link('#/manufacturers', ic.factory, 'Manufacturers')}
                    ${link('#/users', ic.users, 'User management')}
                ` : ''}
                <div class="drawer-foot">Acting as <strong>${esc(s.currentRole)}</strong> · ${esc(s.currentUser)}</div>
            </aside>`;
        const close = () => { root.innerHTML = ''; };
        root.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
        root.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => {
            const h = el.getAttribute('data-go');
            close();
            if (window.location.hash === h) window.Router.render(); else go(h);
        }));
        // workspace switch (Demand Planning ↔ SOCAR Demand Planning)
        root.querySelectorAll('[data-ws]').forEach(el => el.addEventListener('click', () => {
            const ws = el.getAttribute('data-ws');
            close();
            setWorkspace(ws);
        }));
        root.querySelectorAll('[data-href]').forEach(el => el.addEventListener('click', () => {
            window.location.href = el.getAttribute('data-href');
        }));
    }

    /* ---------- form field builders ---------- */
    function field(opts) {
        // opts: {label, name, value, type:'text|textarea|select|radio', options, required, readonly, aiFilled, hint, span, error}
        const req = opts.required ? '<span class="req">*</span>' : '';
        const spanCls = opts.span ? ('col-span-' + opts.span) : '';
        let control = '';
        const cls = (opts.aiFilled ? 'ai-filled ' : '') + (opts.error ? 'error ' : '');
        const ro = opts.readonly ? 'readonly' : '';
        const name = opts.name;
        if (opts.type === 'select' && opts.search) {
            control = searchSelectHtml({ name, value: opts.value, options: opts.options, placeholder: opts.placeholder, cls });
        } else if (opts.type === 'textarea') {
            control = `<textarea class="form-textarea ${cls}" name="${name}" ${ro} placeholder="${esc(opts.placeholder || '')}">${esc(opts.value || '')}</textarea>`;
        } else if (opts.type === 'select') {
            const opts2 = (opts.options || []).map(o => {
                let val, lab;
                if (typeof o === 'string') { val = o; lab = o; }
                else if (o.value !== undefined) { val = o.value; lab = o.label; }
                else if (o.code !== undefined) { val = o.code; lab = o.code + ' — ' + o.desc; }
                else { val = o; lab = o; }
                return `<option value="${esc(val)}" ${String(opts.value) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`;
            }).join('');
            control = `<select class="form-select ${cls}" name="${name}" ${opts.disabled ? 'disabled' : ''}${opts.creatable ? ` data-ss-create="${esc(opts.creatable)}"` : ''}>
                <option value="">${esc(opts.placeholder || 'Select…')}</option>${opts2}</select>`;
        } else if (opts.type === 'radio') {
            control = `<div class="radio-row">${(opts.options || []).map(o => {
                const val = typeof o === 'string' ? o : o.value;
                const lab = typeof o === 'string' ? o : o.label;
                return `<label><input type="radio" name="${name}" value="${esc(val)}" ${String(opts.value) === String(val) ? 'checked' : ''}> ${esc(lab)}</label>`;
            }).join('')}</div>`;
        } else {
            control = `<input class="form-input ${cls}" type="text" name="${name}" value="${esc(opts.value || '')}" ${ro} placeholder="${esc(opts.placeholder || '')}">`;
        }
        return `<div class="field ${spanCls}">
            <label class="${opts.required ? 'req-label' : ''}">${esc(opts.label)}${req}</label>
            ${control}
            ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}
            <div class="field-error" data-err="${name}">${opts.error ? esc(opts.error) : ''}</div>
        </div>`;
    }

    /* ---------- read-only key/value grid ---------- */
    function techGrid(attrs) {
        const entries = Object.entries(attrs || {});
        if (!entries.length) return '<div class="muted">No attributes.</div>';
        return `<div class="tech-grid">${entries.map(([k, v]) =>
            `<div class="tech-row"><span class="tk">${esc(k)}</span><span class="tv">${esc(v)}</span></div>`).join('')}</div>`;
    }

    /* ---------- workflow tracker ---------- */
    function workflowTracker(req) {
        const stages = window.Workflow.stagesFor(req);
        const idx = req.currentStageIndex;
        const declined = req.status === 'Declined';
        const submitted = req.status !== 'Draft';
        // step 0 (always first): the request being created by its requester
        const createdCls = submitted ? 'done' : 'current';
        const created = `<div class="wf-node"><div class="wf-dot ${createdCls}">${submitted ? '✓' : 1}</div>
            <div class="wf-label">Request created<span class="wf-who">${esc(req.requesterUser)}</span></div></div>
            <div class="wf-connector ${submitted ? 'done' : ''}"></div>`;
        return `<div class="wf-tracker">${created}${stages.map((st, i) => {
            let dotCls = '', label = st.label;
            if (declined && i === idx) dotCls = 'declined';
            else if (i < idx || req.status === 'Completed') dotCls = 'done';
            else if (i === idx) dotCls = 'current';
            const inner = dotCls === 'done' ? '✓' : (dotCls === 'declined' ? '✕' : (i + 2));
            const conn = i < stages.length - 1 ? `<div class="wf-connector ${i < idx || req.status === 'Completed' ? 'done' : ''}"></div>` : '';
            return `<div class="wf-node"><div class="wf-dot ${dotCls}">${inner}</div><div class="wf-label">${esc(label)}</div></div>${conn}`;
        }).join('')}</div>`;
    }

    /* ---------- per-plant inventory data ----------
       Inventory planning lives per plant: m.inventoryByPlant = { plant: {...} }.
       invFor reads one plant's data (with a fallback for records still carrying
       the legacy single m.inventory object); setInv writes one plant's data and
       migrates the legacy object on first write. */
    function invFor(m, plant) {
        if (!m) return null;
        if (m.inventoryByPlant) return m.inventoryByPlant[plant] || null;
        if (m.inventory) {
            const p = m.inventory.plant || (m.plants || [])[0];
            return (!plant || String(p) === String(plant)) ? m.inventory : null;
        }
        return null;
    }
    function setInv(m, plant, data) {
        if (!m) return null;
        if (!plant) plant = (m.plants || [])[0] || '';
        m.inventoryByPlant = m.inventoryByPlant || {};
        if (m.inventory) {
            const lp = m.inventory.plant || (m.plants || [])[0] || '';
            if (lp && !m.inventoryByPlant[lp]) m.inventoryByPlant[lp] = m.inventory;
            delete m.inventory;
        }
        m.inventoryByPlant[plant] = Object.assign({}, data, { plant });
        return m.inventoryByPlant[plant];
    }

    /* ---------- mandatory-comment quality gate ----------
       A decline / return / disagree comment must read like a real sentence,
       not a token typed to pass validation. Heuristic (works for EN and AZ):
       ≥ 3 words, ≥ 15 characters, at least one word of 4+ letters, and not
       one word repeated. No capital-letter or punctuation demands — reviewers
       should not fight the form. */
    const AZ_LETTERS = 'A-Za-zƏəĞğİıÖöÜüÇçŞş';
    function isSentence(text) {
        const t = String(text || '').trim();
        if (t.length < 15) return false;
        const words = t.split(/\s+/).filter(w => new RegExp('[' + AZ_LETTERS + '0-9]').test(w));
        if (words.length < 3) return false;
        if (!words.some(w => w.replace(new RegExp('[^' + AZ_LETTERS + ']', 'g'), '').length >= 4)) return false;
        if (new Set(words.map(w => w.toLowerCase())).size === 1) return false;
        return true;
    }

    /* ---------- workflow tracker for v2 bulk requests ----------
       Lines own their stages, so the request-level tracker aggregates them:
       the ordered union of the line chains, with per-stage progress counts.
       A stage is "current" while any active line sits at it, "done" once every
       line has either passed it or reached a final disposition. */
    function bulkTracker(req) {
        const BF = window.BulkFlow;
        const lines = req.lines || [];
        if (!BF || !lines.length) return '';
        // ordered union of stage keys (budget/technical are conditional per line)
        let base = [];
        lines.forEach(l => { if ((l.stages || []).length > base.length) base = l.stages; });
        const keys = base.map(s => s.key);
        lines.forEach(l => (l.stages || []).forEach((s, i) => {
            if (keys.indexOf(s.key) === -1) {
                const prev = i > 0 ? keys.indexOf(l.stages[i - 1].key) : -1;
                keys.splice(prev + 1, 0, s.key);
            }
        }));
        const meta = {};
        lines.forEach(l => (l.stages || []).forEach(s => { if (!meta[s.key]) meta[s.key] = s; }));
        const created = `<div class="wf-node"><div class="wf-dot done">✓</div>
            <div class="wf-label">Request created<span class="wf-who">${esc(req.requesterUser)}</span></div></div>
            <div class="wf-connector done"></div>`;
        const nodes = keys.map((k, i) => {
            const rel = lines.filter(l => (l.stages || []).some(s => s.key === k));
            const stOf = (l) => (l.stages || []).find(s => s.key === k) || {};
            const doneN = rel.filter(l => l.status === 'Completed' || stOf(l).done).length;
            const atN = rel.filter(l => !BF.lineFinal(l) && (BF.currentStage(l) || {}).key === k).length;
            const allSettled = rel.every(l => BF.lineFinal(l) || stOf(l).done);
            let cls = '';
            if (atN) cls = 'current';
            else if (allSettled && doneN) cls = 'done';
            const st = meta[k];
            const conn = i < keys.length - 1 ? `<div class="wf-connector ${cls === 'done' ? 'done' : ''}"></div>` : '';
            return `<div class="wf-node"><div class="wf-dot ${cls}">${cls === 'done' ? '✓' : i + 2}</div>
                <div class="wf-label">${esc(st.label)}
                    ${st.role ? `<span class="wf-who">${esc(st.role)}</span>` : ''}
                    <span class="wf-who" style="color:#888">${doneN} / ${rel.length} lines</span>
                    ${atN ? `<span class="wf-who">${atN} at this stage</span>` : ''}
                </div></div>${conn}`;
        }).join('');
        return `<div class="wf-tracker">${created}${nodes}</div>`;
    }

    /* ---------- history timeline ---------- */
    function historyList(req) {
        if (!req.history || !req.history.length) return '<div class="muted">No activity yet.</div>';
        return `<div class="history-list">${req.history.map(h => {
            const color = h.action === 'declined' ? 'var(--danger)' : (h.action === 'submitted' ? '#888' : 'var(--primary-green)');
            return `<div class="history-item"><span class="h-dot" style="background:${color}"></span>
                <div class="h-body"><strong>${esc(h.actorRole || '')}</strong> — ${esc(h.text)}
                ${h.comment ? `<div style="margin-top:3px">“${esc(h.comment)}”</div>` : ''}
                <div class="h-meta">${esc(h.actorUser || '')} · ${nowLabel(h.ts)}</div></div></div>`;
        }).join('')}</div>`;
    }

    /* ---------- searchable custom dropdown (replaces native <select>) ----------
       Renders a button + panel with a search bar; the value lives in a hidden
       input carrying the field name, so FormData/collect() and change listeners
       keep working exactly like with a native select. */
    function ssNormOptions(options) {
        return (options || []).map(o => {
            if (typeof o === 'string') return { v: o, l: o };
            if (o && o.value !== undefined) return { v: o.value, l: o.label };
            if (o && o.code !== undefined) return { v: o.code, l: o.code + ' — ' + o.desc };
            return { v: String(o), l: String(o) };
        });
    }

    function searchSelectHtml(opts) {
        // opts: {name, value, options, placeholder, cls}
        const norm = ssNormOptions(opts.options);
        const val = (opts.value === undefined || opts.value === null) ? '' : String(opts.value);
        const sel = norm.find(o => String(o.v) === val && val !== '');
        const ph = opts.placeholder || 'Select…';
        return `<div class="search-select">
            <input type="hidden" name="${opts.name}" value="${esc(val)}">
            <button type="button" class="form-select ss-toggle ${opts.cls || ''}">
                <span class="ss-label ${sel ? '' : 'ss-placeholder'}">${esc(sel ? sel.l : ph)}</span>
                <svg class="ss-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="ss-menu">
                <div class="ss-search"><input type="text" class="form-input ss-filter" placeholder="Search…"></div>
                <div class="ss-options">
                    <div class="ss-option ss-clear" data-value="">${esc(ph)}</div>
                    ${norm.map(o => `<div class="ss-option ${String(o.v) === val && val !== '' ? 'selected' : ''}" data-value="${esc(o.v)}">${esc(o.l)}</div>`).join('')}
                    <div class="ss-empty hidden">No matches</div>
                </div>
            </div>
        </div>`;
    }

    function ssCloseAll(except) {
        document.querySelectorAll('.search-select.open').forEach(w => {
            if (w === except) return;
            w.classList.remove('open');
            const m = w.querySelector('.ss-menu');
            if (m) m.style.cssText = '';   // drop any fixed positioning from sidebar mode
        });
    }
    // inside a scroll box (sticky sidebar, scrollable tables) an absolutely-
    // positioned menu gets clipped — reposition it as FIXED so it floats
    // above, flipping upwards when there is no room below
    function ssPlaceMenu(wrap) {
        const menu = wrap.querySelector('.ss-menu');
        if (!menu || !wrap.closest('.sidebar, .cat-attr-wrap')) return;
        const toggle = wrap.querySelector('.ss-toggle');
        const r = toggle.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = r.left + 'px';
        menu.style.right = 'auto';
        menu.style.width = r.width + 'px';
        menu.style.minWidth = r.width + 'px';   // the stylesheet's 100% would span the viewport once fixed
        menu.style.maxWidth = r.width + 'px';
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.bottom = 'auto';
        const vh = window.innerHeight || document.documentElement.clientHeight;
        if (vh) {
            const mh = menu.offsetHeight;
            if (r.bottom + 4 + mh > vh - 8 && r.top - mh - 4 > 8) {
                menu.style.top = (r.top - mh - 4) + 'px';   // flip above the toggle
            }
        }
    }
    function ssFilter(wrap, q) {
        q = (q || '').trim();
        const ql = q.toLowerCase();
        let any = false, exact = false;
        wrap.querySelectorAll('.ss-option').forEach(o => {
            const t = o.textContent.trim().toLowerCase();
            const show = !ql || t.indexOf(ql) !== -1 || o.classList.contains('ss-clear');
            o.classList.toggle('hidden', !show);
            if (show && !o.classList.contains('ss-clear')) any = true;
            if (t === ql && !o.classList.contains('ss-clear')) exact = true;
        });
        // creatable dropdowns: typing a value not in the list offers to add it
        const create = wrap.querySelector('.ss-create');
        let creating = false;
        if (create) {
            creating = !!ql && !exact;
            create.classList.toggle('hidden', !creating);
            if (creating) {
                create.setAttribute('data-q', q);
                create.textContent = '';
                const plus = document.createElement('span'); plus.className = 'ss-create-plus'; plus.textContent = '+';
                create.appendChild(plus);
                create.appendChild(document.createTextNode(' Add “' + q + '”'));
            }
        }
        const empty = wrap.querySelector('.ss-empty');
        if (empty) empty.classList.toggle('hidden', any || creating);
    }
    function ssPick(wrap, option) {
        const hidden = wrap.querySelector('input[type="hidden"], select.ss-hidden-native');
        const value = option.getAttribute('data-value') || '';
        const label = wrap.querySelector('.ss-label');
        const isClear = option.classList.contains('ss-clear');
        label.textContent = option.textContent.trim();
        label.classList.toggle('ss-placeholder', isClear);
        wrap.querySelectorAll('.ss-option').forEach(o => o.classList.toggle('selected', o === option && !isClear));
        wrap.classList.remove('open');
        const menuEl = wrap.querySelector('.ss-menu');
        if (menuEl) menuEl.style.cssText = '';
        if (hidden.value !== value) {
            hidden.value = value;
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /* ---- global progressive enhancement: every native <select> in the app is
       wrapped into the custom dropdown. More than 6 real options → a search bar
       is included; 6 or fewer → plain custom dropdown. The native select stays
       (hidden) as the source of truth, so FormData, [name=]/#id lookups, change
       listeners and validation error classes all keep working untouched. ---- */
    function ssSyncFromNative(wrap) {
        const sel = wrap.querySelector('select.ss-hidden-native');
        if (!sel) return;
        const cur = sel.options[sel.selectedIndex];
        const isPh = !cur || (cur.value || '').trim() === '';
        const label = wrap.querySelector('.ss-label');
        label.textContent = (cur ? cur.textContent : 'Select…').trim();
        label.classList.toggle('ss-placeholder', isPh);
        wrap.querySelectorAll('.ss-option').forEach(o =>
            o.classList.toggle('selected', !isPh && o.getAttribute('data-value') === sel.value && !o.classList.contains('ss-clear')));
    }

    function enhanceSelect(sel) {
        if (sel.__ssWrapped || sel.classList.contains('ss-hidden-native')) return;
        if (sel.hasAttribute('multiple') || sel.classList.contains('no-ss') || sel.disabled) return;
        sel.__ssWrapped = true;
        const wrap = document.createElement('div');
        wrap.className = 'search-select';
        sel.parentNode.insertBefore(wrap, sel);
        wrap.appendChild(sel);
        const baseCls = sel.className;
        sel.classList.add('ss-hidden-native');
        sel.setAttribute('tabindex', '-1');

        const opts = Array.from(sel.options);
        const real = opts.filter(o => (o.value || '').trim() !== '');
        const creatable = sel.hasAttribute('data-ss-create');
        const searchable = real.length > 6 || creatable;   // creating needs the search box to type into

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = (baseCls + ' ss-toggle').trim();
        toggle.innerHTML = `<span class="ss-label"></span>
            <svg class="ss-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
        const menu = document.createElement('div');
        menu.className = 'ss-menu';
        menu.innerHTML =
            (searchable ? `<div class="ss-search"><input type="text" class="form-input ss-filter" placeholder="Search…"></div>` : '') +
            `<div class="ss-options">` +
            opts.map(o => {
                const v = (o.value || '');
                const isPh = v.trim() === '';
                return `<div class="ss-option ${isPh ? 'ss-clear' : ''}" data-value="${esc(v)}">${esc(o.textContent.trim())}</div>`;
            }).join('') +
            `<div class="ss-empty hidden">No matches</div>` +
            (creatable ? `<div class="ss-create hidden"></div>` : '') +
            `</div>`;
        wrap.appendChild(toggle);
        wrap.appendChild(menu);
        ssSyncFromNative(wrap);
    }

    /* ---- creatable dropdowns: add a missing value to master data from the menu ----
       The native select carries data-ss-create="<kind>"; each kind knows how to
       persist the new value (and returns the canonical name, deduped). */
    function addManufacturer(name) {
        name = String(name || '').trim();
        if (!name) return '';
        const hit = (ds().MANUFACTURERS || []).find(m => m.name.toLowerCase() === name.toLowerCase());
        if (hit) return hit.name;
        window.Store.set(s => {
            s.datasets.MANUFACTURERS.push({ name, country: '' });
            if (Array.isArray(s.deletedManufacturers)) s.deletedManufacturers = s.deletedManufacturers.filter(n => n.toLowerCase() !== name.toLowerCase());
        });
        toast({ title: 'Manufacturer added', body: `“${name}” is now in the manufacturer master data.` });
        return name;
    }
    const ssCreators = { manufacturer: addManufacturer };

    // make sure the native select AND its enhanced menu contain an option for value
    function ssEnsureOption(sel, value) {
        if (!sel || sel.tagName !== 'SELECT' || !value) return;
        if (![...sel.options].some(o => o.value === value)) {
            const opt = document.createElement('option');
            opt.value = value; opt.textContent = value;
            sel.appendChild(opt);
        }
        const wrap = sel.closest('.search-select');
        if (wrap && ![...wrap.querySelectorAll('.ss-option')].some(o => o.getAttribute('data-value') === value)) {
            const row = document.createElement('div');
            row.className = 'ss-option';
            row.setAttribute('data-value', value);
            row.textContent = value;
            const box = wrap.querySelector('.ss-options');
            box.insertBefore(row, wrap.querySelector('.ss-empty'));
        }
    }

    function ssCreate(wrap) {
        const create = wrap.querySelector('.ss-create');
        const sel = wrap.querySelector('select.ss-hidden-native');
        if (!create || !sel) return;
        const fn = ssCreators[sel.getAttribute('data-ss-create')];
        const q = (create.getAttribute('data-q') || '').trim();
        if (!fn || !q) return;
        const value = fn(q);
        if (!value) return;
        ssEnsureOption(sel, value);
        const row = [...wrap.querySelectorAll('.ss-option')].find(o => o.getAttribute('data-value') === value);
        if (row) ssPick(wrap, row);
    }

    let __ssScanQueued = false;
    function ssScan() {
        if (__ssScanQueued) return;
        __ssScanQueued = true;
        setTimeout(() => {
            __ssScanQueued = false;
            document.querySelectorAll('select').forEach(enhanceSelect);
        }, 0);
    }
    if (typeof MutationObserver !== 'undefined' && document.body) {
        new MutationObserver(ssScan).observe(document.body, { childList: true, subtree: true });
        ssScan();
    }
    if (!document.__ssBound) {
        document.__ssBound = true;
        document.addEventListener('click', (e) => {
            const toggle = e.target.closest('.ss-toggle');
            if (toggle) {
                const wrap = toggle.closest('.search-select');
                const willOpen = !wrap.classList.contains('open');
                ssCloseAll(null);
                if (willOpen) {
                    ssSyncFromNative(wrap);
                    wrap.classList.add('open');
                    ssPlaceMenu(wrap);
                    const f = wrap.querySelector('.ss-filter');
                    if (f) { f.value = ''; ssFilter(wrap, ''); setTimeout(() => f.focus(), 0); }
                }
                return;
            }
            const createEl = e.target.closest('.ss-create');
            if (createEl) { ssCreate(createEl.closest('.search-select')); return; }
            const option = e.target.closest('.ss-option');
            if (option) { ssPick(option.closest('.search-select'), option); return; }
            if (!e.target.closest('.search-select')) ssCloseAll(null);
        });
        // a fixed-positioned sidebar menu must not drift from its toggle —
        // close open menus on any scroll except scrolling the option list itself
        document.addEventListener('scroll', (e) => {
            if (e.target && e.target.closest && e.target.closest('.ss-menu')) return;
            const open = document.querySelector('.search-select.open .ss-menu[style]');
            if (open) ssCloseAll(null);
        }, true);
        document.addEventListener('input', (e) => {
            if (e.target.classList && e.target.classList.contains('ss-filter')) {
                ssFilter(e.target.closest('.search-select'), e.target.value);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { ssCloseAll(null); return; }
            if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('ss-filter')) {
                e.preventDefault();
                const wrap = e.target.closest('.search-select');
                const first = wrap.querySelector('.ss-option:not(.hidden):not(.ss-clear)');
                if (first) { ssPick(wrap, first); return; }
                // nothing matched but the dropdown is creatable → Enter adds the typed value
                const create = wrap.querySelector('.ss-create:not(.hidden)');
                if (create) ssCreate(wrap);
            }
        });
    }

    /* ---------- category request editor (requester submit / Central review / resubmit) ---------- */
    // canonical parser for attribute option lists. Handles every shape options
    // have arrived in: a real array, a JSON-encoded array string ('["a", "b"]'
    // as delivered by the AI engine), a clean comma list, or comma fragments
    // still carrying stray brackets/quotes from older saves.
    function optionList(s) {
        if (Array.isArray(s)) return s.map(x => String(x).trim()).filter(Boolean);
        const str = String(s || '').trim();
        if (!str) return [];
        if (str.charAt(0) === '[') {
            try {
                const arr = JSON.parse(str);
                if (Array.isArray(arr)) return arr.map(x => String(x).trim()).filter(Boolean);
            } catch (e) { /* fall through to fragment cleanup */ }
        }
        return str.split(',')
            .map(x => x.trim().replace(/^[\["']+|[\]"']+$/g, '').trim())
            .filter(Boolean);
    }
    function catOptsSplit(s) { return optionList(s); }

    // "List values" cell: a chip editor for List-type attributes, an inert dash
    // otherwise. The canonical value always lives in the hidden [data-f="options"]
    // input as a comma-joined string — the format stored on category schemas.
    function catOptionsCellHtml(options, isList) {
        const vals = catOptsSplit(options);
        if (!isList) return `<input type="hidden" data-f="options" value="${esc(vals.join(', '))}">
            <span class="muted cat-opt-na" title="Values are defined for List fields only">—</span>`;
        return `<div class="chips-input" data-chips>
            <input type="hidden" data-f="options" value="${esc(vals.join(', '))}">
            ${vals.map(v => `<span class="chip">${esc(v)}<button type="button" class="chip-del" data-chip-del="${esc(v)}" title="Remove">✕</button></span>`).join('')}
            <input type="text" class="chips-entry" placeholder="Type a value, press Enter">
        </div>`;
    }

    function chipsSync(wrap) {
        const hidden = wrap.querySelector('[data-f="options"]');
        const entry = wrap.querySelector('.chips-entry');
        wrap.querySelectorAll('.chip').forEach(c => c.remove());
        catOptsSplit(hidden.value).forEach(v => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = v;
            const del = document.createElement('button');
            del.type = 'button'; del.className = 'chip-del'; del.title = 'Remove'; del.textContent = '✕';
            del.setAttribute('data-chip-del', v);
            chip.appendChild(del);
            wrap.insertBefore(chip, entry);
        });
    }
    function chipsAdd(wrap, text) {
        const hidden = wrap.querySelector('[data-f="options"]');
        const vals = catOptsSplit(hidden.value);
        catOptsSplit(text).forEach(v => {   // pasted "a, b, c" becomes three chips
            if (!vals.some(x => x.toLowerCase() === v.toLowerCase())) vals.push(v);
        });
        hidden.value = vals.join(', ');
        wrap.classList.remove('error');
        chipsSync(wrap);
    }
    function chipsRemove(wrap, val) {
        const hidden = wrap.querySelector('[data-f="options"]');
        hidden.value = catOptsSplit(hidden.value).filter(v => v !== val).join(', ');
        chipsSync(wrap);
    }

    function catAttrRowHtml(a) {
        a = a || {};
        const types = ds().ATTR_FIELD_TYPES || ['Text', 'Number', 'Range', 'Yes/No', 'List', 'Date'];
        const uoms = ds().UOM || [];
        const mand = a.mandatory === true || a.mandatory === 'Yes';
        return `<tr class="cat-attr-row">
            <td><input class="form-input" data-f="name" value="${esc(a.name || '')}" placeholder="Attribute name"></td>
            <td><select class="form-select" data-f="fieldType">${types.map(t => `<option value="${esc(t)}" ${a.fieldType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
            <td><select class="form-select" data-f="uom"><option value="">—</option>${uoms.map(u => `<option value="${esc(u)}" ${a.uom === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></td>
            <td><select class="form-select" data-f="mandatory"><option value="No" ${mand ? '' : 'selected'}>No</option><option value="Yes" ${mand ? 'selected' : ''}>Yes</option></select></td>
            <td class="cat-opt-cell">${catOptionsCellHtml(a.options || '', a.fieldType === 'List')}</td>
            <td><button type="button" class="btn-view btn-view-danger" data-cat="del-row" title="Remove attribute">✕</button></td>
        </tr>`;
    }

    /* commodity choices for the UNSPSC class of a code: the reference codelist
       (unspsc-ref.js) + live catalog categories of the class + the AI engine's
       own alternatives carried on the request + the current proposal itself */
    function commodityOptions(p) {
        const code = String(p.unspsc || '').replace(/\D/g, '');
        const cls = code.slice(0, 6);
        const ref = (window.UNSPSC_CLASSES || {})[cls];
        const map = {};
        if (ref) Object.assign(map, ref.commodities);
        (ds().CATEGORY_ATTRIBUTES || []).forEach(c => {
            if (String(c.unspsc).replace(/\D/g, '').slice(0, 6) === cls) map[c.unspsc] = map[c.unspsc] || c.label;
        });
        (p.alternatives || []).forEach(a => {
            if (a && a.unspsc && String(a.unspsc).replace(/\D/g, '').slice(0, 6) === cls) map[a.unspsc] = map[a.unspsc] || a.categoryName;
        });
        if (code) map[code] = p.categoryName || map[code] || '';
        const options = Object.keys(map).sort().map(k => ({ value: k, label: (map[k] || 'Commodity') + ' — ' + k, name: map[k] || '' }));
        return { cls, classTitle: ref ? ref.title : '', options };
    }

    function categoryEditorHtml(p, opts) {
        p = p || {};
        opts = opts || {};
        const attrs = (p.catAttributes && p.catAttributes.length) ? p.catAttributes : [{}, {}, {}];
        // Central review: the category is a COMMODITY PICKER — preselected with
        // the AI engine's choice, opening onto the commodities of its UNSPSC
        // class. Canonical values live in the hidden cat::name / cat::unspsc
        // inputs, so collection and validation are unchanged.
        const headHtml = opts.commodityPicker
            ? (() => {
                const co = commodityOptions(p);
                return `<div class="form-grid" style="margin-bottom:14px">
                    <div class="field col-span-2">
                        <label class="req-label">Category · UNSPSC commodity<span class="req">*</span></label>
                        <select class="form-select" name="cat::commodity">
                            ${co.options.map(o => `<option value="${esc(o.value)}" data-name="${esc(o.name)}" ${o.value === String(p.unspsc || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                        </select>
                        <div class="hint">${co.cls ? `UNSPSC class ${esc(co.cls)}${co.classTitle ? ' — ' + esc(co.classTitle) : ''} · commodities of this class` : 'Commodities of the code’s UNSPSC class'}</div>
                        <div class="field-error" data-err="cat::unspsc"></div>
                    </div>
                    <input type="hidden" name="cat::name" value="${esc(p.categoryName || '')}">
                    <input type="hidden" name="cat::unspsc" value="${esc(p.unspsc || '')}">
                </div>`;
            })()
            : `<div class="form-grid" style="margin-bottom:14px">
                ${field({ label: 'Category name', name: 'cat::name', value: p.categoryName || '', required: true, placeholder: 'e.g. Gate valves' })}
                ${field({ label: 'UNSPSC code', name: 'cat::unspsc', value: p.unspsc || '', required: true, placeholder: 'e.g. 40141607', hint: '8-digit UNSPSC classification code' })}
            </div>`;
        return `<div class="cat-editor">
            ${headHtml}
            <div class="rb-title" style="margin-bottom:8px">Attributes</div>
            <div class="cat-attr-wrap"><table class="data-table attr-edit-table">
                <thead><tr><th>Attribute name</th><th>Field type</th><th>Measured in</th><th>Mandatory</th><th>List values</th><th></th></tr></thead>
                <tbody class="cat-attr-rows">${attrs.map(catAttrRowHtml).join('')}</tbody>
            </table></div>
            <button type="button" class="btn btn-outline btn-sm" data-cat="add-row" style="margin-top:10px">+ Add attribute</button>
            <div class="field-error" data-err="cat::attrs"></div>
        </div>`;
    }

    function bindCategoryEditor(container) {
        if (container.__catBound) return;
        container.__catBound = true;
        // if the editor rendered before the full UNSPSC codeset finished loading,
        // swap in the complete commodity list of the class once it arrives —
        // keeping the current selection and any engine-alternative entries
        const pickSel = container.querySelector('select[name="cat::commodity"]');
        if (pickSel && window.UNSPSC_READY) {
            window.UNSPSC_READY.then(ok => {
                if (!ok) return;
                const sel = container.querySelector('select[name="cat::commodity"]');
                if (!sel || sel.__fullList) return;
                const cur = sel.value;
                const curName = (container.querySelector('[name="cat::name"]') || {}).value || '';
                const have = {};
                [...sel.options].forEach(o => { have[o.value] = o.getAttribute('data-name') || ''; });
                const co = commodityOptions({ unspsc: cur, categoryName: curName });
                co.options.forEach(o => { have[o.value] = have[o.value] || o.name; });
                if (Object.keys(have).length <= sel.options.length) return;   // nothing new
                const html = `<select class="form-select" name="cat::commodity">` +
                    Object.keys(have).sort().map(v =>
                        `<option value="${esc(v)}" data-name="${esc(have[v])}" ${v === cur ? 'selected' : ''}>${esc((have[v] || 'Commodity') + ' — ' + v)}</option>`).join('') +
                    `</select>`;
                const wrap = sel.closest('.search-select');
                (wrap || sel).outerHTML = html;   // the observer re-enhances the fresh select
                sel.__fullList = true;
                const hint = container.querySelector('.cat-editor .field .hint');
                if (hint && co.classTitle) hint.textContent = `UNSPSC class ${co.cls} — ${co.classTitle} · commodities of this class`;
            });
        }
        container.addEventListener('click', (e) => {
            const del = e.target.closest('[data-chip-del]');
            if (del && container.contains(del)) {
                chipsRemove(del.closest('[data-chips]'), del.getAttribute('data-chip-del'));
                return;
            }
            const box = e.target.closest('[data-chips]');
            if (box && e.target === box) {   // clicking the empty area focuses the entry
                const en = box.querySelector('.chips-entry'); if (en) en.focus();
                return;
            }
            const t = e.target.closest('[data-cat]');
            if (!t || !container.contains(t)) return;
            const act = t.getAttribute('data-cat');
            if (act === 'add-row') {
                container.querySelector('.cat-attr-rows').insertAdjacentHTML('beforeend', catAttrRowHtml({}));
            } else if (act === 'del-row') {
                const tr = t.closest('tr'); if (tr) tr.remove();
            }
        });
        // chip entry: Enter or comma commits the typed value; Backspace on an
        // empty entry removes the last chip
        container.addEventListener('keydown', (e) => {
            if (!e.target.classList || !e.target.classList.contains('chips-entry')) return;
            const wrap = e.target.closest('[data-chips]');
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                if (e.target.value.trim()) { chipsAdd(wrap, e.target.value); e.target.value = ''; }
            } else if (e.key === 'Backspace' && !e.target.value) {
                const vals = catOptsSplit(wrap.querySelector('[data-f="options"]').value);
                if (vals.length) chipsRemove(wrap, vals[vals.length - 1]);
            }
        });
        // leaving the field keeps whatever was typed — no value lost to a missed Enter
        container.addEventListener('focusout', (e) => {
            if (e.target.classList && e.target.classList.contains('chips-entry') && e.target.value.trim()) {
                chipsAdd(e.target.closest('[data-chips]'), e.target.value);
                e.target.value = '';
            }
        });
        // switching the field type swaps the values cell (chips for List, dash
        // otherwise); the entered values survive a round-trip through other types
        container.addEventListener('change', (e) => {
            if (!e.target.matches) return;
            // commodity picked from the class list → sync the canonical hidden fields
            if (e.target.matches('select[name="cat::commodity"]')) {
                const opt = e.target.selectedOptions && e.target.selectedOptions[0];
                const nameEl = container.querySelector('[name="cat::name"]');
                const codeEl = container.querySelector('[name="cat::unspsc"]');
                if (nameEl) nameEl.value = opt ? (opt.getAttribute('data-name') || opt.textContent.split(' — ')[0]) : '';
                if (codeEl) codeEl.value = e.target.value;
                return;
            }
            if (!e.target.matches('select[data-f="fieldType"]')) return;
            const cell = e.target.closest('tr').querySelector('.cat-opt-cell');
            const hidden = cell.querySelector('[data-f="options"]');
            cell.innerHTML = catOptionsCellHtml(hidden ? hidden.value : '', e.target.value === 'List');
        });
    }

    function collectCategoryEditor(container) {
        const val = (sel) => { const el = container.querySelector(sel); return el ? el.value.trim() : ''; };
        const attrs = [];
        container.querySelectorAll('.cat-attr-row').forEach(tr => {
            const f = (k) => { const el = tr.querySelector(`[data-f="${k}"]`); return el ? el.value.trim() : ''; };
            if (!f('name')) return;
            const ft = f('fieldType') || 'Text';
            let options = '';
            if (ft === 'List') {
                const vals = catOptsSplit(f('options'));
                const entry = tr.querySelector('.chips-entry');   // count text typed but not yet committed
                if (entry) catOptsSplit(entry.value).forEach(v => {
                    if (!vals.some(x => x.toLowerCase() === v.toLowerCase())) vals.push(v);
                });
                options = vals.join(', ');
            }
            attrs.push({ name: f('name'), fieldType: ft, uom: f('uom'), mandatory: f('mandatory') === 'Yes', options });
        });
        return { categoryName: val('[name="cat::name"]'), unspsc: val('[name="cat::unspsc"]'), catAttributes: attrs };
    }

    function validateCategoryEditor(container, data) {
        container.querySelectorAll('.form-input, .form-select, .chips-input').forEach(el => el.classList.remove('error'));
        container.querySelectorAll('.field-error').forEach(el => el.textContent = '');
        const errs = [];
        if (!data.categoryName) errs.push(['[name="cat::name"]', '[data-err="cat::name"]', 'Category name is required.']);
        if (!data.unspsc) errs.push(['[name="cat::unspsc"]', '[data-err="cat::unspsc"]', 'UNSPSC code is required.']);
        errs.forEach(([inSel, errSel, msg]) => {
            const el = container.querySelector(inSel); if (el) el.classList.add('error');
            const er = container.querySelector(errSel); if (er) er.textContent = msg;
        });
        if (!data.catAttributes.length) {
            const er = container.querySelector('[data-err="cat::attrs"]');
            if (er) er.textContent = 'Add at least one attribute (with a name).';
            return false;
        }
        // a List attribute without values would render an empty dropdown on the form
        let listErr = false;
        container.querySelectorAll('.cat-attr-row').forEach(tr => {
            const name = tr.querySelector('[data-f="name"]');
            const ft = tr.querySelector('[data-f="fieldType"]');
            if (!name || !name.value.trim() || !ft || ft.value !== 'List') return;
            const hidden = tr.querySelector('[data-f="options"]');
            const entry = tr.querySelector('.chips-entry');
            if (!catOptsSplit(hidden && hidden.value).length && !(entry && entry.value.trim())) {
                listErr = true;
                const box = tr.querySelector('[data-chips]'); if (box) box.classList.add('error');
            }
        });
        if (listErr) {
            const er = container.querySelector('[data-err="cat::attrs"]');
            if (er) er.textContent = 'List attributes need at least one value.';
            return false;
        }
        return errs.length === 0;
    }

    /* ---------- PO-unit compatibility ----------
       A PO unit must fit the base unit's dimension: mass with mass, length with
       length, volume with volume; count/packaging units group together. A base
       unit outside the map (custom UoM) gets the full catalog, unfiltered. */
    const UOM_COMPAT = {
        EA: ['EA', 'PC', 'SET', 'PR', 'BOX'],
        PC: ['PC', 'EA', 'SET', 'PR', 'BOX'],
        SET: ['SET', 'BOX'],
        PR: ['PR', 'BOX'],
        BOX: ['BOX'],
        ROLL: ['ROLL', 'BOX'],
        M: ['M', 'MM', 'ROLL'],
        MM: ['MM', 'M', 'ROLL'],
        KG: ['KG', 'G', 'TON'],
        G: ['G', 'KG', 'TON'],
        TON: ['TON', 'KG', 'G'],
        L: ['L', 'ML', 'M3'],
        ML: ['ML', 'L'],
        M3: ['M3', 'L'],
        M2: ['M2', 'ROLL']
    };
    function poUnitOptionsFor(baseUom) {
        const compat = UOM_COMPAT[String(baseUom || '').toUpperCase()];
        const catalog = (ds().UOM || []).slice();
        if (!compat) return catalog;
        const avail = compat.filter(u => catalog.indexOf(u) !== -1);
        return avail.length ? avail : compat.slice();
    }

    /* ---------- schema-driven technical-attribute editor (shared) ----------
       Same typed controls as the create form (Text / Number / Range / Yes-No /
       List / Date, uom appended on collect, ranges as min–max) — used by the
       MDM review panel. Inputs are named attr::<name> (+ ::max for ranges). */
    function attrEditorNum(v) {
        const n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.'));
        return isNaN(n) ? '' : n;
    }
    function attrEditorField(a, val, forceOptional) {
        const name = 'attr::' + a.name;
        const t = a.fieldType || 'Text';
        const mandatory = a.mandatory && !forceOptional;
        const label = `${esc(a.name)}${a.uom ? ` <span class="attr-uom">(${esc(String(a.uom).toLowerCase())})</span>` : ''}${mandatory ? '<span class="req">*</span>' : ''}`;
        let control;
        if (t === 'Number') {
            control = `<input class="form-input" type="number" step="any" name="${esc(name)}" value="${esc(attrEditorNum(val))}">`;
        } else if (t === 'Range') {
            const parts = String(val || '').split(/–|—|\.\.|to/i);
            control = `<div class="range-pair">
                <input class="form-input" type="number" step="any" name="${esc(name)}" placeholder="Min" value="${esc(attrEditorNum(parts[0]))}">
                <span class="muted">–</span>
                <input class="form-input" type="number" step="any" name="${esc(name)}::max" placeholder="Max" value="${esc(attrEditorNum(parts[1]))}">
            </div>`;
        } else if (t === 'Yes/No') {
            control = `<select class="form-select" name="${esc(name)}">
                <option value="">Select…</option>
                <option ${val === 'Yes' ? 'selected' : ''}>Yes</option>
                <option ${val === 'No' ? 'selected' : ''}>No</option></select>`;
        } else if (t === 'List') {
            const cur = String(val || '').trim();
            const opts = optionList(a.options);
            if (cur && opts.indexOf(cur) === -1) opts.unshift(cur);
            control = `<select class="form-select" name="${esc(name)}">
                <option value="">Select…</option>
                ${opts.map(o => `<option value="${esc(o)}" ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        } else if (t === 'Date') {
            control = `<input class="form-input" type="date" name="${esc(name)}" value="${esc(val || '')}">`;
        } else {
            control = `<input class="form-input" type="text" name="${esc(name)}" value="${esc(val || '')}">`;
        }
        return `<div class="field"><label class="${mandatory ? 'req-label' : ''}">${label}</label>${control}<div class="field-error" data-err="${esc(name)}"></div></div>`;
    }
    function attrEditorHtml(unspsc, values, forceOptional) {
        values = values || {};
        const schema = categorySchema(unspsc);
        if (!schema) {
            const entries = Object.entries(values);
            return entries.length
                ? entries.map(([k, v]) => attrEditorField({ name: k, fieldType: 'Text' }, v, true)).join('')
                : `<div class="muted" style="grid-column:1/-1">No attribute schema for this category.</div>`;
        }
        return schema.attributes.map(a => {
            let v = values[a.name];
            v = (v === undefined || v === null) ? '' : String(v).trim();
            if (a.uom) v = v.replace(new RegExp('\\s*' + a.uom + '\\s*$', 'i'), '');
            return attrEditorField(a, v, forceOptional);
        }).join('');
    }
    function collectAttrEditor(container, unspsc) {
        const schema = categorySchema(unspsc);
        const val = (n) => {
            const el = container.querySelector(`[name="${CSS.escape(n)}"]`);
            return el ? String(el.value).trim() : '';
        };
        const attrs = {};
        if (schema) {
            schema.attributes.forEach(a => {
                const t = a.fieldType || 'Text';
                let v = '';
                if (t === 'Range') {
                    const min = val('attr::' + a.name), max = val('attr::' + a.name + '::max');
                    if (min || max) v = (min || '…') + '–' + (max || '…');
                } else v = val('attr::' + a.name);
                if (v && a.uom) v += ' ' + String(a.uom).toLowerCase();
                if (v) attrs[a.name] = v;
            });
        } else {
            container.querySelectorAll('[name^="attr::"]').forEach(el => {
                const n = el.getAttribute('name');
                if (n.indexOf('::max') !== -1) return;
                const v = String(el.value).trim();
                if (v) attrs[n.slice(6)] = v;
            });
        }
        return attrs;
    }

    /* ---- shared PDF export: rasterize a page section (html2canvas + jsPDF),
       paginate on card boundaries, download directly ---- */
    async function exportPdf(el, filename) {
        if (!el || !window.html2canvas || !window.jspdf) {
            toast({ title: 'Export unavailable', body: 'PDF engine failed to load.', kind: 'danger' });
            return;
        }
        toast({ title: 'Generating PDF…', body: 'Capturing the page — one moment.', kind: 'info' });
        el.classList.add('pdf-export');
        await new Promise(res => setTimeout(res, 60));   // let the export styles paint
        try {
            const canvas = await window.html2canvas(el, { scale: 1.5, backgroundColor: '#ffffff', logging: false, windowWidth: el.scrollWidth });
            const px = canvas.width / (el.scrollWidth || el.offsetWidth || 1);
            const breaks = [...el.querySelectorAll('.dash-tiles, .viz-card, .dash-section, .panel-card')]
                .map(b => Math.round((b.getBoundingClientRect().top - el.getBoundingClientRect().top) * px))
                .filter(y => y > 0).sort((a, b) => a - b);
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
            const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
            const margin = 24;
            const imgW = pw - margin * 2;
            const pageH = Math.floor((ph - margin * 2) * (canvas.width / imgW));
            let y = 0, page = 0;
            while (y < canvas.height - 4) {
                let end = Math.min(y + pageH, canvas.height);
                if (end < canvas.height) {
                    const cut = breaks.filter(b => b > y + pageH * 0.55 && b <= end).pop();
                    if (cut) end = cut - Math.round(6 * px);
                }
                const slice = document.createElement('canvas');
                slice.width = canvas.width; slice.height = end - y;
                const ctx = slice.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, slice.width, slice.height);
                ctx.drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
                if (page) pdf.addPage();
                pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, (end - y) * (imgW / canvas.width));
                y = end; page++;
            }
            pdf.save(filename);
            toast({ title: 'PDF downloaded', body: page + ' page(s) — ' + filename, kind: 'info' });
        } catch (err) {
            toast({ title: 'Export failed', body: String(err && err.message || err), kind: 'danger' });
        } finally {
            el.classList.remove('pdf-export');
        }
    }

    /* ---- shared .xlsx export: stored-entry ZIP + one inline-string sheet.
       No libraries — a genuine Excel file built byte by byte. ---- */
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function zipStore(files) {
        const enc = new TextEncoder();
        const u16 = (v) => [v & 255, (v >> 8) & 255];
        const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
        const parts = [], central = [];
        let offset = 0;
        files.forEach(f => {
            const name = enc.encode(f.name), data = enc.encode(f.text);
            const crc = crc32(data);
            const head = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
                ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
            parts.push(head, name, data);
            central.push({ name, crc, size: data.length, offset });
            offset += head.length + name.length + data.length;
        });
        let cdSize = 0;
        central.forEach(c => {
            const e = new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
                ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0),
                ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)]);
            parts.push(e, c.name);
            cdSize += e.length + c.name.length;
        });
        parts.push(new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
            ...u32(cdSize), ...u32(offset), ...u16(0)]));
        return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }
    function xmlEsc2(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function exportXlsx(rows, sheetName, filename) {
        const rowXml = rows.map(r => '<row>' + r.map(v =>
            `<c t="inlineStr"><is><t xml:space="preserve">${xmlEsc2(v)}</t></is></c>`).join('') + '</row>').join('');
        const blob = zipStore([
            { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
            { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
            { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc2(sheetName || 'Sheet1')}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
            { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
            { name: 'xl/worksheets/sheet1.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>` }
        ]);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }

    window.UI = {
        esc, go, nowLabel, bindActions, toast, openModal, closeModals,
        renderHeader, toggleNotifPanel,
        field, techGrid, workflowTracker, bulkTracker, historyList, isSentence, invFor, setInv,
        categoryEditorHtml, bindCategoryEditor, collectCategoryEditor, validateCategoryEditor, searchSelectHtml, commodityOptions,
        plantName, plantLabel, groupDesc, valuationDesc, categorySchema, abcDesc, storageOptionsFor, inventoryRows, ds,
        docListHtml, docKB, bindInvMinMaxRule, exportPdf, exportXlsx,
        addManufacturer, ssEnsureOption, optionList,
        attrEditorHtml, collectAttrEditor, poUnitOptionsFor,
        cartCount, addToCart, isSocar, setWorkspace
    };
})();
