// Настоящий .xlsx без библиотек: оформленные таблицы для Excel (шапка, ширина колонок, ₽, даты, итоги, фильтр).
// Чистый модуль (без DOM) — импортируется и в node-тестах. Файл — zip без сжатия из нескольких XML.
//
// xlsxBook(sheets) → Uint8Array. sheet = {
//   name,                       — имя листа (до 31 символа)
//   title, subtitle,            — заголовок и подпись над таблицей (необязательно)
//   columns: [{ title, type, width }],  type: 'text' | 'money' | 'int' | 'date'
//   rows: [[...значения]],      — значение или { v, tone, bold, type } (tone: 'bad' | 'ok' | 'warn' | 'muted' | 'blue' | 'purple' | 'orange';
//                                 type — формат этой ячейки вместо формата колонки)
//   total: 'Итого' | null       — строка итогов: суммы колонок money/int, кроме перечисленных в noTotal
//   noTotal: [индексы колонок]
//   filter: false                — без автофильтра (короткие листы вроде сводки)
// }

const enc = new TextEncoder();
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // управляющие символы запрещены в XML — убираем
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// ---------- zip (метод «без сжатия») ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nm = enc.encode(name);
    const body = typeof data === 'string' ? enc.encode(data) : data;
    const crc = crc32(body);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // имена в UTF-8
    local.setUint16(8, 0, true); // без сжатия
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, body.length, true);
    local.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(local.buffer), nm, body);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, body.length, true);
    cen.setUint32(24, body.length, true);
    cen.setUint16(28, nm.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nm);
    offset += 30 + nm.length + body.length;
  }
  const cenSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

// ---------- стили ----------

// Цвета бренда (base.css): тёмно-синий шапки, светлые подложки, тона статусов.
const NAVY = 'FF0B1160';
const TONES = { bad: 'FFC0392B', ok: 'FF14915A', warn: 'FF9A6700', muted: 'FF6B7194', blue: 'FF2F5BD3', purple: 'FF7A4CD9', orange: 'FFD94A14' };
const FILLS = { head: NAVY, zebra: 'FFF4F6FC', total: 'FFFFF1EA' };
const NUMFMT = { money: 164, int: 3, date: 165 };

// Реестр сочетаний (шрифт, заливка, формат) → индекс cellXfs; заполняется по мере сборки листов.
function styleRegistry() {
  const fonts = ['<font><sz val="11"/><color rgb="FF0B1160"/><name val="Calibri"/><family val="2"/></font>'];
  const fontIx = new Map([['', 0]]);
  const font = ({ bold = false, size = 11, color = 'FF0B1160', italic = false }) => {
    const key = [bold, size, color, italic].join('|');
    if (!fontIx.has(key)) {
      fontIx.set(key, fonts.length);
      fonts.push(`<font>${bold ? '<b/>' : ''}${italic ? '<i/>' : ''}<sz val="${size}"/><color rgb="${color}"/><name val="Calibri"/><family val="2"/></font>`);
    }
    return fontIx.get(key);
  };
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const fillIx = new Map();
  const fill = (rgb) => {
    if (!rgb) return 0;
    if (!fillIx.has(rgb)) { fillIx.set(rgb, fills.length); fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`); }
    return fillIx.get(rgb);
  };
  // 0 — без рамки, 1 — тонкая линия снизу (строки), 2 — линия сверху (итог)
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE3E6EF"/></bottom><diagonal/></border>',
    '<border><left/><right/><top style="medium"><color rgb="FF0B1160"/></top><bottom/><diagonal/></border>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIx = new Map();
  const xf = ({ numFmt = 0, fontOpt = {}, fillRgb = '', border = 0, wrap = false, halign = '' }) => {
    const f = font(fontOpt);
    const fl = fill(fillRgb);
    const key = [numFmt, f, fl, border, wrap, halign].join('|');
    if (!xfIx.has(key)) {
      xfIx.set(key, xfs.length);
      const align = wrap || halign ? `<alignment vertical="center"${wrap ? ' wrapText="1"' : ''}${halign ? ` horizontal="${halign}"` : ''}/>` : '<alignment vertical="center"/>';
      xfs.push(`<xf numFmtId="${numFmt}" fontId="${f}" fillId="${fl}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`);
    }
    return xfIx.get(key);
  };
  const xml = () => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0\\ &quot;₽&quot;"/><numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/></numFmts>'
    + `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`
    + `<fills count="${fills.length}">${fills.join('')}</fills>`
    + `<borders count="${borders.length}">${borders.join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
  return { xf, xml };
}

// ---------- лист ----------

export const colName = (i) => { let s = ''; let n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// Дата → серийный номер Excel по местному календарю (день без сдвига часового пояса).
export function excelDate(v) {
  const d = v instanceof Date ? v : (v ? new Date(v) : null);
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

const isNum = (t) => t === 'money' || t === 'int';

function sheetXml(sh, st) {
  const cols = sh.columns;
  const rowsXml = [];
  let r = 0;
  const cell = (c, value, style) => {
    const ref = `${colName(c)}${r}`;
    if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${style}"/>`;
    if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}"/>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
  };
  const merges = [];
  if (sh.title) {
    r++;
    rowsXml.push(`<row r="${r}" ht="24" customHeight="1">${cell(0, sh.title, st.xf({ fontOpt: { bold: true, size: 15 } }))}</row>`);
  }
  if (sh.subtitle) {
    r++;
    rowsXml.push(`<row r="${r}">${cell(0, sh.subtitle, st.xf({ fontOpt: { size: 10, color: TONES.muted, italic: true } }))}</row>`);
  }
  if (sh.title || sh.subtitle) { r++; rowsXml.push(`<row r="${r}" ht="6" customHeight="1"/>`); }
  // шапка
  r++;
  const headRow = r;
  const headStyle = (c) => st.xf({ fontOpt: { bold: true, color: 'FFFFFFFF' }, fillRgb: FILLS.head, wrap: true, halign: isNum(cols[c].type) ? 'right' : 'left' });
  rowsXml.push(`<row r="${r}" ht="30" customHeight="1">${cols.map((col, c) => cell(c, col.title, headStyle(c))).join('')}</row>`);
  // данные
  const first = r + 1;
  sh.rows.forEach((row, i) => {
    r++;
    const zebra = i % 2 ? FILLS.zebra : '';
    rowsXml.push(`<row r="${r}">${cols.map((col, c) => {
      const raw = row[c];
      const obj = raw && typeof raw === 'object' && !(raw instanceof Date) ? raw : { v: raw };
      const type = obj.type || col.type;
      let v = obj.v;
      if (type === 'date') v = excelDate(v);
      else if (isNum(type) && v !== null && v !== undefined && v !== '') v = Number(v) || 0;
      const fontOpt = obj.tone ? { color: TONES[obj.tone], bold: obj.bold ?? obj.tone !== 'muted' } : (obj.bold ? { bold: true } : {});
      return cell(c, v, st.xf({ numFmt: NUMFMT[type] || 0, fontOpt, fillRgb: zebra, border: 1, wrap: col.wrap, halign: isNum(type) ? 'right' : '' }));
    }).join('')}</row>`);
  });
  const last = r;
  // итог
  if (sh.total && sh.rows.length) {
    r++;
    const skip = new Set(sh.noTotal || []);
    rowsXml.push(`<row r="${r}" ht="20" customHeight="1">${cols.map((col, c) => {
      const s = st.xf({ numFmt: NUMFMT[col.type] || 0, fontOpt: { bold: true }, fillRgb: FILLS.total, border: 2, halign: isNum(col.type) ? 'right' : '' });
      if (c === 0) return cell(c, sh.total, s);
      if (isNum(col.type) && !skip.has(c)) {
        const ref = `${colName(c)}${r}`;
        const sum = sh.rows.reduce((a, row) => a + (Number(row[c] && typeof row[c] === 'object' ? row[c].v : row[c]) || 0), 0);
        return `<c r="${ref}" s="${s}"><f>SUM(${colName(c)}${first}:${colName(c)}${last})</f><v>${sum}</v></c>`;
      }
      return cell(c, '', s);
    }).join('')}</row>`);
  }
  const lastCol = colName(cols.length - 1);
  const width = (col) => col.width || Math.min(48, Math.max(10, col.title.length + 2));
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
    + `<sheetViews><sheetView workbookViewId="0" zoomScale="110"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="18"/>'
    + `<cols>${cols.map((col, c) => `<col min="${c + 1}" max="${c + 1}" width="${width(col)}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rowsXml.join('')}</sheetData>`
    + (sh.rows.length && sh.filter !== false ? `<autoFilter ref="A${headRow}:${lastCol}${last}"/>` : '')
    + (merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '')
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
    + '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';
}

// Имя листа: без []:*?/\, до 31 символа, без повторов.
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((s, i) => {
    let n = String(s.name || `Лист${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Лист${i + 1}`;
    let k = 2;
    while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
    used.add(n.toLowerCase());
    return n;
  });
}

export function xlsxBook(sheets) {
  const st = styleRegistry();
  const names = sheetNames(sheets);
  const sheetFiles = sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh, st) }));
  const autoFilters = sheets.map((sh, i) => (sh.rows.length && sh.filter !== false ? i : -1)).filter((i) => i >= 0);
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<bookViews><workbookView/></bookViews>'
      + `<sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      // скрытое имя _FilterDatabase нужно Excel для автофильтра
      + (autoFilters.length ? `<definedNames>${autoFilters.map((i) => {
        const sh = sheets[i];
        const head = (sh.title ? 1 : 0) + (sh.subtitle ? 1 : 0) + (sh.title || sh.subtitle ? 1 : 0) + 1;
        return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEsc(names[i]).replace(/'/g, "''")}'!$A$${head}:$${colName(sh.columns.length - 1)}$${head + sh.rows.length}</definedName>`;
      }).join('')}</definedNames>` : '')
      + '</workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>' },
    { name: 'xl/styles.xml', data: st.xml() },
    ...sheetFiles,
  ]);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
