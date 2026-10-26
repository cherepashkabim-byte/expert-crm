// База знаний: чистые функции (без DOM) — Markdown → безопасный HTML, статьи по модели заказа, поиск,
// разбор стартовых статей. Импортируется вкладкой kb.js, карточкой заказа и node-тестами.
import { esc } from '../fmt.js';
import { normDevice } from './order-hints.js';

export const CATEGORIES = ['Модель', 'Диагностика', 'Безопасность', 'Приём и выдача', 'Запчасти'];
export const BRANDS = ['Apple', 'Samsung', 'Xiaomi', 'Honor', 'Huawei', 'realme', 'Tecno', 'Infinix'];
export const DEVICE_TYPES = ['Телефон', 'Планшет', 'Ноутбук', 'Часы'];
export const SEED_FILES = ['kb/iphone.json', 'kb/android.json', 'kb/general.json'];
export const BODY_MAX = 200000;

// ---------- Markdown (ровно подмножество из pb_public/kb/FORMAT.md, без HTML) ----------

const SAFE_URL = /^https?:\/\/[^\s]+$/i;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const isTableRow = (s) => /^\s*\|.*\|\s*$/.test(s);
const UL = /^\s*-\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const HEAD = /^\s*(#{1,3})\s+(.*?)\s*#*\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const indent = (s) => s.length - s.trimStart().length;

// Строчная разметка: `код`, [текст](http…), **жирный**, *курсив*. Всё прочее экранируется.
export function inlineMd(text) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = String(text ?? '').replace(/\u0000/g, '');
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g, (_, label, url) => (SAFE_URL.test(url)
    ? keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${emph(esc(label))}</a>`)
    : keep(emph(esc(label)))));
  s = emph(esc(s));
  for (let n = 0; n < 3 && s.includes('\u0000'); n++) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i] ?? '');
  return s;
}

function emph(html) {
  return html
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?![*\w])/g, '$1<em>$2</em>');
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// Markdown → HTML. Заголовки ## → <h3>, ### → <h4> (h2 на экране — заголовок статьи).
export function renderMd(text, depth = 0) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = HEAD.exec(line);
    if (h) {
      const tag = h[1].length >= 3 ? 'h4' : 'h3';
      out.push(`<${tag}>${inlineMd(h[2])}</${tag}>`);
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="kb-tw"><table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${inlineMd(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(QUOTE.exec(lines[i++])[1]);
      out.push(`<blockquote>${depth < 3 ? renderMd(inner.join('\n'), depth + 1) : `<p>${inlineMd(inner.join(' '))}</p>`}</blockquote>`);
      continue;
    }

    const listRe = UL.test(line) ? UL : OL.test(line) ? OL : null;
    if (listRe) {
      const tag = listRe === UL ? 'ul' : 'ol';
      const base = indent(line);
      const items = []; // {text, sub: строки вложенного списка}
      while (i < lines.length && lines[i].trim()) {
        const cur = lines[i];
        const nested = UL.test(cur) || OL.test(cur);
        if (nested && indent(cur) > base && items.length) {
          // Пункт с отступом — вложенный список последнего пункта: «2. Состояние:\n   - iPhone 15».
          items[items.length - 1].sub.push(cur.slice(Math.min(indent(cur), base + 4)));
        } else if (nested && indent(cur) <= base && listRe.test(cur)) {
          items.push({ text: listRe.exec(cur)[1], sub: [] });
        } else if (!nested && /^\s+\S/.test(cur) && items.length) {
          const last = items[items.length - 1];
          if (last.sub.length) last.sub.push(cur.slice(Math.min(indent(cur), base + 4)));
          else last.text += ' ' + cur.trim();
        } else break;
        i++;
      }
      out.push(`<${tag}>${items.map((it) => `<li>${inlineMd(it.text)}${it.sub.length && depth < 3 ? renderMd(it.sub.join('\n'), depth + 1) : ''}</li>`).join('')}</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !HEAD.test(lines[i]) && !QUOTE.test(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i])
      && !(isTableRow(lines[i]) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))) para.push(lines[i++].trim());
    out.push(`<p>${inlineMd(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ---------- модели ----------

const BRAND_WORDS = ['apple', 'samsung', 'xiaomi', 'honor', 'huawei', 'realme', 'tecno', 'infinix', 'google', 'oneplus', 'oppo', 'vivo', 'nokia', 'motorola', 'galaxy'];
const lowText = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[\s ]+/g, ' ').trim();

// Ключ модели для сравнения: без регистра, пробелов и марки в начале.
// «Apple iPhone 13» / «iphone13» → «iphone13»; «Samsung Galaxy A52» / «Galaxy A52» → «a52»; «iPhone 13 Pro» → «iphone13pro».
export function normModel(s, brand = '') {
  let m = lowText(s);
  const words = [lowText(brand), ...BRAND_WORDS].filter(Boolean);
  for (let again = true; again;) {
    again = false;
    for (const w of words) {
      if (m.startsWith(w + ' ') && m.length > w.length + 1) { m = m.slice(w.length + 1); again = true; }
    }
  }
  return m.replace(/[\s\-_]+/g, '');
}

const sameBrand = (a, b) => !a || !b || lowText(a) === lowText(b);

// Статьи, в models которых есть модель заказа. Модель — через normDevice (как orderDevice): у старых заказов
// без марки марка угадывается. Сравнение точное по ключу normModel: «iPhone 13» ≠ «iPhone 13 Pro».
export function articlesForOrder(articles, order) {
  const dev = normDevice(order?.brand, order?.model);
  const key = normModel(dev.model, dev.brand);
  if (!key) return [];
  return (articles || [])
    .filter((a) => sameBrand(a.brand, dev.brand) && (Array.isArray(a.models) ? a.models : []).some((m) => normModel(m, a.brand) === key))
    .sort(byTitle);
}

export const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ru', { numeric: true });

// ---------- поиск ----------

// Поиск по заголовку, моделям, марке, категории и тексту. Все слова запроса должны найтись;
// выше — совпавшие в заголовке, затем в моделях, затем в тексте.
export function searchArticles(list, q) {
  const words = lowText(q).split(' ').filter(Boolean);
  const all = [...(list || [])];
  if (!words.length) return all.sort(byTitle);
  const scored = [];
  const qc = normModel(q);
  for (const a of all) {
    const list = Array.isArray(a.models) ? a.models : [];
    const title = lowText(a.title);
    const models = lowText(list.join(' '));
    const compact = list.map((m) => normModel(m)).join(' ');
    const hay = [title, models, compact, lowText(a.brand), lowText(a.category), lowText(a.deviceType), lowText(a.body)].join('\n');
    const byModel = qc.length > 2 && compact.includes(qc);
    if (!byModel && !words.every((w) => hay.includes(w))) continue;
    const score = words.every((w) => title.includes(w)) ? 0 : byModel || words.every((w) => models.includes(w)) ? 1 : 2;
    scored.push([score, a]);
  }
  return scored.sort((x, y) => x[0] - y[0] || byTitle(x[1], y[1])).map((x) => x[1]);
}

// ---------- стартовые статьи ----------

const SLUG = /^[a-z0-9-]+$/;
const isStr = (v) => typeof v === 'string';

// Проверка одной статьи по FORMAT.md → текст причины или ''.
export function articleProblem(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'не объект';
  if (!isStr(a.slug) || !SLUG.test(a.slug) || a.slug.length > 100) return 'slug: латиница, цифры и дефис';
  if (!isStr(a.title) || !a.title.trim()) return 'нет заголовка';
  if (a.title.length > 200) return 'заголовок длиннее 200 знаков';
  if (a.category != null && a.category !== '' && !CATEGORIES.includes(a.category)) return `неизвестная категория «${a.category}»`;
  for (const f of ['brand', 'deviceType', 'checked']) if (a[f] != null && !isStr(a[f])) return `${f}: должна быть строка`;
  if (a.checked && !/^\d{4}-\d{2}-\d{2}$/.test(a.checked)) return 'checked: дата ГГГГ-ММ-ДД';
  if (a.models != null && (!Array.isArray(a.models) || !a.models.every(isStr))) return 'models: массив строк';
  if (!isStr(a.body) || !a.body.trim()) return 'нет текста';
  if (a.body.length > BODY_MAX) return `текст длиннее ${BODY_MAX} знаков`;
  if (a.sources != null && (!Array.isArray(a.sources)
    || !a.sources.every((s) => s && isStr(s.title) && isStr(s.url) && SAFE_URL.test(s.url)))) return 'sources: массив {title, url} с http(s)-ссылками';
  return '';
}

// Запись для сервера: только поля коллекции, пробелы по краям убраны; seedHash — хеш содержимого (см. updatePlan).
export function seedRecord(a) {
  const rec = {
    slug: a.slug, title: a.title.trim(), category: a.category || '', brand: a.brand || '', deviceType: a.deviceType || '',
    models: (a.models || []).map((m) => m.trim()).filter(Boolean), body: a.body,
    sources: (a.sources || []).map((s) => ({ title: s.title.trim(), url: s.url.trim() })), checked: a.checked || '',
  };
  rec.seedHash = contentHash(rec);
  return rec;
}

// Поля, которые сравниваются при обновлении стартовых статей (slug, updatedBy, даты — не содержимое).
export const CONTENT_FIELDS = ['title', 'category', 'brand', 'deviceType', 'models', 'body', 'sources', 'checked'];

const str = (v) => (v == null ? '' : String(v));
const tstr = (v) => str(v).trim();

// Содержимое статьи в фиксированном порядке CONTENT_FIELDS — одинаково для записи из базы и статьи из файла
// (null/нет поля = пусто, порядок ключей в объектах не важен, пробелы по краям и \r\n против \n — не правка).
function canonical(a) {
  const o = a || {};
  return [
    tstr(o.title), tstr(o.category), tstr(o.brand), tstr(o.deviceType),
    (Array.isArray(o.models) ? o.models : []).map(tstr).filter(Boolean),
    str(o.body).replace(/\r\n?/g, '\n').trim(),
    (Array.isArray(o.sources) ? o.sources : []).map((s) => [tstr(s?.title), tstr(s?.url)]),
    tstr(o.checked),
  ];
}

// Устойчивый хеш содержимого статьи: FNV-1a по JSON полей CONTENT_FIELDS, две 32-битные дорожки → 16 hex-знаков.
export function contentHash(a) {
  const text = JSON.stringify(canonical(a));
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h2 >>> 15);
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

// existing — статьи в базе, seed — статьи из файлов. Для статьи seed с уже существующим slug:
//  содержимое совпадает → same (stamp — проставить seedHash, если его нет или он устарел);
//  есть seedHash и запись не правили (contentHash = seedHash) → update — заменить новой версией;
//  есть seedHash, но запись правили вручную → edited — не трогаем;
//  нет seedHash (загружена до этой доработки) и содержимое другое → legacy — заменять только с согласия владельца.
// → {fresh: [записи к созданию], update: [{id, rec}], edited: [{id, title}], legacy: [{id, rec, title}], same: N,
//    stamp: [{id, seedHash}], bad: [{slug, title, reason}]}; повтор slug внутри seed — в bad.
export function updatePlan(existing, seed) {
  const have = new Map((existing || []).filter((a) => a && a.slug).map((a) => [a.slug, a]));
  const seen = new Set();
  const plan = { fresh: [], update: [], edited: [], legacy: [], same: 0, stamp: [], bad: [] };
  for (const a of Array.isArray(seed) ? seed : []) {
    const reason = articleProblem(a);
    const slug = a && isStr(a.slug) ? a.slug : '';
    const title = a && isStr(a.title) ? a.title : '';
    if (reason) { plan.bad.push({ slug, title, reason }); continue; }
    if (seen.has(slug)) { plan.bad.push({ slug, title, reason: 'повтор slug в стартовых файлах' }); continue; }
    seen.add(slug);
    const rec = seedRecord(a);
    const ex = have.get(slug);
    if (!ex) { plan.fresh.push(rec); continue; }
    const cur = contentHash(ex);
    if (cur === rec.seedHash) {
      plan.same++;
      if (ex.seedHash !== rec.seedHash && ex.id) plan.stamp.push({ id: ex.id, seedHash: rec.seedHash });
    } else if (ex.seedHash) {
      if (cur === ex.seedHash) plan.update.push({ id: ex.id, rec });
      else plan.edited.push({ id: ex.id, title: str(ex.title) || slug });
    } else plan.legacy.push({ id: ex.id, rec, title: str(ex.title) || slug });
  }
  return plan;
}

// Только новые по slug: {fresh, already: N статей seed, которые уже есть в базе, bad}.
export function seedPlan(existing, seed) {
  const p = updatePlan(existing, seed);
  return { fresh: p.fresh, already: p.same + p.update.length + p.edited.length + p.legacy.length, bad: p.bad };
}

// ---------- редактор ----------

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

// Заголовок → slug: «Вздутие батареи» → «vzdutie-batarei». Если занят — с номером: «…-2».
export function slugify(title, taken = []) {
  const base = String(title ?? '').toLowerCase().split('').map((c) => (c in TRANSLIT ? TRANSLIT[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'statya';
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) if (!set.has(`${base}-${n}`)) return `${base}-${n}`;
}

// Источники в редакторе: строка «Название | https://…» или просто ссылка. → {sources, error}
export function parseSources(text) {
  const sources = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const k = line.lastIndexOf('|');
    const url = (k >= 0 ? line.slice(k + 1) : line).trim();
    const title = (k >= 0 ? line.slice(0, k) : '').trim() || url;
    if (!SAFE_URL.test(url)) return { sources, error: `Источник «${line}»: нужна ссылка http:// или https://` };
    sources.push({ title, url });
  }
  return { sources, error: '' };
}

export const sourcesText = (list) => (Array.isArray(list) ? list : []).map((s) => (s.title && s.title !== s.url ? `${s.title} | ${s.url}` : s.url)).join('\n');

// Модели через запятую → массив без пустых и повторов (по ключу normModel).
export function parseModels(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text ?? '').split(/[,;\n]/)) {
    const v = m.trim();
    const k = normModel(v);
    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}
