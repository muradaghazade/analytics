/* ============================================================
   ai.js — simulated AI mastering engine
   parse → categorize → attributes → values → duplicate-check → validate
   Deterministic: known demo profiles + a generic fallback parser.
   ============================================================ */
(function () {

    /* ---- helpers for attribute extraction ---- */
    function firstMatch(t, re) { const m = t.match(re); return m ? m[0] : ''; }
    function dims3(t) { const m = t.match(/(\d{1,4}(?:\.\d+)?)\s*[x×]\s*(\d{1,4}(?:\.\d+)?)\s*[x×]\s*(\d{1,4}(?:\.\d+)?)/); return m ? [m[1], m[2], m[3]] : []; }

    /* ---- MRO description structure — identical to the mastered records:
       short: NOUN,QUALIFIER:IDENT             → BEARING,BALL:6307-2RS1
       long:  <short> SPEC,SPEC,…,MFR:X,MPN:Y → BELT,V:17X1850 V-BELT,17MM X 1850MM,BANDED,MFR:GATES,MPN:9635-01850 ---- */
    function mroShort(noun, qual, ident) {
        let s = String(noun || 'ITEM').toUpperCase().trim();
        if (qual) s += ',' + String(qual).toUpperCase().trim();
        if (ident) s += ':' + String(ident).toUpperCase().replace(/\s+/g, '');
        return s;
    }
    function mroLong(shortDesc, specs, manufacturer, mfrPartNo) {
        const parts = (specs || []).filter(s => s && String(s).trim())
            .map(s => String(s).toUpperCase().replace(/\s+/g, ' ')
                .replace(/(\d)\s+(MM|CM|KG|BAR|HZ|KW|KN|KV|AWG|G|M|L|V|A|W)\b/g, '$1$2').trim());
        if (manufacturer) parts.push('MFR:' + String(manufacturer).toUpperCase());
        if (mfrPartNo) parts.push('MPN:' + String(mfrPartNo).toUpperCase());
        return parts.length ? shortDesc + ' ' + parts.join(',') : shortDesc;
    }

    /* ---- Known demo profiles keyed by matching keywords. Each build() aims for >= 8 attributes. ---- */
    // descriptor words that can lead a description but are never brand names
    const MFG_STOP = new Set(['hex', 'cast', 'stainless', 'carbon', 'mild', 'galvanized', 'galvanised',
        'electrolytic', 'acetone', 'anti', 'anticorrosion', 'single', 'double', 'deep', 'wedge',
        'tapered', 'needle', 'angular', 'spherical', 'cylindrical', 'steel', 'iron', 'brass', 'copper',
        'aluminium', 'aluminum', 'rubber', 'plastic', 'nylon', 'oil', 'grease', 'paint', 'primer',
        'warm', 'cold', 'white', 'black', 'grey', 'gray', 'red', 'blue', 'green', 'flat', 'round',
        'square', 'socket', 'spring', 'lock', 'locking', 'heavy', 'light', 'general', 'standard',
        'technical', 'industrial', 'premium', 'super', 'ultra', 'mini', 'micro', 'max', 'multi',
        'oring', 'o-ring', 'miniature', 'vertical', 'horizontal', 'centrifugal', 'submersible',
        'portable', 'digital', 'analog', 'manual', 'automatic', 'solvent', 'welding', 'hydraulic',
        'chemical', 'electric', 'electrical', 'patch', 'power', 'control', 'motor', 'gate', 'globe',
        'check', 'butterfly', 'ball', 'roller', 'dome', 'bullet', 'grade', 'zinc', 'plated']);
    // acronyms/specs that look like brand tokens but never are
    const NOT_BRANDS = new Set(['ID', 'OD', 'AC', 'DC', 'PVC', 'NBR', 'EPDM', 'PTFE', 'LED', 'USB',
        'UTP', 'STP', 'SS', 'MS', 'OK', 'XL', 'ZZ', 'RS', 'VV', 'CN', 'PN', 'DN', 'MM', 'KG', 'KN',
        'CR', 'PA', 'PE', 'PP', 'PB', 'API', 'EN', 'ISO', 'DIN', 'ANSI', 'MRP', 'SAP', 'UOM', 'MRO']);
    // does a token look like a part number? (loose accepts short codes like CAT6)
    function partToken(w, loose) {
        if (!w) return false;
        if (/mm$/i.test(w) || /^dn\d|^pn\d|^m\d{1,2}$/i.test(w)) return false;   // sizes, standards
        // pure numbers are only trusted right after a manufacturer name (loose) —
        // standing alone they are usually specs (1500 lumen, 2500 rpm)
        if (/^\d{4,7}$/.test(w)) return !!loose;
        const digits = (w.match(/\d/g) || []).length;
        const letters = (w.match(/[a-z]/gi) || []).length;
        if (!/^[a-z0-9][a-z0-9./-]*$/i.test(w)) return false;
        return loose ? (w.length >= 3 && digits >= 1 && letters >= 1)
                     : (w.length >= 4 && w.length <= 18 && digits >= 2 && (letters >= 1 || w.indexOf('-') !== -1));
    }
    // could this word be a brand name at all? (pure pattern check, no lists of
    // known manufacturers — any name-shaped token qualifies)
    function nameShaped(w) {
        if (!w || !/^[A-Za-z][A-Za-z&.-]{1,14}$/.test(w)) return false;
        if (NOT_BRANDS.has(w.toUpperCase()) || CAT_STOP.has(w.toLowerCase()) || MFG_STOP.has(w.toLowerCase())) return false;
        if (/^(sp[abcz]|[345]l|p[hjklm])$/i.test(w)) return false;               // belt section codes aren't brands
        return !CAT_DOMAINS.some(d => d.re.test(w.toLowerCase()));               // domain nouns aren't brands
    }
    function detectMfr(t) {
        const words = String(t || '').split(/\s+/).map(w => w.replace(/[.,;:]+$/, ''));
        // rule 1: "<Name> <PartNo>" — the token right before a part-number-shaped
        // token reads as the manufacturer, whatever the name is. A lowercase
        // token only counts at the very start ("festo DSBC-40-125"), otherwise
        // ordinary words like "operated" would read as brands mid-sentence.
        for (let i = 0; i + 1 < words.length; i++) {
            const w = words[i];
            if (!nameShaped(w) || !partToken(words[i + 1], true)) continue;
            if (i === 0 || w === w.toUpperCase() || /^[A-Z]/.test(w)) return w;
        }
        // rule 2: a name-shaped LEADING token (ALL-CAPS, or Capitalised) is the
        // manufacturer — descriptions conventionally start with the brand
        const w0 = words[0];
        if (nameShaped(w0) && (w0 === w0.toUpperCase() || /^[A-Z]/.test(w0))) return w0;
        return '';
    }
    // dimension next to a keyword, both orders: "30 mm ID" and "ID 30 mm" / "ID: 30mm"
    function dimNear(t, keys, unit) {
        const u = (unit || 'mm').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let m = t.match(new RegExp('\\b(\\d{1,4}(?:[.,]\\d+)?)\\s?' + u + '\\s?(?:' + keys + ')\\b', 'i'));
        if (!m) m = t.match(new RegExp('\\b(?:' + keys + ')[:\\s]+(\\d{1,4}(?:[.,]\\d+)?)\\s?' + u + '\\b', 'i'));
        return m ? m[1] : '';
    }

    // generic part-number extraction: prefer the token right after the
    // manufacturer name ("INA NKIA5910-XL" → NKIA5910-XL), else the first
    // token that looks like a part number (digits + letters/dashes mix)
    function extractPartNo(t, mfr) {
        const words = String(t || '').split(/\s+/).map(w => w.replace(/[.,;:]+$/, ''));
        const mfrWord = (mfr || '').split(/\s+/)[0].toLowerCase();
        if (mfrWord) {
            // the token right after the manufacturer name — accepts short codes too
            const mi = words.findIndex(w => w.toLowerCase() === mfrWord);
            if (mi !== -1 && mi + 1 < words.length && partToken(words[mi + 1], true)) {
                return words[mi + 1].toUpperCase();
            }
        }
        const cand = words.find(w => partToken(w, false));
        return cand ? cand.toUpperCase() : '';
    }

    // post-parse enrichment for EVERY description: fill in manufacturer,
    // part number and dimension attributes the specific parser missed —
    // only ever fills blanks, never overwrites what a profile extracted
    function enrichParsed(parsed, rawText) {
        const t = String(rawText || '');
        let structChanged = false;
        if (!parsed.manufacturer) {
            const m = detectMfr(t);
            if (m) { parsed.manufacturer = m; structChanged = true; }
        }
        // profiles parse lowercased text — restore the spelling the user typed
        if (parsed.manufacturer) {
            const m = new RegExp('\\b' + parsed.manufacturer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').exec(t);
            if (m && m[0] !== parsed.manufacturer) { parsed.manufacturer = m[0]; structChanged = true; }
        }
        if (!parsed.mfrPartNo) {
            const pn = extractPartNo(t, parsed.manufacturer);
            if (pn) {
                parsed.mfrPartNo = pn;
                if (parsed.matTypeChoice === 'Generic') parsed.matTypeChoice = 'OEM';
                structChanged = true;
            }
        }
        // schema-driven attribute extraction — works for ANY category:
        // list attributes pick the option the text mentions, numeric attributes
        // read "<value> <unit>" next to a keyword derived from the field name
        const attrs = parsed.attributes = parsed.attributes || {};
        const schema = (window.UI && window.UI.categorySchema) ? window.UI.categorySchema(parsed.unspsc) : null;
        const schemaAttrs = (schema && schema.attributes) || [];
        const HINTS = {
            inner: 'id|bore|inner', bore: 'id|bore|inner', outer: 'od|outer', outside: 'od|outer',
            shaft: 'shaft|id|bore|inner', width: 'width|wide', length: 'length|long',
            height: 'height|high', thickness: 'thickness|thk', weight: 'weight',
            pitch: 'pitch', voltage: 'voltage', pressure: 'pressure|wp', diameter: 'diameter|dia'
        };
        Object.keys(attrs).forEach(k => {
            if (attrs[k]) return;
            const sa = schemaAttrs.find(a => (a.name || a) === k) || {};
            // 1) list field → the option mentioned in the text (longest option first)
            const opts = String(sa.options || '').split(',').map(s => s.trim()).filter(o => o.length > 1)
                .sort((a, b) => b.length - a.length);
            const optHit = opts.find(o => new RegExp('\\b' + o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\s+/g, '\\s+') + '\\b', 'i').test(t));
            if (optHit) { attrs[k] = optHit; return; }
            // 2) numeric field → value next to a keyword from the field name
            const unit = String(sa.uom || 'mm').toLowerCase();
            const kw = k.toLowerCase().split(/[^a-z]+/).map(w => HINTS[w]).find(Boolean);
            if (kw) {
                const v = dimNear(t, kw, unit);
                if (v) attrs[k] = v + ' ' + unit;
            }
        });
        // the identifiers changed → regenerate the MRO descriptions to include them
        if (structChanged && parsed.shortName) {
            const sd = structuredDesc(parsed, t);
            parsed.shortName = sd.shortName;
            parsed.longDesc = sd.longDesc;
        }
        return parsed;
    }

    /* ---- AI enrichment of MISSING data using real industry numbering rules.
       When the description omits the part number, it is derived from the
       provided attributes (and vice versa) — the derivations follow genuine
       standards, so the enriched data is real:
       · V-belts: SECTION+pitch length mm (SPB2360), light-duty L sections
         SECTION+length in tenths of inches (5L690 = 69.0")
       · Ball bearings: ISO 60/62/63 series from bore × OD (25×52 → 6205)
       · Tapered bearings: ISO 302xx series from bore × OD (30×62 → 30206) ---- */
    const BALL_SERIES = {
        10: { 26: '6000', 30: '6200', 35: '6300' }, 12: { 28: '6001', 32: '6201', 37: '6301' },
        15: { 32: '6002', 35: '6202', 42: '6302' }, 17: { 35: '6003', 40: '6203', 47: '6303' },
        20: { 42: '6004', 47: '6204', 52: '6304' }, 25: { 47: '6005', 52: '6205', 62: '6305' },
        30: { 55: '6006', 62: '6206', 72: '6306' }, 35: { 62: '6007', 72: '6207', 80: '6307' },
        40: { 68: '6008', 80: '6208', 90: '6308' }, 45: { 75: '6009', 85: '6209', 100: '6309' },
        50: { 80: '6010', 90: '6210', 110: '6310' }
    };
    const BALL_W = { 6000: 8, 6200: 9, 6300: 11, 6001: 8, 6201: 10, 6301: 12, 6002: 9, 6202: 11, 6302: 13,
        6003: 10, 6203: 12, 6303: 14, 6004: 12, 6204: 14, 6304: 15, 6005: 12, 6205: 15, 6305: 17,
        6006: 13, 6206: 16, 6306: 19, 6007: 14, 6207: 17, 6307: 21, 6008: 15, 6208: 18, 6308: 23,
        6009: 16, 6209: 19, 6309: 25, 6010: 16, 6210: 20, 6310: 27 };
    const TAPERED_SERIES = {
        25: { 52: '30205' }, 30: { 62: '30206' }, 35: { 72: '30207' }, 40: { 80: '30208' },
        45: { 85: '30209' }, 50: { 90: '30210' }, 55: { 100: '30211' }, 60: { 110: '30212' }, 85: { 150: '30217' }
    };
    const BALL_INV = {}, TAPERED_INV = {};
    Object.keys(BALL_SERIES).forEach(b => Object.keys(BALL_SERIES[b]).forEach(o => {
        BALL_INV[BALL_SERIES[b][o]] = [Number(b), Number(o), BALL_W[BALL_SERIES[b][o]] || null];
    }));
    Object.keys(TAPERED_SERIES).forEach(b => Object.keys(TAPERED_SERIES[b]).forEach(o => {
        TAPERED_INV[TAPERED_SERIES[b][o]] = [Number(b), Number(o)];
    }));

    function deriveEnrichment(parsed, raw) {
        const t = String(raw || '');
        const notes = [];
        const attrs = parsed.attributes = parsed.attributes || {};
        const num = (s) => { const m = String(s || '').match(/(\d+(?:[.,]\d+)?)/); return m ? parseFloat(m[1].replace(',', '.')) : null; };
        const get = (re) => { const k = Object.keys(attrs).find(x => re.test(x)); return k ? attrs[k] : ''; };
        const setIfEmpty = (re, val) => {
            const k = Object.keys(attrs).find(x => re.test(x));
            if (k && !attrs[k] && val) { attrs[k] = val; return true; }
            return false;
        };
        const isBelt = /belt/i.test(parsed.unspscLabel || '') || /\bbelt\b/i.test(t);
        const isBearing = /bearing/i.test(parsed.unspscLabel || '') || /\bbearing\b/i.test(t);

        let identOverride = '';   // compact code for the MRO short name when the
                                  // catalog designation itself carries spaces
        let catalogDerived = false;   // true when a REAL numbering standard produced the code
        if (!parsed.mfrPartNo && isBelt) {
            let sec = ((get(/section|profile/i) || (t.match(/\b(sp[abcz]|[345]l|p[hjklm])\b/i) || [])[0] || '')).replace(/\s+/g, '').toUpperCase();
            if (!sec) sec = ((t.match(/section\s+([abcd])\b/i) || [])[1] || '').toUpperCase();
            const lenMm = num(get(/length/i)) || num((t.match(/\b(\d{3,5})\s?mm\b/i) || [])[1]);
            const isSkf = /^skf$/i.test(parsed.manufacturer || '');   // SKF belts use the PHG catalog prefix
            if (sec && lenMm) {
                if (/^SP[ABCZ]$/.test(sec)) {
                    const base = sec + Math.round(lenMm);
                    const part = (isSkf ? 'PHG ' : '') + base;
                    parsed.mfrPartNo = part;
                    if (isSkf) identOverride = base;
                    catalogDerived = true;
                    notes.push(`Part number ${part} derived from belt section ${sec} + pitch length ${Math.round(lenMm)} mm (${isSkf ? 'SKF PHG series' : 'standard V-belt coding'})`);
                } else if (/^[345]L$/.test(sec)) {
                    // full FHP catalog designation: inch code + metric LA length,
                    // e.g. 5L 690 / 1753 LA (69.0" = 1753 mm)
                    const inchCode = Math.round(lenMm / 25.4 * 10);
                    const part = `${sec} ${inchCode} / ${Math.round(lenMm)} LA`;
                    parsed.mfrPartNo = part;
                    identOverride = sec + inchCode;
                    catalogDerived = true;
                    notes.push(`Part number ${part} derived from belt section ${sec} (${(inchCode / 10).toFixed(1)}″) + length ${Math.round(lenMm)} mm (FHP V-belt coding)`);
                } else if (/^[ABCD]$/.test(sec)) {
                    // classical wrapped V-belts: section + inside length in whole
                    // inches (991 mm = 39″ → A39). SKF lists these under the PHG
                    // prefix (PHG A39); others as section/inch + metric Li.
                    const li = num((t.match(/(\d{3,5})\s?mm\s*(?:length|li\b)/i) || [])[1]) || lenMm;
                    const inch = Math.round(li / 25.4);
                    const base = sec + inch;
                    const part = isSkf ? `PHG ${base}` : `${sec} ${inch} / ${Math.round(li)} LI`;
                    parsed.mfrPartNo = part;
                    identOverride = base;
                    catalogDerived = true;
                    notes.push(`Part number ${part} derived from classical section ${sec} + inside length ${Math.round(li)} mm (${inch}″) — ${isSkf ? 'SKF PHG series' : 'wrapped V-belt coding'}`);
                } else if (/^P[HJKLM]$/.test(sec)) {
                    // Poly-V ribbed belts: ribs + metric profile code, plus the
                    // inch-series equivalent — e.g. 4PJ559/220J (559 mm = 22.0″).
                    // 4 ribs is the standard stock width when none is specified.
                    const ribs = ((t.match(/(\d{1,2})\s*ribs?\b/i) || [])[1] || '4');
                    const mm = Math.round(lenMm);
                    const inch = Math.round(lenMm / 25.4 * 10);
                    const part = `${ribs}${sec}${mm}/${inch}${sec[1]}`;
                    parsed.mfrPartNo = part;
                    identOverride = `${ribs}${sec}${mm}`;
                    catalogDerived = true;
                    notes.push(`Part number ${part} derived from ${ribs} ribs × profile ${sec} + effective length ${mm} mm (${(inch / 10).toFixed(1)}″ = ${inch}${sec[1]}) — Poly-V ribbed belt coding`);
                }
            }
        }
        if (!parsed.mfrPartNo && isBearing) {
            const bore = num(get(/bore|inner/i)), od = num(get(/outside|outer/i));
            const tapered = /taper/i.test(t) || /taper/i.test(String(get(/model|bearing type/i)));
            const tbl = tapered ? TAPERED_SERIES : BALL_SERIES;
            if (bore && od && tbl[bore] && tbl[bore][od]) {
                let part = tbl[bore][od];
                if (!tapered) part += /2rs/i.test(t) ? '-2RS' : (/2z|zz/i.test(t) ? '-2Z' : '');
                parsed.mfrPartNo = part;
                catalogDerived = true;
                notes.push(`Part number ${part} derived from bore ${bore} mm × OD ${od} mm (ISO bearing series)`);
            }
        }
        // universal fallback: still no part number → compose a specification-based
        // designation from the item's identifying values, so EVERY item gets an
        // orderable code (clearly labeled as spec-derived, not a catalog number)
        if (!parsed.mfrPartNo) {
            const clean = (v) => String(v).replace(/\s*(mm|cm|kg|g|bar|kn|nm|°c)\b/gi, '')
                .replace(/\s+/g, '').toUpperCase();
            const vals = [];
            Object.keys(attrs).forEach(k => {
                if (vals.length >= 3) return;
                const v = String(attrs[k] || '').trim();
                if (v && /\d/.test(v) && v.length <= 14) vals.push(clean(v));
            });
            let code = vals.filter(Boolean).join('-');
            if (!code) {
                // last resort: size token + grade straight from the text
                const size = ((t.match(/\b([a-z]?\d{1,4}(?:[.,]\d+)?\s?[x×]\s?\d{1,4}(?:[.,]\d+)?)\b/i) || [])[1] || '');
                const grade = ((t.match(/grade\s*([\d.]+)/i) || [])[1] || '');
                code = [size ? clean(size).replace(/×/g, 'X') : '', grade].filter(Boolean).join('-');
            }
            if (code) {
                parsed.mfrPartNo = code;
                // synthetic spec code — must NOT influence duplicate matching,
                // a master record without a part number is still the same item
                parsed.specDerivedPart = true;
                notes.push(`Designation ${code} composed from the item's specification values — the description carries no catalog part number`);
            }
        }
        // reverse: part number known → fill missing dimensions from the series data
        if (parsed.mfrPartNo && isBearing) {
            const bm = parsed.mfrPartNo.match(/\b(6[0-3]\d{2})\b/);
            const tm = parsed.mfrPartNo.match(/\b(30\d{3})\b/);
            if (bm && BALL_INV[bm[1]]) {
                const [b, o, w] = BALL_INV[bm[1]];
                let did = setIfEmpty(/bore|inner/i, b + ' mm');
                did = setIfEmpty(/outside|outer/i, o + ' mm') || did;
                did = (w && setIfEmpty(/width/i, w + ' mm')) || did;
                if (did) notes.push(`Dimensions ${b}×${o}${w ? '×' + w : ''} mm filled from ISO bearing series ${bm[1]}`);
            } else if (tm && TAPERED_INV[tm[1]]) {
                const [b, o] = TAPERED_INV[tm[1]];
                let did = setIfEmpty(/bore|inner/i, b + ' mm');
                did = setIfEmpty(/outside|outer/i, o + ' mm') || did;
                did = setIfEmpty(/shaft/i, b + ' mm') || did;
                if (did) notes.push(`Dimensions ${b}×${o} mm filled from ISO tapered series ${tm[1]}`);
            }
        }
        if (parsed.mfrPartNo && isBelt) {
            const lb = parsed.mfrPartNo.match(/^([345]L)(\d{3})$/i);
            if (lb) {
                const lenMm = Math.round(parseInt(lb[2], 10) / 10 * 25.4);
                if (setIfEmpty(/length/i, lenMm + ' mm')) {
                    notes.push(`Length ${lenMm} mm filled from belt code ${parsed.mfrPartNo} (${(parseInt(lb[2], 10) / 10).toFixed(1)}″)`);
                }
            }
        }
        if (notes.length) {
            // only a REAL catalog code implies an OEM part — spec designations stay Generic
            if (parsed.matTypeChoice === 'Generic' && parsed.mfrPartNo && catalogDerived) parsed.matTypeChoice = 'OEM';
            parsed.enrichedNotes = notes;
            if (parsed.shortName) {
                // the short name uses the compact code; the long description
                // carries the full catalog designation
                const sd = structuredDesc(identOverride
                    ? Object.assign({}, parsed, { mfrPartNo: identOverride }) : parsed, t);
                parsed.shortName = sd.shortName;
                if (identOverride) {
                    const full = structuredDesc(parsed, t);
                    parsed.longDesc = full.longDesc.replace(full.shortName, sd.shortName);
                } else {
                    parsed.longDesc = sd.longDesc;
                }
            }
        }
        return notes;
    }

    const PROFILES = [
        {
            match: (t) => /belt/.test(t) && (/wedge|ve+\s*belt|v[- ]?belt|poly\s*-?\s*v|ribbed|\bsp[abcz]\b|\b[345]l\b|\bp[hjklm]\b/.test(t)),
            build: (t) => {
                // SP sections carry the pitch length in the code (SPC2500); light-duty
                // L codes are 3 digits = length in tenths of inches (5L690 = 69.0");
                // Poly-V ribbed profiles are PH/PJ/PK/PL/PM
                const partU = ((t.match(/\bsp[abcz]\s?-?\d{3,5}\b/i) || [])[0] ||
                               (t.match(/\b[345]l\s?-?\d{3}\b(?!\d)/i) || [])[0] || '').replace(/[\s-]+/g, '').toUpperCase();
                const section = ((partU.match(/^(SP[ABCZ]|[345]L)/) || [])[0]) ||
                    ((t.match(/\b(sp[abcz]|[345]l|p[hjklm])\b/i) || [])[0] || '').replace(/\s+/g, '').toUpperCase() ||
                    ((t.match(/section\s+([abcd])\b/i) || [])[1] || '').toUpperCase();   // classical A/B/C/D
                const isL = /^[345]L/.test(section);
                const isPoly = /^P[HJKLM]$/.test(section) || /poly\s*-?\s*v|ribbed/i.test(t);
                const isClassical = /^[ABCD]$/.test(section);
                let len = (/^SP/.test(partU) ? (partU.match(/\d{3,5}/) || [])[0] : '') ||
                    ((t.match(/pitch\s*length\s*(\d{3,5})/i) || [])[1] || '') ||
                    ((t.match(/\b(\d{3,5})\s?mm\b/i) || [])[1] || '');
                if (!len && isL && partU) len = String(Math.round(parseInt((partU.match(/\d{3}/) || ['0'])[0], 10) / 10 * 25.4));
                const btype = isPoly ? 'Poly-V ribbed belt' : (isL ? 'Light-duty V-belt (FHP)'
                    : (isClassical ? 'Classical wrapped V-belt' : 'Wedge V-belt'));
                const mfr = detectMfr(t);
                const width = dimNear(t, 'top width|width');
                const short = mroShort('Belt', isPoly ? 'Poly-V' : 'V', partU || (len ? len : ''));
                const isDemoSkf = partU === 'SPC2500';   // the seeded master item
                return {
                    summary: btype + (mfr ? ', ' + mfr : '') + (partU ? ' ' + partU : '') +
                        (section ? ', Section ' + section : '') + (len ? ', Pitch Length ' + len + ' mm' : ''),
                    unspsc: '26111801', unspscLabel: 'V belts', category: 'V belts', materialGroup: 'M008.0001',
                    manufacturer: mfr, mfrPartNo: partU, matTypeChoice: partU ? 'OEM' : 'Generic', baseUom: 'EA',
                    name: 'Belt; ' + btype + (mfr ? ', ' + mfr : '') + (partU ? ', ' + partU : ''),
                    shortName: short,
                    longDesc: mroLong(short,
                        [btype, section ? 'Section ' + section : '', len ? 'Pitch length ' + len + 'mm' : '',
                         width ? 'Top width ' + width + 'mm' : ''], mfr, partU),
                    attributes: {
                        'Belt profile/section': section, 'Belt type': btype,
                        'Belt properties': isDemoSkf ? 'Cogged' : '',
                        'Top width': width ? width + ' mm' : (isDemoSkf ? '22 mm' : ''),
                        'Wrapped cover': isDemoSkf ? 'Yes' : '', 'Construction': isDemoSkf ? 'Wrapped' : '',
                        'Effective length (Lw/Lp)': len ? len + ' mm' : '',
                        'Inner length (Li)': isDemoSkf ? '2416 mm' : '', 'Outer length (La)': isDemoSkf ? '2529 mm' : '',
                        'Belt body material': isDemoSkf ? 'CR (polychloroprene)' : '',
                        'Tensile cord material': isDemoSkf ? 'Polyester' : '',
                        'Sub-brand': /phg/i.test(t) ? 'PHG' : '', 'Product net weight': isDemoSkf ? '0.81 kg' : ''
                    }
                };
            }
        },
        {
            // tapered roller bearings — their own catalog category (31171516)
            match: (t) => /taper(ed)?\s*(roller\s*)?bearing|bearing.*taper/i.test(t),
            build: (t) => {
                const part = (t.match(/\b([a-z]{0,2}3[0-2]\d{3}[a-z0-9]{0,3})\b/i) || [])[1] || '';
                const mfr = detectMfr(t);
                const id = dimNear(t, 'id|bore|inner');
                const od = dimNear(t, 'od|outer');
                const row = /double\s*row/i.test(t) ? 'Double row' : 'Single row';
                const short = mroShort('Bearing', 'Tapered', part.toUpperCase() || (id && od ? id + 'X' + od : ''));
                return {
                    summary: 'Tapered roller bearing' + (part ? ', ' + part.toUpperCase() : '') +
                        (id ? ', ID ' + id + ' mm' : '') + (od ? ', OD ' + od + ' mm' : ''),
                    unspsc: '31171516', unspscLabel: 'Tapered bearings', category: 'Tapered bearings', materialGroup: 'M005.0004',
                    manufacturer: mfr, mfrPartNo: part.toUpperCase(),
                    matTypeChoice: part ? 'OEM' : 'Generic', baseUom: 'EA',
                    name: 'Tapered roller bearing; ' + row + (part ? ', ' + part.toUpperCase() : ''),
                    shortName: short,
                    longDesc: mroLong(short, ['Tapered roller', row, id ? 'ID ' + id + 'mm' : '', od ? 'OD ' + od + 'mm' : ''], mfr, part.toUpperCase()),
                    attributes: {
                        'Model': 'Tapered roller bearing',
                        'Inner diameter': id ? id + ' mm' : '',
                        'Outer diameter': od ? od + ' mm' : '',
                        'Suitable for shaft diameter': id ? id + ' mm' : ''
                    }
                };
            }
        },
        {
            match: (t) => /(ball|roller)\s*bearing|bearing/.test(t),
            build: (t) => {
                const part = (t.match(/\b([0-9]{3,4}-?2rs[a-z0-9]*|[0-9]{3,4}-?2z[a-z0-9]*|[0-9]{3,4}vv[a-z0-9]*|6\d{2,3}|60\d{2}|30\d{2,3})\b/i) || [])[0] || '';
                const d = dims3(t);
                const mfr = detectMfr(t);
                const seal = /2rs/i.test(t) ? '2RS contact seal' : (/2z|zz/i.test(t) ? '2Z metal shields' : (/vv/i.test(t) ? 'VV non-contact seal' : 'Open'));
                const clr = (/c3/i.test(t) ? 'C3' : (/c4/i.test(t) ? 'C4' : 'CN')) + ' clearance';
                const btype = /needle/i.test(t) ? 'Needle roller bearing'
                    : /angular\s*contact/i.test(t) ? 'Angular contact ball bearing'
                    : /cylindrical/i.test(t) ? 'Cylindrical roller bearing'
                    : /spherical/i.test(t) ? 'Spherical roller bearing'
                    : 'Deep groove ball bearing';
                const row = /double\s*row/i.test(t) ? 'Double row' : 'Single row';
                const short = mroShort('Bearing', 'Ball', part || (d.length ? d.join('X') : ''));
                return {
                    summary: row + ' ' + btype.toLowerCase() + (part ? ', ' + part.toUpperCase() : ''),
                    unspsc: '31171504', unspscLabel: 'Ball bearings', category: 'Roller bearings', materialGroup: 'M005.0004',
                    manufacturer: mfr,
                    mfrPartNo: part.toUpperCase(), matTypeChoice: part ? 'OEM' : 'Generic', baseUom: 'EA',
                    name: btype + '; ' + row + (part ? ', ' + part.toUpperCase() : ''),
                    shortName: short,
                    longDesc: mroLong(short, [btype, row, d.length ? d.map(x => x + 'mm').join(' X ') : '', seal, clr], mfr, part.toUpperCase()),
                    attributes: {
                        'Bearing type': btype, 'Row count': row,
                        'Bore diameter': d[0] ? d[0] + ' mm' : '', 'Outside diameter': d[1] ? d[1] + ' mm' : '', 'Width': d[2] ? d[2] + ' mm' : '',
                        'Seal/shield type': /2rs/i.test(t) ? '2RS (contact seals)' : (/2z|zz/i.test(t) ? '2Z (metal shields)' : (/vv/i.test(t) ? 'VV (non-contact seals)' : 'Open')),
                        'Internal clearance': /c3/i.test(t) ? 'C3' : (/c4/i.test(t) ? 'C4' : 'CN'),
                        'Cage material': 'Steel'
                    }
                };
            }
        },
        {
            match: (t) => /(gate|ball|check|globe)\s*valve|valve/.test(t),
            build: (t) => {
                const part = (t.match(/\b(gv[- ]?\d{2,4}[- ]?pn\d{1,3}|[a-z]{1,3}-?\d{2,4}-?pn\d{1,3})\b/i) || [])[0] || '';
                const size = firstMatch(t, /\bdn\s?\d{2,4}\b/i) || firstMatch(t, /\b\d{2,4}\s?mm\b/i);
                const pn = firstMatch(t, /\bpn\s?\d{1,3}\b/i);
                const body = /stainless/i.test(t) ? 'Stainless steel' : (/cast iron/i.test(t) ? 'Cast iron' : 'Cast steel');
                const short = mroShort('Valve', 'Gate', (size || part || '').replace(/\s+/g, ''));
                return {
                    summary: 'Gate valve, cast steel, flanged' + (part ? ', ' + part.toUpperCase() : ''),
                    unspsc: '40141607', unspscLabel: 'Gate valves', category: 'Pipeline fittings', materialGroup: 'M007.0002',
                    manufacturer: '', mfrPartNo: part.toUpperCase(), matTypeChoice: 'Generic', baseUom: 'EA',
                    name: 'Gate valve; Cast steel, flanged',
                    shortName: short,
                    longDesc: mroLong(short, [body, 'Flanged ends', size, pn, /gear/i.test(t) ? 'Gear operated' : 'Handwheel operated'], '', part.toUpperCase()),
                    attributes: {
                        'Nominal size': size ? size.toUpperCase().replace(/\s/, '') : '',
                        'Pressure rating': pn ? pn.toUpperCase().replace(/\s/, '') : '',
                        'Body material': /stainless/i.test(t) ? 'Stainless steel' : (/cast iron/i.test(t) ? 'Cast iron' : 'Cast steel'),
                        'End connection': /thread/i.test(t) ? 'Threaded' : (/weld/i.test(t) ? 'Butt-weld' : 'Flanged'),
                        'Operation': /gear/i.test(t) ? 'Gear operated' : (/actuat/i.test(t) ? 'Actuated' : 'Handwheel'),
                        'Bonnet type': 'Bolted bonnet',
                        'Stem type': /non-?rising/i.test(t) ? 'Non-rising stem' : 'Rising stem',
                        'Standard': 'API 600'
                    }
                };
            }
        },
        {
            match: (t) => /electrode|welding\s*rod/.test(t),
            build: (t) => {
                const dia = (t.match(/\b(\d(?:\.\d)?)\s?mm\b/) || [])[1] || '';
                const aws = firstMatch(t, /\be\d{4}-?[a-z0-9]*\b/i);
                const emfr = /esab/i.test(t) ? 'ESAB' : (/lincoln/i.test(t) ? 'Lincoln Electric' : '');
                const epn = firstMatch(t, /\bok\s?\d{2}\.\d{2}\b/i).toUpperCase();
                const short = mroShort('Electrode', 'Welding', aws || (dia ? dia + 'MM' : ''));
                return {
                    summary: 'Welding electrode, flux-coated' + (aws ? ', ' + aws.toUpperCase() : ''),
                    unspsc: '23271807', unspscLabel: 'Welding electrodes', category: 'Metal products', materialGroup: 'M002.0002',
                    manufacturer: emfr,
                    mfrPartNo: epn, matTypeChoice: 'OEM', baseUom: 'KG',
                    name: 'Welding electrode; flux-coated', shortName: short,
                    longDesc: mroLong(short, ['Flux-coated', dia ? dia + 'mm' : '', aws, /dc/i.test(t) ? 'DC+' : 'AC/DC', 'Vacuum pack'], emfr, epn),
                    attributes: {
                        'Electrode diameter': dia ? dia + ' mm' : '',
                        'Electrode length': /300/.test(t) ? '300 mm' : '350 mm',
                        'AWS classification': aws ? aws.toUpperCase() : '',
                        'Coating': 'Flux-coated (basic)',
                        'Current type': /dc/i.test(t) ? 'DC+' : 'AC/DC',
                        'Packaging': 'Vacuum pack',
                        'Alloy composition': /cr/i.test(t) ? 'Cr-Mo alloy' : 'Carbon steel',
                        'Welding position': 'All positions'
                    }
                };
            }
        },
        {
            match: (t) => /patch\s*cord|cat\s?6|cat\s?5|ethernet\s*cable|utp|ftp/.test(t),
            build: (t) => {
                const len = (t.match(/\b(\d+(?:\.\d+)?)\s?m\b/) || [])[1] || '';
                const cat = firstMatch(t, /\bcat\s?\d[a-z]?\b/i);
                const cmfr = /shturmann/i.test(t) ? 'SHTURMANN' : '';
                const cshort = mroShort('Cord', 'Patch', cat ? cat.replace(/\s+/g, '') : '');
                return {
                    summary: 'Datacom patch cord' + (cat ? ', ' + cat.toUpperCase() : ''),
                    unspsc: '26121636', unspscLabel: 'Patch cords', category: 'Control cables', materialGroup: 'M010.0002',
                    manufacturer: cmfr, mfrPartNo: '', matTypeChoice: 'Commercial', baseUom: 'EA',
                    name: 'Datacom patch cord' + (cat ? ', ' + cat.toUpperCase() : ''), shortName: cshort,
                    longDesc: mroLong(cshort, ['Datacom', /ftp/i.test(t) ? 'FTP' : (/utp/i.test(t) ? 'UTP' : 'FTP'), len ? len + 'm' : '', 'RJ45', '26 AWG'], cmfr, ''),
                    attributes: {
                        'Category': cat ? cat.toUpperCase().replace(/\s/, '') : 'CAT6',
                        'Shielding': /ftp/i.test(t) ? 'FTP' : (/utp/i.test(t) ? 'UTP' : 'FTP'),
                        'Length': len ? len + ' m' : '',
                        'Conductor': 'Stranded bare copper',
                        'Insulation': 'PE',
                        'Connector type': 'RJ45',
                        'Conductor gauge': '26 AWG',
                        'Jacket colour': 'Grey'
                    }
                };
            }
        },
        {
            // Hydraulic hose — intentionally NOT in the seeded category catalog, to show a
            // newly-identified category being added to the catalog on search.
            match: (t) => /hydraulic\s*hose|\bhose\b/.test(t),
            build: (t) => {
                const id = firstMatch(t, /\bdn\s?\d{1,3}\b/i) || firstMatch(t, /\b\d\/\d\s?in\b/i) || firstMatch(t, /\b\d{1,2}\s?mm\b/i);
                const manu = /parker/i.test(t) ? 'Parker' : (/gates/i.test(t) ? 'Gates' : (/manuli/i.test(t) ? 'Manuli' : ''));
                const hpn = firstMatch(t, /\b\d{3}[a-z]{2}-?\d{1,2}\b/i).toUpperCase();
                const hshort = mroShort('Hose', 'Hydraulic', (id || '').replace(/\s+/g, ''));
                return {
                    summary: 'Hydraulic hose, wire-braided' + (id ? ', ' + id.toUpperCase() : ''),
                    unspsc: '40142303', unspscLabel: 'Hydraulic hoses', category: 'Hoses', materialGroup: 'M008.0003',
                    manufacturer: manu, mfrPartNo: hpn,
                    matTypeChoice: manu ? 'OEM' : 'Generic', baseUom: 'M',
                    name: 'Hydraulic hose; wire-braided' + (id ? ', ' + id.toUpperCase() : ''), shortName: hshort,
                    longDesc: mroLong(hshort, ['Wire-braided', id, /two|2\s*wire|2-wire/i.test(t) ? 'Two-wire braid' : 'One-wire braid', '250 bar', 'EN 853'], manu, hpn),
                    attributes: {
                        'Inner diameter': id ? id.toUpperCase() : '',
                        'Reinforcement': /two|2\s*wire|2-wire/i.test(t) ? 'Two-wire braid' : 'One-wire braid',
                        'Working pressure': '250 bar',
                        'Burst pressure': '1000 bar',
                        'Tube material': 'Synthetic rubber (NBR)',
                        'Cover material': 'Abrasion-resistant rubber',
                        'Temperature range': '-40 to +100 °C',
                        'Standard': 'EN 853'
                    }
                };
            }
        }
    ];

    /* ---- generic fallback parse ---- */
    function genericParse(text) {
        const t = text.trim();
        // heuristic manufacturer / part-no extraction (shared with enrichment,
        // so thread sizes like M16 are not mistaken for part numbers)
        const partNo = extractPartNo(t, detectMfr(t)) || '';
        // MRO-structured descriptions, same shape as the mastered records:
        // noun = last domain-recognised word, qualifier = the word before it,
        // ident = part number or size token, specs = the remaining text
        const words = t.split(/\s+/);
        let nounIdx = -1;
        words.forEach((w, i) => { if (CAT_DOMAINS.some(d => d.re.test(w.toLowerCase()))) nounIdx = i; });
        let noun = (nounIdx !== -1 ? words[nounIdx] : (words[0] || 'Item')).replace(/[^A-Za-z-]/g, '');
        let qual = nounIdx > 0 ? words[nounIdx - 1].replace(/[^A-Za-z0-9-]/g, '') : '';
        // "insulating tape" — a domain word ending in -ing qualifies the noun that follows it
        if (/ing$/i.test(noun) && nounIdx !== -1 && nounIdx + 1 < words.length) {
            const nxt = words[nounIdx + 1].replace(/[^A-Za-z-]/g, '');
            if (nxt && /^[A-Za-z-]+$/.test(words[nounIdx + 1].replace(/[.,;]$/, '')) && !CAT_STOP.has(nxt.toLowerCase())) { qual = noun; noun = nxt; }
        }
        if (!/[a-z]/i.test(qual) || CAT_STOP.has(qual.toLowerCase())) qual = '';
        const sizeTok = firstMatch(t, /\b[a-z]?\d{1,4}(?:\.\d+)?\s?[x×]\s?\d{1,4}(?:\.\d+)?(?:\s?[x×]\s?\d{1,4}(?:\.\d+)?)?\b/i);
        const short = mroShort(noun, qual, partNo || sizeTok);
        let rest = ' ' + t + ' ';
        [noun, qual, partNo, sizeTok].filter(Boolean).forEach(w => { rest = rest.split(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).join(' '); });
        const specs = rest.split(/[,;]+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 1);
        return {
            summary: t.slice(0, 90) + (t.length > 90 ? '…' : ''),
            unspsc: '', unspscLabel: '', category: '', materialGroup: '',   // no category → category_missing
            manufacturer: '', mfrPartNo: partNo, matTypeChoice: 'Generic', baseUom: 'EA',
            name: t.slice(0, 120), shortName: short, longDesc: mroLong(short, specs, '', partNo),
            attributes: {}
        };
    }

    /* ---- canonical MRO descriptions for ANY payload — applied when an item is
       mastered so every new record matches the structure of the existing master
       (noun/qualifier from the category label or the typed text, ident from the
       part number or a size token, specs from the attribute values) ---- */
    function structuredDesc(p, rawText) {
        p = p || {};
        let text = String(rawText || p.shortName || p.name || '');
        if (!/[a-z]/.test(text) && p.name) text = String(p.name);   // already MRO-coded → derive from the readable name
        let noun = '', qual = '';
        const label = String(p.unspscLabel || '').trim();
        if (label) {
            const lw = label.split(/\s+/);
            noun = lw[lw.length - 1].replace(/ies$/i, 'y').replace(/s$/i, '');
            if (lw.length > 1 && lw[0].toLowerCase() !== noun.toLowerCase()) qual = lw[0];
        } else {
            const words = text.split(/\s+/);
            let nounIdx = -1;
            words.forEach((w, i) => { if (CAT_DOMAINS.some(d => d.re.test(w.toLowerCase()))) nounIdx = i; });
            noun = (nounIdx !== -1 ? words[nounIdx] : (words[0] || 'Item')).replace(/[^A-Za-z-]/g, '');
            qual = nounIdx > 0 ? words[nounIdx - 1].replace(/[^A-Za-z0-9-]/g, '') : '';
            // "Solenoid valve …" — no domain word, but the second word is a plain noun
            if (nounIdx === -1 && words.length > 1) {
                const w1 = words[1].replace(/[.,;]$/, '');
                if (/^[a-z-]+$/.test(w1) && !CAT_STOP.has(w1)) { noun = w1; qual = words[0].replace(/[^A-Za-z0-9-]/g, ''); }
            }
            // "insulating tape" / "wire rope" — the domain word qualifies the plain
            // lowercase noun that follows it (capitalised words are brands, digits are specs)
            if (nounIdx !== -1 && nounIdx + 1 < words.length) {
                const raw = words[nounIdx + 1].replace(/[.,;]$/, '');
                if ((/ing$/i.test(noun) || /^[a-z-]+$/.test(raw)) && /^[A-Za-z-]+$/.test(raw) &&
                    (/^[a-z]/.test(raw) || /ing$/i.test(noun)) && !CAT_STOP.has(raw.toLowerCase())) { qual = noun; noun = raw; }
            }
            if (!/[a-z]/i.test(qual) || CAT_STOP.has(qual.toLowerCase())) qual = '';
        }
        const sizeTok = firstMatch(text, /\b[a-z]?\d{1,4}(?:\.\d+)?\s?[x×]\s?\d{1,4}(?:\.\d+)?(?:\s?[x×]\s?\d{1,4}(?:\.\d+)?)?\b/i);
        const ident = p.mfrPartNo || sizeTok || '';
        const short = mroShort(noun, qual, ident);
        const mfr = (p.manufacturer && p.manufacturer.trim().toLowerCase() !== 'various') ? p.manufacturer.trim() : '';
        let specs = Object.keys(p.attributes || {}).map(k => p.attributes[k])
            .filter(v => v && String(v).trim() && String(v).toUpperCase() !== String(ident).toUpperCase());
        if (!specs.length) {
            // no attribute values yet — take the specs from the remaining typed text
            let rest = ' ' + text + ' ';
            [noun, qual, ident, mfr].filter(Boolean).forEach(w => {
                rest = rest.split(new RegExp(String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).join(' ');
            });
            specs = rest.split(/[,;]+/).map(s => s.replace(/\s+/g, ' ').trim())
                // drop leftover fragments (stray plural "s", dashes, single letters)
                .filter(s => s.replace(/[^A-Za-z0-9]/g, '').length >= 2);
        }
        return { shortName: short, longDesc: mroLong(short, specs, mfr, p.mfrPartNo || '') };
    }

    /* ---- NEW-category proposal: when no catalog category matches, the AI still
       identifies what the item IS and proposes a category (label + UNSPSC) plus
       an attribute schema for it. Deterministic and keyword-driven. ---- */
    const mkA = (name, fieldType, uom, mandatory, options) =>
        ({ name, fieldType: fieldType || 'Text', uom: uom || '', mandatory: !!mandatory, options: options || '' });

    const CAT_DOMAINS = [
        { re: /insulat|bushing|dielectric/, label: 'Electrical insulators', prefix: '3912', attrs: [
            mkA('Rated voltage', 'Number', '', true), mkA('Material', 'List', '', true, 'Ceramic, Porcelain, Composite, Glass'),
            mkA('Creepage distance', 'Number', 'MM'), mkA('Mounting type', 'List', '', false, 'Pin, Post, Suspension, Bushing') ] },
        { re: /bolt|screw|nut\b|washer|stud|rivet|fastener/, label: 'Fasteners', prefix: '3116', attrs: [
            mkA('Thread size', 'Text', '', true), mkA('Length', 'Number', 'MM', true), mkA('Material grade', 'Text', '', true),
            mkA('Coating', 'List', '', false, 'Zinc plated, Hot-dip galvanised, Black oxide, Plain'), mkA('Head type', 'Text') ] },
        { re: /gasket|o-?ring|seal\b|sealing|packing/, label: 'Seals & gaskets', prefix: '3117', attrs: [
            mkA('Inner diameter', 'Number', 'MM', true), mkA('Outer diameter', 'Number', 'MM'), mkA('Thickness', 'Number', 'MM'),
            mkA('Material', 'List', '', true, 'NBR, FKM, EPDM, PTFE, Graphite') ] },
        { re: /cable|wire\b|conductor/, label: 'Cables & wires', prefix: '2612', attrs: [
            mkA('Conductor cross-section', 'Number', 'MM', true), mkA('Number of cores', 'Number', '', true), mkA('Rated voltage', 'Number'),
            mkA('Insulation material', 'List', '', false, 'PVC, XLPE, Rubber, Silicone'), mkA('Shielded', 'Yes/No') ] },
        { re: /fuse|breaker|relay|contactor|switchgear|switch\b/, label: 'Electrical protection & switching', prefix: '3912', attrs: [
            mkA('Rated current', 'Number', '', true), mkA('Rated voltage', 'Number', '', true), mkA('Number of poles', 'Number'),
            mkA('Mounting', 'List', '', false, 'DIN rail, Panel, Plug-in'), mkA('Breaking capacity', 'Number') ] },
        { re: /filter|cartridge|strainer/, label: 'Filters', prefix: '4016', attrs: [
            mkA('Filtration rating', 'Number', '', true), mkA('Filter media', 'List', '', true, 'Cellulose, Glass fibre, Metal mesh, Synthetic'),
            mkA('Connection size', 'Text'), mkA('Max flow rate', 'Number'), mkA('Collapse pressure', 'Number') ] },
        { re: /pump\b|pumps\b/, label: 'Pumps', prefix: '4015', attrs: [
            mkA('Flow rate', 'Number', '', true), mkA('Head', 'Number', 'M', true), mkA('Power', 'Number', '', true),
            mkA('Speed', 'Number'), mkA('Inlet/outlet size', 'Text'), mkA('Casing material', 'Text') ] },
        { re: /\bmotor\b|gearbox|drive unit/, label: 'Electric motors & drives', prefix: '2610', attrs: [
            mkA('Power', 'Number', '', true), mkA('Speed', 'Number', '', true), mkA('Voltage', 'Number', '', true),
            mkA('Frame size', 'Text'), mkA('Efficiency class', 'List', '', false, 'IE1, IE2, IE3, IE4'),
            mkA('Mounting arrangement', 'List', '', false, 'B3, B5, B14, B35') ] },
        { re: /pipe\b|tube\b|fitting|flange|elbow|\btee\b|coupling|nipple/, label: 'Pipes & fittings', prefix: '4017', attrs: [
            mkA('Nominal diameter (DN)', 'Number', 'MM', true), mkA('Pressure rating (PN)', 'Number', '', true),
            mkA('Material', 'List', '', true, 'Carbon steel, Stainless steel, PVC, Copper'),
            mkA('End connection', 'List', '', false, 'Welded, Threaded, Flanged, Grooved'), mkA('Wall thickness', 'Number', 'MM') ] },
        { re: /\boil\b|grease|lubricant/, label: 'Lubricants', prefix: '1512', attrs: [
            mkA('Viscosity grade', 'Text', '', true), mkA('Base oil type', 'List', '', true, 'Mineral, Synthetic, Semi-synthetic'),
            mkA('NLGI grade', 'Text'), mkA('Operating temperature range', 'Range'), mkA('Package size', 'Number', 'L') ] },
        { re: /wrench|spanner|hammer|drill\b|screwdriver|plier|chisel|hand tool/, label: 'Hand tools', prefix: '2711', attrs: [
            mkA('Size', 'Text', '', true), mkA('Drive size', 'Text'), mkA('Material', 'Text'), mkA('Finish', 'Text') ] },
        { re: /acid\b|solvent|paint\b|adhesive|sealant|chemical|inhibitor|degreaser/, label: 'Chemicals & coatings', prefix: '1210', attrs: [
            mkA('Chemical composition', 'Text', '', true), mkA('Concentration', 'Number', '', true),
            mkA('Package size', 'Number', 'L'), mkA('Hazard class', 'Text'), mkA('Shelf life', 'Number') ] },
        { re: /sensor|gauge|transmitter|thermometer|manometer|flowmeter|indicator/, label: 'Instrumentation', prefix: '4111', attrs: [
            mkA('Measuring range', 'Range', '', true), mkA('Accuracy', 'Number'),
            mkA('Output signal', 'List', '', true, '4–20 mA, 0–10 V, Digital'), mkA('Process connection', 'Text'), mkA('Display', 'Yes/No') ] }
    ];

    const CAT_STOP = new Set(['high', 'low', 'heavy', 'duty', 'with', 'for', 'and', 'the', 'type', 'set', 'new', 'industrial', 'spare', 'part', 'parts']);

    /* ---- real UNSPSC reference: genuine codes & titles for common MRO families.
       The AI only ever proposes categories from this list — it never invents a
       code or a label. First match wins, so specific entries come before broad
       ones. Items matching nothing are left for the Central team to classify. ---- */
    const UNSPSC_REF = [
        { re: /ball\s*bearing/, code: '31171504', label: 'Ball bearings' },
        { re: /roller\s*bearing|taper(ed)?\s*bearing|needle\s*bearing|\bbearing/, code: '31171500', label: 'Bearings' },
        { re: /v-?\s?belt|wedge\s*belt|drive\s*belt|timing\s*belt|\bbelts?\b/, code: '26111800', label: 'Belts' },
        { re: /gate\s*valve/, code: '40141607', label: 'Gate valves' },
        { re: /\bvalve\b/, code: '40141600', label: 'Valves' },
        { re: /hydraulic\s*hose|\bhose\b/, code: '40142200', label: 'Hoses' },
        { re: /\bbolts?\b|anchor\s*bolt/, code: '31161600', label: 'Bolts' },
        { re: /\bscrews?\b/, code: '31161500', label: 'Screws' },
        { re: /\bnuts?\b/, code: '31161700', label: 'Nuts' },
        { re: /\bwashers?\b/, code: '31161800', label: 'Washers' },
        { re: /rivet|\bstud\b|fastener/, code: '31160000', label: 'Hardware' },
        { re: /gasket/, code: '31181500', label: 'Gaskets' },
        { re: /o-?ring|\bseal\b|sealing|packing/, code: '31181600', label: 'Seals' },
        { re: /power\s*cable|control\s*cable|\bcable\b/, code: '26121600', label: 'Electrical cables and accessories' },
        { re: /\bwire\b|conductor/, code: '26121500', label: 'Electrical wire' },
        { re: /circuit\s*breaker|\bmcb\b|\bbreaker\b/, code: '39121601', label: 'Circuit breakers' },
        { re: /\bfuse\b|relay|contactor|switchgear|\bswitch\b/, code: '39121600', label: 'Circuit protection devices and accessories' },
        { re: /capacitor/, code: '32121500', label: 'Capacitors' },
        { re: /filter|cartridge|strainer/, code: '40161500', label: 'Filters' },
        { re: /\bpumps?\b/, code: '40151500', label: 'Pumps' },
        { re: /electric\s*motor|\bmotor\b|gearbox/, code: '26101100', label: 'Electric motors' },
        { re: /\bpipe\b|\btube\b/, code: '40171500', label: 'Commercial pipe and piping' },
        { re: /fitting|flange|elbow|\btee\b|coupling|nipple/, code: '40170000', label: 'Pipe piping and pipe fittings' },
        { re: /\boil\b|grease|lubricant/, code: '15121500', label: 'Lubricating preparations' },
        { re: /wrench|spanner|screwdriver|plier|chisel|hammer|hand\s*tool|drill\s*bit/, code: '27110000', label: 'Hand tools' },
        { re: /paint\b|primer|varnish/, code: '31211500', label: 'Paints and primers' },
        { re: /adhesive|sealant|glue/, code: '31201600', label: 'Adhesives' },
        { re: /solvent|degreaser|\bacid\b|inhibitor|chemical/, code: '12191500', label: 'Solvents' },
        { re: /sensor|transmitter|transducer/, code: '41112100', label: 'Transducers' },
        { re: /gauge|manometer|thermometer|flowmeter|indicator|\bmeter\b/, code: '41110000', label: 'Measuring and observing and testing instruments' },
        { re: /welding\s*(electrode|rod|wire)|electrode/, code: '23271800', label: 'Welding and soldering and brazing supplies' },
        { re: /\blamp\b|\bbulb\b|luminaire|floodlight|light\s*fitting/, code: '39101600', label: 'Lamps and lightbulbs' },
        { re: /batter(y|ies)|accumulator/, code: '26111700', label: 'Batteries and cells and accessories' },
        { re: /insulator|bushing|dielectric/, code: '39120000', label: 'Electrical equipment and components and supplies' }
    ];

    function suggestCategory(rawText) {
        const t = (rawText || '').trim().toLowerCase();
        // only REAL UNSPSC categories are ever proposed; when nothing fits, the AI
        // proposes nothing and the item is classified manually by the Central team
        const ref = UNSPSC_REF.find(r => r.re.test(t));
        if (!ref) return null;
        const domain = CAT_DOMAINS.find(d => d.re instanceof RegExp ? d.re.test(t) : false) || null;

        // attribute schema: domain attrs + description-driven signals + base set
        const attrs = [];
        const addAttr = (a) => { if (!attrs.some(x => x.name.toLowerCase() === a.name.toLowerCase())) attrs.push(a); };
        (domain ? domain.attrs : []).forEach(a => addAttr(Object.assign({}, a)));
        if (/\d\s*k?v\b|volt/i.test(t)) addAttr(mkA('Rated voltage', 'Number'));
        if (/\bbar\b|\bpn\s?\d|pressure|psi/i.test(t)) addAttr(mkA('Pressure rating', 'Number'));
        if (/temperatur|°c|celsius|heat resist/i.test(t)) addAttr(mkA('Operating temperature range', 'Range'));
        if (/\bmm\b|diameter|length|width|height|\bø/i.test(t)) addAttr(mkA('Overall dimensions (L×W×H)', 'Text'));
        addAttr(mkA('Material', 'Text', '', !domain));
        addAttr(mkA('Standard / norm', 'Text'));
        addAttr(mkA('Weight', 'Number', 'KG'));

        return { categoryName: ref.label, unspsc: ref.code, catAttributes: attrs.slice(0, 10) };
    }

    /* ---- living-catalog lookup: find a category previously added via a
       new-category request (or by the AI) that matches this search. Matches by
       the deterministic suggested UNSPSC, or by the category label's word stems
       so it still works after the Central team renamed the category. ---- */
    function catStem(w) { return w.replace(/(ings|ing|s)$/, ''); }

    function findCatalogCategory(rawText, sug) {
        const list = (window.Store.get().datasets || {}).CATEGORY_ATTRIBUTES || [];
        const stems = new Set(tokens(rawText).map(catStem));
        let best = null, bestScore = 0;
        for (const c of list) {
            if (sug && c.unspsc && c.unspsc === sug.unspsc) return c;
            const lt = tokens(c.label || '').map(catStem);
            if (!lt.length) continue;
            let hit = 0;
            lt.forEach(w => { if (stems.has(w)) hit++; });
            const score = hit / lt.length;
            if (score >= 0.6 && score > bestScore) { best = c; bestScore = score; }
        }
        return best;
    }

    /* ---- duplicate detection ---- */
    function tokens(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2); }
    function score(a, b) {
        const A = new Set(tokens(a)), B = tokens(b);
        if (!B.length) return 0;
        let hit = 0; B.forEach(w => { if (A.has(w)) hit++; });
        return hit / Math.max(A.size, B.length);
    }

    function findMatches(parsed, rawText) {
        const mats = window.Store.materials();
        const results = [];
        mats.forEach(m => {
            // spec-composed designations are not real catalog codes — matching
            // treats the item as having no part number
            const pd = (parsed.specDerivedPart ? '' : (parsed.mfrPartNo || '')).replace(/\s/g, '').toLowerCase().replace(/^phg/, '');
            const md = (m.mfrPartNo || '').replace(/\s/g, '').toLowerCase().replace(/^phg/, '');
            let sc = 0;
            // strong signal: same manufacturer part number
            if (pd && md && pd === md) sc = 0.99;
            else {
                sc = Math.max(score(m.name + ' ' + m.longDesc, rawText), score(m.name, parsed.name));
                // a part number that differs (or exists on only one side) is strong
                // evidence of a DIFFERENT item — cap below the exact-match threshold
                // so near-identical wording still surfaces as "similar", not duplicate
                const mdInText = md && (rawText || '').replace(/\s/g, '').toLowerCase().indexOf(md) !== -1;
                if ((pd && md && pd !== md) || (md && !pd && !mdInText) || (pd && !md)) sc = Math.min(sc, 0.6);
            }
            results.push({ m, sc });
        });
        results.sort((a, b) => b.sc - a.sc);
        return results;
    }

    /* ---- identifier lookup: exact search by SAP ID, dmp ID, manufacturer
       part number or manufacturer name — these must hit the record directly,
       the fuzzy description matcher scores them near zero ---- */
    function idLookup(raw) {
        const q = (raw || '').trim().toLowerCase();
        if (!q) return null;
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const qn = norm(q);
        if (!qn) return null;
        const mats = window.Store.materials();
        let hits = mats.filter(m => norm(m.sapId) === qn);
        if (hits.length) return { hits, viaLabel: 'SAP ID ' + hits[0].sapId };
        hits = mats.filter(m => norm(m.dmpId) === qn);
        if (hits.length) return { hits, viaLabel: 'dmp ID ' + hits[0].dmpId };
        hits = mats.filter(m => m.mfrPartNo && norm(m.mfrPartNo) === qn);
        if (hits.length) return { hits, viaLabel: 'manufacturer part number ' + hits[0].mfrPartNo };
        // combination: the query mentions both a manufacturer name and one of
        // its part numbers, e.g. "SKF 6205-2RS" or "Manuli CHEM 25 10"
        hits = mats.filter(m => m.manufacturer && m.mfrPartNo &&
            q.indexOf(m.manufacturer.toLowerCase()) !== -1 && qn.indexOf(norm(m.mfrPartNo)) !== -1);
        if (hits.length) return { hits, viaLabel: hits[0].manufacturer + ' part number ' + hits[0].mfrPartNo };
        hits = mats.filter(m => m.manufacturer && m.manufacturer.toLowerCase() === q);
        if (hits.length) return { hits, viaLabel: 'manufacturer “' + hits[0].manufacturer + '”', byMfr: true };
        return null;
    }

    /* ---- generic browse: a short query with no identifying details
       ("bearing", "ball bearing") can't pinpoint ONE item — return every
       master item it matches so the user can browse instead.
       Tolerates typos: missing/wrong letters ("balbearing", "bsl bearing")
       and missing spaces ("ballbearing") via edit distance + word bigrams. ---- */
    function editDist(a, b, max) {
        if (Math.abs(a.length - b.length) > max) return max + 1;
        const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            let prev = dp[0]; dp[0] = i; let rowMin = dp[0];
            for (let j = 1; j <= b.length; j++) {
                const tmp = dp[j];
                dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
                prev = tmp; rowMin = Math.min(rowMin, dp[j]);
            }
            if (rowMin > max) return max + 1;
        }
        return dp[b.length];
    }
    // how well one query word matches an item's words: 0 = clean hit,
    // positive = typo distance, -1 = no match within tolerance
    function fuzzyWord(qw, hayWords) {
        const tol = qw.length <= 2 ? 1 : 2;
        let best = tol + 1;
        for (const hw of hayWords) {
            if (hw.indexOf(qw) !== -1 || (hw.length > 2 && qw.indexOf(hw) !== -1)) return 0;
            best = Math.min(best, editDist(qw, hw, tol));
            if (!best) return 0;
        }
        // bigrams catch missing spaces: "ballbearing" ~ "ball"+"bearings"
        for (let i = 0; i + 1 < hayWords.length; i++) {
            best = Math.min(best, editDist(qw, hayWords[i] + hayWords[i + 1], tol));
            if (!best) return 0;
        }
        return best <= tol ? best : -1;
    }
    function genericBrowse(raw) {
        const q = (raw || '').trim().toLowerCase();
        if (!q || /\d/.test(q)) return null;                    // digits → sizes / part numbers → specific
        const words = q.split(/\s+/).filter(w => w.length > 1);
        if (!words.length || words.length > 3) return null;     // long text → real description, let the parser work
        const mats = window.Store.materials();
        // every word must (fuzzily) appear in the item — otherwise a genuinely
        // new item ("anti corrosion primer") would be hijacked from the create flow
        const scored = [];
        mats.forEach(m => {
            const hayWords = [m.name, m.shortName, m.longDesc, m.unspscLabel, m.category, m.manufacturer]
                .filter(Boolean).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
            let total = 0;
            for (const w of words) {
                const dItem = fuzzyWord(w, hayWords);
                if (dItem === -1) { total = -1; break; }
                total += dItem;
            }
            if (total !== -1) scored.push({ m, total });
        });
        if (!scored.length) return null;
        scored.sort((a, b) => a.total - b.total);
        const hits = scored.slice(0, 8).map(x => x.m);
        return { hits, suggestion: suggestFix(words, hits[0]) };
    }
    // reconstruct what the user probably meant, using the best-matching item's words
    function suggestFix(words, m) {
        const hayWords = [m.name, m.shortName, m.longDesc, m.unspscLabel, m.category, m.manufacturer]
            .filter(Boolean).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
        const out = [];
        let changed = false;
        for (const qw of words) {
            if (hayWords.some(hw => hw.indexOf(qw) !== -1)) { out.push(qw); continue; }   // typed correctly
            const tol = qw.length <= 2 ? 1 : 2;
            let best = null, bestD = tol + 1;
            for (const hw of hayWords) {
                const d0 = editDist(qw, hw, tol);
                if (d0 < bestD) { bestD = d0; best = hw; }
            }
            for (let i = 0; i + 1 < hayWords.length; i++) {
                const d0 = editDist(qw, hayWords[i] + hayWords[i + 1], tol);
                if (d0 < bestD) { bestD = d0; best = hayWords[i] + ' ' + hayWords[i + 1]; }
            }
            if (best) { out.push(best); changed = true; } else out.push(qw);
        }
        return changed ? out.join(' ') : null;
    }

    /* ---- attribute-value search: a query like "55mm" or "C3" is a VALUE,
       not an item — find every master item carrying that value in any
       attribute, so the user can browse by specification ---- */
    function attrValueSearch(raw) {
        const q = (raw || '').trim();
        if (!q || q.length < 2 || q.length > 30 || q.split(/\s+/).length > 3) return null;
        // value pattern with boundaries: "55mm" also matches "55 mm", but
        // never "155 mm" or "55.5 mm"
        const pat = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/(\d)\s*([a-z])/gi, '$1\\s*$2').replace(/\s+/g, '\\s+');
        let re;
        try { re = new RegExp('(^|[^0-9A-Za-z])' + pat + '([^0-9A-Za-z]|$)', 'i'); } catch (e) { return null; }
        const hits = [];
        window.Store.materials().forEach(m => {
            const matched = [];
            Object.keys(m.attributes || {}).forEach(k => {
                const v = m.attributes[k];
                if (v && re.test(String(v))) matched.push({ name: k, value: String(v) });
            });
            if (matched.length) hits.push({ m, matched });
        });
        return hits.length ? hits.slice(0, 10) : null;
    }

    /* ---- main entry ---- */
    // The cheap local passes (exact identifier hit, too-generic browse, attribute-
    // value search) run against the local master and never need the remote engine.
    // Returns a full analysis for those cases, or null when real parsing is needed.
    function quickAnalyze(rawText) {
        // direct identifier search first — an exact SAP ID / part number /
        // manufacturer hit outranks any fuzzy description matching
        const idHit = idLookup(rawText);
        if (idHit) {
            const myPlant = window.Store.session().plant;
            const inMy = idHit.hits.find(m => (m.plants || []).indexOf(myPlant) !== -1);
            const exactMatch = inMy || idHit.hits[0];
            const outcome = inMy ? 'exists_my_plant' : 'exists_other_plant';
            const m = exactMatch;
            const parsed = {
                summary: m.shortName || m.name, name: m.name, shortName: m.shortName,
                manufacturer: m.manufacturer || '', mfrPartNo: m.mfrPartNo || '',
                unspsc: m.unspsc, unspscLabel: m.unspscLabel,
                category: m.category || m.unspscLabel, materialGroup: m.materialGroup,
                attributes: m.attributes || {}
            };
            return {
                raw: rawText, known: true, parsed, categoryFound: true, outcome,
                exactMatch, similar: idHit.hits.filter(x => x !== exactMatch).slice(0, 4),
                // several items sharing one identifier (e.g. the same part number
                // from different manufacturers): show them all, but creation of a
                // new item stays possible
                multiMatch: !idHit.byMfr && idHit.hits.length > 1,
                categorySuggestion: null,
                steps: [
                    { label: 'Parsed description', detail: `Recognised ${idHit.viaLabel} — ` +
                        (idHit.byMfr ? `${idHit.hits.length} item(s) in the master` : `matched “${m.shortName || m.name}”`) },
                    { label: 'Categorised item', detail: `UNSPSC ${m.unspsc} · ${m.unspscLabel}` },
                    { label: 'Resolved attributes', detail: `${Object.keys(m.attributes || {}).length} attributes for “${parsed.category}”` },
                    { label: 'Filled attribute values', detail: 'Loaded from the existing master record' },
                    { label: 'Checked material master', detail: outcomeLabel(outcome, exactMatch, myPlant) }
                ]
            };
        }
        // too-general query → tell the user and hand back the matching items
        const browse = genericBrowse(rawText);
        if (browse) {
            return {
                raw: rawText, known: false, parsed: { summary: (rawText || '').trim(), attributes: {} },
                categoryFound: false, outcome: 'too_generic',
                exactMatch: null, similar: browse.hits, categorySuggestion: null,
                suggestion: browse.suggestion,
                steps: [
                    { label: 'Parsed description', detail: `“${(rawText || '').trim()}” is too general to identify one exact item` +
                        (browse.suggestion ? ` — interpreted as “${browse.suggestion}”` : '') },
                    { label: 'Checked material master', detail: `${browse.hits.length} item(s) match this description` }
                ]
            };
        }
        // value-like query ("55mm", "C3") → browse items by attribute value
        const attrList = attrValueSearch(rawText);
        if (attrList) {
            const qt = (rawText || '').trim();
            return {
                raw: rawText, known: false, parsed: { summary: qt, attributes: {} },
                categoryFound: false, outcome: 'attr_match',
                exactMatch: null, similar: attrList.map(h => h.m), categorySuggestion: null,
                attrHits: Object.fromEntries(attrList.map(h => [h.m.id, h.matched])),
                steps: [
                    { label: 'Parsed description', detail: `“${qt}” looks like an attribute value, not an item description` },
                    { label: 'Checked material master', detail: `${attrList.length} item(s) carry this value in an attribute` }
                ]
            };
        }
        return null;
    }

    function analyze(rawText) {
        const quick = quickAnalyze(rawText);
        if (quick) return quick;
        const text = (rawText || '').toLowerCase();
        let parsed = null;
        for (const p of PROFILES) { if (p.match(text)) { parsed = p.build(text); break; } }
        const known = !!parsed;
        if (!parsed) parsed = genericParse(rawText || '');

        // the category catalog is the single source of truth: a parse only counts
        // as "category found" when its UNSPSC is actually catalogued — the AI
        // NEVER adds catalog entries itself; unknown categories are proposed as a
        // new-category request for the Central team instead
        let categoryFound = false;
        let catalogCat = null;
        const catByCode = (parsed.unspsc && window.UI && window.UI.categorySchema) ? window.UI.categorySchema(parsed.unspsc) : null;
        if (catByCode) {
            categoryFound = true;
            if (!parsed.materialGroup && catByCode.materialGroup) parsed.materialGroup = catByCode.materialGroup;
        } else {
            catalogCat = findCatalogCategory(rawText || '', suggestCategory(rawText || ''));
            if (catalogCat) {
                categoryFound = true;
                parsed.unspsc = catalogCat.unspsc;
                parsed.unspscLabel = catalogCat.label;
                parsed.category = catalogCat.label;
                if (catalogCat.materialGroup) parsed.materialGroup = catalogCat.materialGroup;
                if (!Object.keys(parsed.attributes || {}).length) {
                    const attrs = {};
                    (catalogCat.attributes || []).forEach(a => { attrs[a.name || a] = ''; });
                    parsed.attributes = attrs;
                }
            }
        }
        // universal enrichment for EVERY description: manufacturer, part number
        // and attribute values pulled from the text — runs after the category is
        // resolved so the category's attribute schema is available to fill
        enrichParsed(parsed, rawText);
        // then derive what the description DIDN'T provide, using real
        // industry numbering rules (belt codes, ISO bearing series…)
        deriveEnrichment(parsed, rawText);

        const ranked = findMatches(parsed, rawText || '');
        const best = ranked[0];
        const myPlant = window.Store.session().plant;

        let outcome, exactMatch = null, similar = [], categorySuggestion = null;
        if (!categoryFound) {
            outcome = 'category_missing';
            // category proposals come ONLY from the AI engine API — the built-in
            // fallback engine never fabricates one; the user is asked to create
            // the category request manually instead
        } else if (best && best.sc >= 0.85) {
            exactMatch = best.m;
            const inMyPlant = exactMatch.plants.indexOf(myPlant) !== -1;
            outcome = inMyPlant ? 'exists_my_plant' : 'exists_other_plant';
        } else {
            outcome = 'not_found';
            // similar = same category/group, decent score
            similar = ranked
                .filter(r => r.sc > 0.08 || (parsed.materialGroup && r.m.materialGroup === parsed.materialGroup))
                .slice(0, 4).map(r => r.m);
        }

        return {
            raw: rawText, known, parsed, categoryFound, outcome,
            exactMatch, similar, categorySuggestion,
            steps: [
                { label: 'Parsed description', detail: parsed.summary },
                { label: 'Categorised item', detail: categoryFound ? `UNSPSC ${parsed.unspsc} · ${parsed.unspscLabel}`
                    : (categorySuggestion ? `No match — proposing new category “${categorySuggestion.categoryName}” · UNSPSC ${categorySuggestion.unspsc}` : 'No matching category found') },
                { label: 'Resolved attributes', detail: categoryFound ? `${Object.keys(parsed.attributes).length} attributes for “${parsed.category}”`
                    : (categorySuggestion ? `${categorySuggestion.catAttributes.length} attributes proposed for the new category` : '—') },
                { label: 'Filled attribute values', detail: categoryFound ? (catalogCat ? 'Attribute set loaded from the category catalog — fill in the values' : 'Values extracted from description') : '—' },
                ...(parsed.enrichedNotes ? [{ label: 'Enriched missing data', detail: parsed.enrichedNotes.join(' · ') }] : []),
                { label: 'Checked material master', detail: outcomeLabel(outcome, exactMatch, myPlant) }
            ]
        };
    }

    /* ---- finish an analysis whose parsing/enrichment was done by the REMOTE
       AI engine (ai-remote.js). The remote pipeline supplies parsed fields and
       an attribute schema; what stays local is everything that depends on OUR
       data: the category catalog lookup, duplicate matching against the
       material master, and the outcome decision. ---- */
    function assembleRemote(rawText, parsed, meta) {
        meta = meta || {};
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const cat = (window.UI && window.UI.categorySchema) ? window.UI.categorySchema(parsed.unspsc) : null;
        let categoryFound = false, categorySuggestion = null;
        if (cat) {
            categoryFound = true;
            parsed.unspscLabel = cat.label || parsed.unspscLabel;
            parsed.category = cat.label || parsed.category;
            parsed.materialGroup = cat.materialGroup || parsed.materialGroup || '';
            // remote-extracted values → our schema's attribute names (loose name match);
            // schema attributes without a matching value stay blank for the requester
            const vals = parsed.attributes || {};
            const mapped = {};
            (cat.attributes || []).forEach(a => {
                const name = a.name || a;
                const an = norm(name);
                const hit = Object.keys(vals).find(k => {
                    const kn = norm(k);
                    return kn === an || (kn.length > 3 && an.indexOf(kn) !== -1) || (an.length > 3 && kn.indexOf(an) !== -1);
                });
                mapped[name] = hit ? vals[hit] : '';
            });
            parsed.attributes = mapped;
        } else {
            // category unknown to our catalog → the proposal is EXCLUSIVELY what
            // the AI engine returned (name + UNSPSC + attribute schema). We never
            // fabricate categories or attributes locally; no engine proposal
            // means the user writes the category request by hand.
            categorySuggestion = meta.categorySuggestion || null;
        }
        if (!parsed.baseUom) parsed.baseUom = 'EA';

        const ranked = findMatches(parsed, rawText || '');
        const best = ranked[0];
        const myPlant = window.Store.session().plant;
        let outcome, exactMatch = null, similar = [];
        if (!categoryFound) {
            outcome = 'category_missing';
        } else if (best && best.sc >= 0.85) {
            exactMatch = best.m;
            outcome = (exactMatch.plants || []).indexOf(myPlant) !== -1 ? 'exists_my_plant' : 'exists_other_plant';
        } else {
            outcome = 'not_found';
            similar = ranked
                .filter(r => r.sc > 0.08 || (parsed.materialGroup && r.m.materialGroup === parsed.materialGroup))
                .slice(0, 4).map(r => r.m);
        }
        return {
            raw: rawText, known: true, remote: true, parsed, categoryFound, outcome,
            exactMatch, similar, categorySuggestion,
            steps: (meta.steps || []).concat([
                { label: 'Checked material master', detail: outcomeLabel(outcome, exactMatch, myPlant) }
            ])
        };
    }

    function outcomeLabel(outcome, m, myPlant) {
        switch (outcome) {
            case 'exists_my_plant': return 'Already exists in your plant (' + myPlant + ')';
            case 'exists_other_plant': return 'Exists in plant ' + (m ? m.plants[0] : '') + ' — extend to yours';
            case 'not_found': return 'Not found — similar items shown';
            case 'category_missing': return 'Category not in system';
        }
        return '';
    }

    /* ---- build a create-request payload from analysis ---- */
    function toPayload(analysis) {
        const p = analysis.parsed;
        const s = window.Store.session();
        return {
            name: p.name, shortName: p.shortName, longDesc: p.longDesc,
            materialType: 'ROH', matTypeChoice: p.matTypeChoice,
            manufacturer: p.manufacturer, mfrPartNo: p.mfrPartNo, model: p.model || '',
            unspsc: p.unspsc, unspscLabel: p.unspscLabel, category: p.category,
            materialGroup: p.materialGroup,
            materialDescription: '', // filled from group in the form
            baseUom: p.baseUom, plants: [s.plant], plant: s.plant,
            storageLocation: guessStorage(p.materialGroup),
            mrpEnabled: 'Yes', batchManaged: 'No', mrpType: 'PD',
            recordType: 'Golden record',
            valuationClass: '',
            attributes: Object.assign({}, p.attributes),
            image: ''
        };
    }
    function guessStorage(group) {
        if (!group) return '';
        const n = group.slice(1, 4);           // M008.0001 → 008
        const code = 'M' + n;
        return window.Seed.STORAGE_LOCATIONS.indexOf(code) !== -1 ? code : '';
    }

    /* ---- validation: blocking (blank mandatory) + warnings (AI feedback) ---- */
    const MANDATORY = [
        { k: 'materialGroup', label: 'Material Group' },
        { k: 'shortName', label: 'Short name' },
        { k: 'longDesc', label: 'Long description' },
        { k: 'baseUom', label: 'Base unit of measure' },
        { k: 'plant', label: 'Plant' },
        { k: 'storageLocation', label: 'Storage location' },
        { k: 'mrpEnabled', label: 'MRP planning enabled' },
        { k: 'batchManaged', label: 'Batch-managed' },
        { k: 'mrpType', label: 'MRP type' },
        { k: 'matTypeChoice', label: 'Part type (OEM/Generic/…)' },
        { k: 'recordType', label: 'Golden/Sourcing record' }
    ];

    function validate(payload) {
        const blocking = [];
        MANDATORY.forEach(f => {
            const v = payload[f.k];
            if (v === undefined || v === null || String(v).trim() === '') blocking.push({ field: f.k, msg: f.label + ' is required.' });
        });

        // mandatory category attributes (from the category schema) also block submission —
        // except for sourcing records, where all technical attributes are optional
        const schema = (window.UI && window.UI.categorySchema && payload.recordType !== 'Sourcing record')
            ? window.UI.categorySchema(payload.unspsc) : null;
        if (schema) {
            (schema.attributes || []).forEach(a => {
                if (a && a.mandatory) {
                    const v = (payload.attributes || {})[a.name];
                    if (v === undefined || v === null || String(v).trim() === '') {
                        blocking.push({ field: 'attr::' + a.name, msg: 'Attribute “' + a.name + '” is required.' });
                    }
                }
            });
        }

        // AI feedback covers ONLY the material group: the selected group must match
        // the group mapped to the item's category in the catalog
        const warnings = [];
        const cat = (window.UI && window.UI.categorySchema) ? window.UI.categorySchema(payload.unspsc) : null;
        if (cat && cat.materialGroup && payload.materialGroup && payload.materialGroup !== cat.materialGroup) {
            const desc = (window.UI && window.UI.groupDesc) ? window.UI.groupDesc(cat.materialGroup) : '';
            warnings.push({
                level: 'warn',
                msg: `Material Group ${payload.materialGroup} looks wrong for the category “${cat.label}” — the AI expects ${cat.materialGroup}${desc ? ' (' + desc + ')' : ''}.`
            });
        }

        return { ok: blocking.length === 0, blocking, warnings };
    }

    // NOTE: the AI deliberately has no way to add categories to the catalog.
    // New categories enter the system only through an approved new-category
    // request (workflow.applyCategory) — see the 'category_missing' outcome.

    window.AI = { analyze, quickAnalyze, assembleRemote, toPayload, validate, guessStorage, structuredDesc };
})();
