// Minimal .xlsx reader built only on Node's built-ins (via ./zip.js).
// Reads the first worksheet into an array of rows of plain values
// (strings/numbers). Good enough for the flat "flight record" export
// the Talos T60x app produces; not a general-purpose xlsx library.

'use strict';

const { readZip } = require('./zip');

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  // Each <si>...</si> can contain one <t> or multiple <r><t> runs (rich text).
  const siRegex = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(xml)) !== null) {
    const inner = m[1];
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let text = '';
    let tm;
    let found = false;
    while ((tm = tRegex.exec(inner)) !== null) {
      text += decodeXmlEntities(tm[1]);
      found = true;
    }
    strings.push(found ? text : '');
  }
  return strings;
}

function colToIndex(col) {
  // "A" -> 0, "B" -> 1, ... "AA" -> 26, ...
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRegex.exec(xml)) !== null) {
    const rowNum = parseInt(rm[1], 10);
    const rowXml = rm[2];
    const rowArr = [];

    const cellRegex = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRegex.exec(rowXml)) !== null) {
      const attrs = cm[1] !== undefined ? cm[1] : cm[2];
      const inner = cm[3] || '';

      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const typeMatch = /t="([^"]+)"/.exec(attrs);
      const col = refMatch ? colToIndex(refMatch[1]) : rowArr.length;
      const type = typeMatch ? typeMatch[1] : 'n';

      let value = null;
      if (type === 'inlineStr') {
        const tMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        value = tMatch ? decodeXmlEntities(tMatch[1]) : '';
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vMatch) {
          const raw = vMatch[1];
          if (type === 's') {
            value = sharedStrings[parseInt(raw, 10)] ?? '';
          } else if (type === 'str' || type === 'b') {
            value = decodeXmlEntities(raw);
          } else {
            // numeric (also covers dates, which are stored as serials)
            value = raw.includes('.') || raw.includes('e') || raw.includes('E')
              ? parseFloat(raw)
              : parseInt(raw, 10);
          }
        }
      }

      rowArr[col] = value;
    }

    rows[rowNum - 1] = rowArr;
  }

  // Normalize: fill gaps, trim trailing undefined rows.
  const maxRow = rows.length;
  const normalized = [];
  for (let i = 0; i < maxRow; i++) {
    normalized.push(rows[i] ? rows[i].map((v) => (v === undefined ? null : v)) : []);
  }
  return normalized;
}

/**
 * Reads an .xlsx file buffer and returns { sheetNames, sheets: { [name]: rows } }
 * where rows is an array of arrays of cell values, row 0 = first row in the file.
 */
function readXlsx(buffer) {
  const zip = readZip(buffer);

  const sharedStringsEntry = zip.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsEntry ? parseSharedStrings(sharedStringsEntry().toString('utf8')) : [];

  const workbookXml = zip.get('xl/workbook.xml')?.().toString('utf8') || '';
  const sheetNameRegex = /<sheet[^>]*name="([^"]*)"[^>]*sheetId="(\d+)"[^>]*(?:r:id="([^"]*)")?/g;
  const sheetMetas = [];
  let sm;
  while ((sm = sheetNameRegex.exec(workbookXml)) !== null) {
    sheetMetas.push({ name: decodeXmlEntities(sm[1]) });
  }

  // Map sheetN.xml files in document order (rels resolution is overkill for our needs;
  // workbook sheets are written in xl/worksheets/sheetN.xml in order in every writer we've seen).
  const sheetFiles = [...zip.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/sheet(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/sheet(\d+)\.xml/)[1], 10);
      return na - nb;
    });

  const sheets = {};
  const sheetNames = [];
  sheetFiles.forEach((file, i) => {
    const name = sheetMetas[i]?.name || `Sheet${i + 1}`;
    const xml = zip.get(file)().toString('utf8');
    sheets[name] = parseSheet(xml, sharedStrings);
    sheetNames.push(name);
  });

  return { sheetNames, sheets };
}

/** Convenience: read the first sheet as an array of objects keyed by the header row. */
function readFirstSheetAsRecords(buffer) {
  const { sheetNames, sheets } = readXlsx(buffer);
  const rows = sheets[sheetNames[0]] || [];
  const [header, ...body] = rows;
  if (!header) return { headers: [], records: [] };
  const records = body
    .filter((r) => r.length > 0 && r.some((v) => v !== null && v !== ''))
    .map((r) => {
      const obj = {};
      header.forEach((h, i) => {
        obj[h] = r[i] === undefined ? null : r[i];
      });
      return obj;
    });
  return { headers: header, records };
}

module.exports = { readXlsx, readFirstSheetAsRecords };
