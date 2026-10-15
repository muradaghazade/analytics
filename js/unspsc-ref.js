/* ============================================================
   unspsc-ref.js — UNSPSC reference codelist (class → commodities)

   Used by the Central-team category review to offer the commodities of a
   class as a dropdown. The FULL codeset (UNSPSC v26 — ~8k classes, ~150k
   commodities) is loaded lazily from data/unspsc-classes.json; the small
   inline seed below covers the engine-observed codes instantly while that
   loads (and if the fetch ever fails). The picker additionally merges the
   live category catalog and the alternatives the AI engine returned with
   each request.

   Shape: window.UNSPSC_CLASSES = { '<6-digit class>': {
       title: '<class title>', commodities: { '<8-digit code>': '<title>' } } }
   ============================================================ */
(function () {
    'use strict';
    window.UNSPSC_CLASSES = {
        '261118': { title: 'Power transmission belts', commodities: {
            '26111801': 'V belts',
            '26111804': 'Flat belts',
            '26111811': 'Synchronous belt'
        } },
        '311715': { title: 'Bearings', commodities: {
            '31171500': 'Bearings (class level)',
            '31171504': 'Ball bearings',
            '31171516': 'Tapered roller bearings'
        } },
        '401416': { title: 'Valves', commodities: {
            '40141605': 'Solenoid valves',
            '40141607': 'Gate valves'
        } },
        '401427': { title: 'Pipe fittings', commodities: {
            '40142701': 'Pipe fitting flange general'
        } },
        '401732': { title: 'Long weldneck flanges', commodities: {
            '40173201': 'Carbon steel pipe long weldneck flange'
        } },
        '401750': { title: 'Pipe weldneck flanges', commodities: {
            '40175001': 'Carbon steel pipe weldneck flange',
            '40175002': 'Forged steel pipe weldneck flange'
        } },
        '232718': { title: 'Welding machinery and supplies', commodities: {
            '23271807': 'Welding electrodes'
        } },
        '261216': { title: 'Electrical cables and accessories', commodities: {
            '26121600': 'Electrical cables and accessories (class level)',
            '26121603': 'Control cable',
            '26121636': 'Patch cords'
        } },
        '391216': { title: 'Circuit protection devices', commodities: {
            '39121600': 'Circuit protection devices and accessories (class level)',
            '39121602': 'Magnetic circuit breakers',
            '39121603': 'Miniature circuit breakers',
            '39121614': 'Earth leakage circuit breakers'
        } },
        '391210': { title: 'Power conditioning equipment', commodities: {
            '39121004': 'Power supply units'
        } },
        '391016': { title: 'Lamps and lightbulbs', commodities: {
            '39101628': 'Light emitting diode LED lamp'
        } },
        '261011': { title: 'Electric alternating current AC motors', commodities: {
            '26101112': 'General purpose motor AC',
            '26101114': 'Induction motor AC'
        } },
        '401515': { title: 'Pumps', commodities: {
            '40151503': 'Centrifugal pumps'
        } },
        '401423': { title: 'Hoses', commodities: {
            '40142303': 'Hydraulic hoses'
        } }
    };

    // lazy-load the full UNSPSC v26 codeset; resolves true once it replaced the
    // seed (seed entries are kept for any class the codeset lacks)
    window.UNSPSC_READY = (typeof fetch === 'function'
        ? fetch('data/unspsc-classes.json').then(r => (r.ok ? r.json() : null)).catch(() => null)
        : Promise.resolve(null)
    ).then(d => {
        if (!d) return false;
        const seed = window.UNSPSC_CLASSES;
        const full = {};
        Object.keys(d).forEach(cls => { full[cls] = { title: d[cls].title || '', commodities: d[cls].c || {} }; });
        Object.keys(seed).forEach(cls => { if (!full[cls]) full[cls] = seed[cls]; });
        window.UNSPSC_CLASSES = full;
        return true;
    });
})();
