/* ============================================================
   app.js — bootstrap for the analytics-only static build.
   Runs entirely from the bundled state snapshot (no server), always as
   the Central team so the dashboard is visible, and keeps navigation
   pinned to the dashboard.
   ============================================================ */
(function () {
    window.Views = window.Views || {};
    // static host: there is no /api/state — answer the store's sync calls locally
    // instead of letting them hit the network and fail
    const realFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
        if (String(url).indexOf('/api/state') === 0) return Promise.resolve(new Response('{}', { status: 404 }));
        return realFetch(url, opts);
    };
    if (navigator.sendBeacon) navigator.sendBeacon = function () { return false; };

    function boot() {
        window.Store.init();
        window.Store.set(function (s) {
            s.session.currentRole = 'Central team';
            s.session.workspace = 'socar';
        });
        // in-app links (request rows, breadcrumbs, report buttons) stay on the dashboard
        window.UI.go = function (hash) {
            if (String(hash).indexOf('#/dashboard') === 0) window.location.hash = hash;
        };
        // the dashboard re-renders on every filter change — keep its breadcrumb
        // showing only the dashboard, since the master page is not part of this build
        const view = document.getElementById('view');
        const fixCrumb = function () {
            const sub = view.querySelector('.sub-header');
            if (sub && sub.querySelector('.crumb-link')) sub.textContent = 'Analytics dashboard';
        };
        new MutationObserver(fixCrumb).observe(view, { childList: true });
        window.Router.start();
        fixCrumb();
        if (window.I18N) window.I18N.apply();   // re-apply persisted language
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
