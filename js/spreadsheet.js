/* ============================================================
   spreadsheet.js — dependency-free .xlsx / .csv reader for bulk upload

   parseFile(file)            → Promise<string[][]> (rows × cells)
   extractDescriptions(rows)  → { descs, column, headerUsed }

   XLSX support uses the browser's native DecompressionStream to inflate
   the zip entries and DOMParser for the sheet XML — no libraries.
   Legacy binary .xls is rejected with a clear message.
   ============================================================ */
(function () {
    'use strict';

    /* ---------------- CSV ---------------- */
    function parseCsv(text) {
        text = String(text || '').replace(/^﻿/, '');
        const nl = text.indexOf('\n');
        const first = nl === -1 ? text : text.slice(0, nl);
        // delimiter sniffing: comma / semicolon / tab, whichever the first line uses most
        const delim = [',', ';', '\t']
            .map(d => [d, first.split(d).length - 1])
            .sort((a, b) => b[1] - a[1])[0][0];
        const rows = [];
        let row = [], cur = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) {
                if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
                else cur += c;
            } else if (c === '"') inQ = true;
            else if (c === delim) { row.push(cur); cur = ''; }
            else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
            else cur += c;
        }
        if (cur !== '' || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
        return rows;
    }

    /* ---------------- ZIP (xlsx container) ---------------- */
    async function inflateRaw(bytes) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    function zipEntries(u8) {
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        // find End Of Central Directory (may be preceded by a zip comment)
        let eocd = -1;
        for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65536); i--) {
            if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
        }
        if (eocd === -1) throw new Error('Not a valid .xlsx file (zip directory not found).');
        const count = dv.getUint16(eocd + 10, true);
        let off = dv.getUint32(eocd + 16, true);
        const entries = {};
        const td = new TextDecoder();
        for (let n = 0; n < count; n++) {
            if (dv.getUint32(off, true) !== 0x02014b50) break;
            const method = dv.getUint16(off + 10, true);
            const compSize = dv.getUint32(off + 20, true);
            const nameLen = dv.getUint16(off + 28, true);
            const extraLen = dv.getUint16(off + 30, true);
            const commentLen = dv.getUint16(off + 32, true);
            const lho = dv.getUint32(off + 42, true);
            const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
            entries[name] = { method, compSize, lho };
            off += 46 + nameLen + extraLen + commentLen;
        }
        return entries;
    }

    async function zipRead(u8, entry) {
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const nameLen = dv.getUint16(entry.lho + 26, true);
        const extraLen = dv.getUint16(entry.lho + 28, true);
        const start = entry.lho + 30 + nameLen + extraLen;
        const data = u8.subarray(start, start + entry.compSize);
        if (entry.method === 0) return data;
        if (entry.method === 8) return await inflateRaw(data);
        throw new Error('Unsupported compression method in .xlsx.');
    }

    /* ---------------- worksheet XML ---------------- */
    function colIndex(ref) {
        let n = 0;
        for (let i = 0; i < ref.length; i++) {
            const c = ref.charCodeAt(i);
            if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
            else break;
        }
        return n - 1;
    }

    function parseSheetXml(xml, shared) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Could not read the worksheet.');
        const rows = [];
        doc.querySelectorAll('sheetData > row').forEach(rEl => {
            const out = [];
            rEl.querySelectorAll('c').forEach(c => {
                const ref = c.getAttribute('r') || '';
                const idx = ref ? colIndex(ref) : out.length;
                const t = c.getAttribute('t') || '';
                let v = '';
                if (t === 'inlineStr') {
                    const is = c.querySelector('is');
                    v = is ? is.textContent : '';
                } else {
                    const ve = c.querySelector('v');
                    v = ve ? ve.textContent : '';
                    if (t === 's') v = shared[Number(v)] || '';
                }
                out[idx >= 0 ? idx : out.length] = String(v);
            });
            rows.push(out);
        });
        return rows;
    }

    async function parseXlsx(u8) {
        const entries = zipEntries(u8);
        const sheetNames = Object.keys(entries)
            .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
            .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
        if (!sheetNames.length) throw new Error('No worksheet found in the .xlsx file.');
        const td = new TextDecoder();
        let shared = [];
        if (entries['xl/sharedStrings.xml']) {
            const ssDoc = new DOMParser().parseFromString(td.decode(await zipRead(u8, entries['xl/sharedStrings.xml'])), 'application/xml');
            ssDoc.querySelectorAll('si').forEach(si => shared.push(si.textContent));
        }
        return parseSheetXml(td.decode(await zipRead(u8, entries[sheetNames[0]])), shared);
    }

    /* ---------------- public API ---------------- */
    async function parseFile(file) {
        const name = String(file.name || '').toLowerCase();
        if (name.endsWith('.csv') || /text\/csv/.test(file.type || '')) return parseCsv(await file.text());
        if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
            throw new Error('Legacy .xls is not supported — save the file as .xlsx or .csv and upload again.');
        }
        return parseXlsx(new Uint8Array(await file.arrayBuffer()));
    }

    // pick the description column: a header cell naming it wins; otherwise the
    // column carrying the most text. Returns trimmed non-empty descriptions.
    function extractDescriptions(rows) {
        rows = (rows || []).filter(r => r && r.some(c => String(c || '').trim() !== ''));
        if (!rows.length) return { descs: [], column: null, headerUsed: false };
        const header = rows[0].map(c => String(c || '').trim());
        const hIdx = header.findIndex(h => /desc|item|material|product|təsvir/i.test(h));
        let col, start, colName, headerUsed;
        if (hIdx !== -1 && rows.length > 1) {
            col = hIdx; start = 1; colName = header[hIdx]; headerUsed = true;
        } else {
            const width = Math.max.apply(null, rows.map(r => r.length));
            let best = 0, bestLen = -1;
            for (let cidx = 0; cidx < width; cidx++) {
                const len = rows.reduce((a, r) => a + String(r[cidx] || '').trim().length, 0);
                if (len > bestLen) { bestLen = len; best = cidx; }
            }
            col = best; start = 0; headerUsed = false;
            colName = 'column ' + (best < 26 ? String.fromCharCode(65 + best) : '#' + (best + 1));
        }
        const descs = [];
        for (let i = start; i < rows.length; i++) {
            const v = String(rows[i][col] || '').trim();
            if (v) descs.push(v);
        }
        return { descs, column: colName, headerUsed };
    }

    // header-mapped extraction for multi-column bulk files (amend / min-max /
    // enrichment re-uploads). specs: [{ key, match: RegExp, required?: bool }].
    // Returns { records: [{key: value}], columns: {key: headerText} } — or an
    // `error` string when a required column cannot be found.
    function extractTable(rows, specs) {
        rows = (rows || []).filter(r => r && r.some(c => String(c || '').trim() !== ''));
        if (rows.length < 2) return { error: 'The file needs a header row and at least one data row.' };
        const header = rows[0].map(c => String(c || '').trim());
        const idx = {}, columns = {};
        specs.forEach(sp => {
            const i = header.findIndex(h => sp.match.test(h));
            if (i !== -1) { idx[sp.key] = i; columns[sp.key] = header[i]; }
        });
        const missing = specs.filter(sp => sp.required && idx[sp.key] === undefined).map(sp => sp.key);
        if (missing.length) return { error: 'Required column(s) not found: ' + missing.join(', ') + '. See the template for the expected headers.' };
        const records = [];
        for (let r = 1; r < rows.length; r++) {
            const rec = {};
            let any = false;
            Object.keys(idx).forEach(k => {
                const v = String(rows[r][idx[k]] || '').trim();
                rec[k] = v;
                if (v) any = true;
            });
            if (any) records.push(rec);
        }
        return { records, columns };
    }

    window.Spreadsheet = { parseFile, extractDescriptions, extractTable };
})();
