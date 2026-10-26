// Вкладка «База знаний»: статьи по моделям устройств и общие. Читают все; добавляет, правит и удаляет только владелец.
// navigate('kb', {slug}) — открыть статью; navigate('kb', {model}) — список статей по модели (из карточки заказа).
// Чистые функции (Markdown, поиск, подбор по модели, стартовые статьи) — в kb-lib.js.
import {
  CATEGORIES, BRANDS, DEVICE_TYPES, SEED_FILES, BODY_MAX, renderMd, articlesForOrder, searchArticles, updatePlan, byTitle,
  slugify, parseSources, sourcesText, parseModels,
} from './kb-lib.js';
import { plural } from '../fmt.js';

const state = { q: '', cat: '', brand: '*', model: '', slug: '' };
const GENERAL = ''; // фильтр «Общие» — статьи без марки

export default {
  id: 'kb',
  title: 'База знаний',
  render(el, ctx) {
    const p = ctx.params || {};
    if (ctx.reason === 'navigate') {
      state.slug = p.slug || '';
      state.model = p.slug ? state.model : (p.model || '');
      if (p.model) { state.q = ''; state.cat = ''; state.brand = '*'; }
    }
    const art = state.slug && ctx.store.data.kb_articles.find((a) => a.slug === state.slug);
    if (art) renderArticle(el, ctx, art); else { state.slug = ''; renderList(el, ctx); }
  },
};

// ---------- список ----------

function renderList(el, ctx) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const all = store.data.kb_articles;
  const owner = store.isOwner;

  if (!all.length) {
    el.innerHTML = `<div class="head"><h2>База знаний</h2>${owner ? '<button type="button" class="btn ghost" data-new>+ Статья</button>' : ''}</div>
      <div class="sect kb-empty">${owner
        ? `<p>Статей пока нет. Загрузите стартовые статьи — по моделям iPhone, популярным Android и общие (приём, диагностика, безопасность) — или напишите свою.</p>
          <div class="actions kb-left"><button type="button" class="btn" data-seed>Загрузить / обновить стартовые статьи</button></div>`
        : '<p class="muted">Статей пока нет.</p>'}</div>`;
    bindOwner(el, ctx);
    return;
  }

  const cats = CATEGORIES.filter((c) => all.some((a) => a.category === c));
  const extraCats = [...new Set(all.map((a) => a.category).filter((c) => c && !CATEGORIES.includes(c)))].sort();
  const brands = [...new Set(all.map((a) => a.brand).filter(Boolean))].sort((a, b) => {
    const i = BRANDS.indexOf(a); const j = BRANDS.indexOf(b);
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b);
  });
  const hasGeneral = all.some((a) => !a.brand);
  const chip = (attr, v, cur, label) => `<button type="button" class="chip btnlike${v === cur ? ' on' : ''}" data-${attr}="${esc(v)}" aria-pressed="${v === cur}">${esc(label)}</button>`;

  el.innerHTML = `<div class="head"><h2>База знаний</h2>
      ${owner ? `<div class="kb-own"><button type="button" class="btn ghost" data-seed>Загрузить / обновить стартовые статьи</button><button type="button" class="btn" data-new>+ Статья</button></div>` : ''}</div>
    ${state.model ? `<div class="kb-model"><span>Статьи по модели <b>${esc(state.model)}</b></span><button type="button" class="btn ghost sm" data-unmodel>Показать все статьи</button></div>` : ''}
    <div class="toolbar kb-tools">
      <input type="search" class="kb-q" placeholder="Поиск: модель, неисправность, слово из текста" value="${esc(state.q)}" aria-label="Поиск по базе знаний">
    </div>
    <div class="kb-chips" role="group" aria-label="Категория">${chip('cat', '', state.cat, 'Все темы')}${[...cats, ...extraCats].map((c) => chip('cat', c, state.cat, c)).join('')}</div>
    ${brands.length ? `<div class="kb-chips" role="group" aria-label="Марка">${chip('brand', '*', state.brand, 'Все марки')}${brands.map((b) => chip('brand', b, state.brand, b)).join('')}${hasGeneral ? chip('brand', GENERAL, state.brand, 'Общие') : ''}</div>` : ''}
    <div class="kb-list"></div>`;

  const listEl = el.querySelector('.kb-list');
  const draw = () => {
    let list = state.model ? articlesForOrder(all, { model: state.model }) : all;
    if (state.cat) list = list.filter((a) => a.category === state.cat);
    if (state.brand !== '*') list = list.filter((a) => (a.brand || '') === state.brand);
    list = state.q.trim() ? searchArticles(list, state.q) : [...list].sort(byTitle);
    listEl.innerHTML = list.length
      ? `<p class="muted small kb-count">${list.length} ${plural(list.length, 'статья', 'статьи', 'статей')}</p>
        <div class="kb-cards">${list.map((a) => card(a, esc)).join('')}</div>`
      : `<p class="empty">${state.model ? `По модели «${esc(state.model)}» статей нет.` : 'Ничего не найдено.'}</p>`;
    listEl.querySelectorAll('[data-slug]').forEach((b) => b.addEventListener('click', () => ctx.navigate('kb', { slug: b.dataset.slug })));
  };
  draw();

  const q = el.querySelector('.kb-q');
  q.addEventListener('input', () => { state.q = q.value; draw(); });
  el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { state.cat = b.dataset.cat; renderList(el, ctx); }));
  el.querySelectorAll('[data-brand]').forEach((b) => b.addEventListener('click', () => { state.brand = b.dataset.brand; renderList(el, ctx); }));
  el.querySelector('[data-unmodel]')?.addEventListener('click', () => { state.model = ''; renderList(el, ctx); });
  bindOwner(el, ctx);
}

function card(a, esc) {
  const models = Array.isArray(a.models) ? a.models : [];
  const shown = models.slice(0, 4).join(', ') + (models.length > 4 ? ` и ещё ${models.length - 4}` : '');
  const meta = [a.category, a.brand || 'Общая', a.deviceType].filter(Boolean).join(' · ');
  return `<button type="button" class="kb-card" data-slug="${esc(a.slug)}">
    <span class="kb-ct">${esc(a.title)}</span>
    ${shown ? `<span class="kb-cm">${esc(shown)}</span>` : ''}
    <span class="kb-cmeta">${esc(meta)}</span></button>`;
}

function bindOwner(el, ctx) {
  el.querySelector('[data-new]')?.addEventListener('click', () => editDialog(ctx, null));
  el.querySelector('[data-seed]')?.addEventListener('click', (e) => loadSeed(ctx, e.currentTarget));
}

// ---------- статья ----------

function renderArticle(el, ctx, a) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const owner = store.isOwner;
  const models = Array.isArray(a.models) ? a.models : [];
  const sources = (Array.isArray(a.sources) ? a.sources : []).filter((s) => s && /^https?:\/\//i.test(String(s.url || '')));
  const meta = [a.category, a.brand, a.deviceType].filter(Boolean);
  const who = a.updatedBy ? ui.userName(a.updatedBy) : '';

  el.innerHTML = `<div class="kb-art">
    <div class="kb-ah">
      <button type="button" class="kb-back" data-back aria-label="К списку статей" title="К списку статей">←</button>
      <h2>${esc(a.title)}</h2>
      ${owner ? `<span class="kb-gap"></span><button type="button" class="btn ghost sm" data-edit>Изменить</button><button type="button" class="btn danger sm" data-del>Удалить</button>` : ''}
    </div>
    <div class="kb-meta">${meta.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}
      ${models.length ? `<span class="muted small">Модели: ${esc(models.join(', '))}</span>` : ''}</div>
    <article class="sect kb-body">${renderMd(a.body)}</article>
    ${sources.length ? `<section class="sect kb-src"><h3>Источники</h3><ol>${sources.map((s) =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ol></section>` : ''}
    <p class="muted small kb-foot">${a.checked ? `Проверено ${esc(ui.fmtDate(a.checked))}` : 'Дата проверки не указана'}${
      a.updated ? ` · изменено ${esc(ui.fmtDate(a.updated))}${who && who !== '—' ? ` (${esc(who)})` : ''}` : ''}</p>
  </div>`;

  el.querySelector('[data-back]').addEventListener('click', () => ctx.navigate('kb', state.model ? { model: state.model } : {}));
  el.querySelector('[data-edit]')?.addEventListener('click', () => editDialog(ctx, a));
  el.querySelector('[data-del]')?.addEventListener('click', async (e) => {
    if (!(await ui.confirmDlg(`Удалить статью «${a.title}»?`, { ok: 'Удалить' }))) return;
    try {
      await ui.busy(e.currentTarget, store.remove('kb_articles', a.id));
      ui.toast('Статья удалена');
      ctx.navigate('kb', state.model ? { model: state.model } : {});
    } catch (err) { ui.showError(err); }
  });
}

// ---------- редактор (панель справа) ----------

function editDialog(ctx, a) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const isNew = !a;
  const v = a || { title: '', category: '', brand: '', deviceType: '', models: [], body: '', sources: [], checked: ui.toInputDate(new Date()) };
  const box = ui.openModal(`<div class="dr-head"><h2>${isNew ? 'Новая статья' : 'Изменить статью'}</h2><button type="button" class="x-close" data-close aria-label="Закрыть">×</button></div>
    <div class="dr-body"><form id="kbForm" novalidate>
      <div class="fields">
        <label class="full">Заголовок *<input name="title" maxlength="200" value="${esc(v.title)}" autofocus></label>
        <label>Тема<select name="category"><option value="">— без темы —</option>${ui.options(CATEGORIES, v.category)}${v.category && !CATEGORIES.includes(v.category) ? ui.options([v.category], v.category) : ''}</select></label>
        <label>Марка<input name="brand" list="kbBrands" maxlength="60" placeholder="пусто — общая статья" value="${esc(v.brand || '')}"></label>
        <label>Тип устройства<select name="deviceType"><option value="">— любой —</option>${ui.options(DEVICE_TYPES, v.deviceType)}</select></label>
        <label>Проверено<input name="checked" type="date" value="${esc(v.checked || '')}"></label>
        <label class="full">Модели — через запятую, как в заказе (без марки)<input name="models" placeholder="iPhone 13, iPhone 13 mini" value="${esc((v.models || []).join(', '))}"></label>
        <label class="full">Источники — по строке: «Название | https://…»<textarea name="sources" rows="3" placeholder="Apple — поддержка | https://support.apple.com/…">${esc(sourcesText(v.sources))}</textarea></label>
      </div>
      <h3 class="dr-sect">Текст (Markdown)</h3>
      <p class="muted small">## Заголовок, - список, 1. список, **жирный**, *курсив*, \`код\`, [текст](https://…), таблица | a | b | со строкой |---|---|, > цитата.</p>
      <textarea name="body" class="kb-md" rows="14" maxlength="${BODY_MAX}">${esc(v.body || '')}</textarea>
      <h3 class="dr-sect">Предпросмотр</h3>
      <div class="kb-prev kb-body"></div>
      <datalist id="kbBrands">${BRANDS.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      <div class="err" hidden></div>
    </form></div>
    <div class="dr-foot"><button type="button" class="btn ghost" data-close>Отмена</button><button type="submit" class="btn" form="kbForm">${isNew ? 'Создать статью' : 'Сохранить'}</button></div>`, null, {
    sticky: true, drawer: true, confirmClose: () => (snap() !== state0 ? 'Закрыть без сохранения? Изменения пропадут' : ''),
  });
  const form = box.querySelector('#kbForm');
  const errBox = form.querySelector('.err');
  const prev = form.querySelector('.kb-prev');
  const snap = () => JSON.stringify([...form.elements].filter((x) => x.name).map((x) => x.value));
  const state0 = snap();
  const preview = () => { prev.innerHTML = form.body.value.trim() ? renderMd(form.body.value) : '<p class="muted small">Здесь появится статья.</p>'; };
  preview();
  let t = 0;
  form.body.addEventListener('input', () => { clearTimeout(t); t = setTimeout(preview, 150); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = ui.formData(form);
    const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; };
    errBox.hidden = true;
    if (!f.title) return fail('Напишите заголовок статьи');
    if (!form.body.value.trim()) return fail('Напишите текст статьи');
    const src = parseSources(f.sources);
    if (src.error) return fail(src.error);
    const rec = {
      title: f.title, category: f.category, brand: f.brand, deviceType: f.deviceType, checked: f.checked,
      models: parseModels(f.models), sources: src.sources, body: form.body.value, updatedBy: store.me.id,
    };
    if (isNew) rec.slug = slugify(f.title, store.data.kb_articles.map((x) => x.slug));
    const btn = box.querySelector('button[type=submit]');
    try {
      const saved = await ui.busy(btn, isNew ? store.create('kb_articles', rec) : store.update('kb_articles', a.id, rec));
      ui.closeModal();
      ui.toast(isNew ? 'Статья создана' : 'Статья сохранена');
      ctx.navigate('kb', { slug: saved.slug });
    } catch (err) { fail(ui.showError(err)); }
  });
}

// ---------- стартовые статьи ----------

// Кнопка владельца «Загрузить / обновить стартовые статьи»: читает pb_public/kb/*.json, раскладывает по
// kb-lib.updatePlan и показывает сводку. Новые создаются (только по отсутствующему slug), не правленные
// владельцем — обновляются по id, правленые вручную — не трогаются, загруженные до seedHash — только с галочкой.
async function readSeed(ui) {
  const seed = [];
  for (const file of SEED_FILES) {
    try {
      const r = await fetch(file, { cache: 'no-cache' });
      // нет файла: 404 или (без него) index.html вместо JSON
      if (!r.ok || !/json/i.test(r.headers.get('content-type') || '')) { ui.toast(`Файл ${file} не найден — пропущен`, 'warn'); continue; }
      const json = await r.json();
      if (!Array.isArray(json)) { ui.toast(`Файл ${file}: ожидается список статей — пропущен`, 'warn'); continue; }
      seed.push(...json);
    } catch (e) {
      ui.toast(`Файл ${file} не читается — пропущен`, 'warn');
    }
  }
  return seed;
}

async function loadSeed(ctx, btn) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const seed = await ui.busy(btn, () => readSeed(ui));
  if (!seed.length) { ui.toast('Стартовых статей не найдено', 'warn'); return; }
  const plan = updatePlan(store.data.kb_articles, seed);
  if (plan.bad.length) console.warn('База знаний: пропущены статьи с ошибками', plan.bad);

  const titles = (list) => (list.length ? `<ul class="kb-titles">${list.map((x) => `<li>${esc(x.title)}</li>`).join('')}</ul>` : '');
  const row = (label, n, extra = '') => `<li><span>${label}: <b>${n}</b></span>${extra}</li>`;
  const box = ui.openModal(`<div class="head"><h2>Стартовые статьи</h2><button type="button" class="x-close" data-close aria-label="Закрыть">×</button></div>
    <ul class="kb-plan">
      ${row('Новых', plan.fresh.length)}
      ${row('Обновятся', plan.update.length)}
      ${plan.edited.length ? row('Изменены вами — не трогаем', plan.edited.length, titles(plan.edited)) : ''}
      ${plan.legacy.length ? row('Загружены раньше, могли быть изменены', plan.legacy.length, `${titles(plan.legacy)}
        <label class="check"><input type="checkbox" data-legacy> заменить и их новой версией (ваши правки в них пропадут)</label>`) : ''}
      ${row('Без изменений', plan.same)}
      ${plan.bad.length ? row('С ошибками — пропущены', plan.bad.length, `<ul class="kb-titles">${plan.bad.slice(0, 5).map((b) =>
        `<li>${esc(b.slug || b.title || '?')} — ${esc(b.reason)}</li>`).join('')}${plan.bad.length > 5 ? '<li>…</li>' : ''}</ul>`) : ''}
    </ul>
    <div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button type="button" class="btn" data-apply>Применить</button></div>`);
  const apply = box.querySelector('[data-apply]');
  const legacyBox = box.querySelector('[data-legacy]');
  const work = () => plan.fresh.length + plan.update.length + plan.stamp.length + (legacyBox?.checked ? plan.legacy.length : 0);
  const sync = () => { apply.disabled = !work(); };
  legacyBox?.addEventListener('change', sync);
  sync();

  apply.addEventListener('click', async () => {
    const withLegacy = !!legacyBox?.checked;
    const res = { made: 0, updated: 0, failed: 0 };
    let firstErr = null;
    const run = async (fn) => {
      try { await fn(); return true; } catch (e) {
        res.failed++;
        firstErr = firstErr || e;
        console.warn('kb seed', e);
        if (e.isNetwork || e.status === 0) throw e; // сеть пропала — дальше не идём
        return false;
      }
    };
    // обновление по id: поля статьи + seedHash новой версии; slug не меняется
    const patch = ({ id, rec }) => { const { slug, ...fields } = rec; return store.update('kb_articles', id, { ...fields, updatedBy: store.me.id }); };
    try {
      await ui.busy(apply, async () => {
        for (const rec of plan.fresh) {
          if (store.data.kb_articles.some((x) => x.slug === rec.slug)) continue; // уже есть — дубль не создаём
          if (await run(() => store.create('kb_articles', { ...rec, updatedBy: store.me.id }))) res.made++;
        }
        for (const u of [...plan.update, ...(withLegacy ? plan.legacy : [])]) if (await run(() => patch(u))) res.updated++;
        // совпадает с файлом, но seedHash нет или устарел — проставить, чтобы следующие версии обновлялись сами
        for (const s of plan.stamp) await run(() => store.update('kb_articles', s.id, { seedHash: s.seedHash }));
      });
    } catch (_) { /* итог — ниже */ }
    ui.closeModal();
    if (firstErr) ui.showError(firstErr);
    const parts = [`новых ${res.made}`, `обновлено ${res.updated}`];
    if (res.failed) parts.push(`не удалось ${res.failed}`);
    ui.toast(`Стартовые статьи: ${parts.join(', ')}`, res.failed ? 'warn' : 'ok');
  });
}
