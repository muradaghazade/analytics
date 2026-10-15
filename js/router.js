/* ============================================================
   router.js — analytics-only build: the dashboard is the only route.
   Any other hash (including links inside the dashboard that point to
   requests or the master) lands back on the dashboard.
   ============================================================ */
(function () {
    const HOME = '#/dashboard';

    function parseQuery() {
        const q = {};
        const i = window.location.hash.indexOf('?');
        if (i === -1) return q;
        new URLSearchParams(window.location.hash.slice(i + 1)).forEach((v, k) => q[k] = v);
        return q;
    }

    function render() {
        const path = (window.location.hash || HOME).split('?')[0];
        if (path !== HOME) { window.location.hash = HOME; return; }
        window.UI.renderHeader();
        window.Views.dashboard();
        window.scrollTo(0, 0);
    }

    function start() {
        window.addEventListener('hashchange', render);
        window.Store.subscribe(() => { window.UI.renderHeader(); });
        if (window.location.hash !== HOME) window.location.hash = HOME;
        else render();
    }

    window.Router = { start, render, parseQuery };
})();
