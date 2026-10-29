// Общие помощники интерфейса: форматирование, модалка, тосты, ошибки, печать.
import { store } from './store.js';
import { esc } from './fmt.js';

const $ = (s) => document.querySelector(s);

// ---------- форматирование (общее с calc/order-lib/cash — в fmt.js) ----------

export { esc, money, toDate, fmtDate, fmtDateTime, toInputDate, fromInputDate, today, digits, plural, normPhone, fmtPhone, phoneMatch, phoneValid, PHONE_ERR, noPhone, PHONE_OR_DASH } from './fmt.js';
import { fmtPhone, phoneTyping } from './fmt.js';
import { xlsxBook, XLSX_TYPE } from './xlsx.js';

// Любое поле телефона (type=tel): номер всегда начинается с 8; после ввода — «8 900 123-45-67».
// Перехват на document в фазе захвата — раньше обработчиков самих форм, они видят уже исправленный номер.
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.type !== 'tel') return;
  const v = phoneTyping(t.value);
  if (v !== t.value) t.value = v;
}, true);
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.type !== 'tel') return;
  const v = fmtPhone(t.value);
  if (v !== t.value) t.value = v;
}, true);

// <option>…: list — строки, [value, label] или объекты; label — имя поля или функция (по умолчанию name).
export function options(list, value, label = 'name') {
  return (list || []).map((x) => {
    let v;
    let t;
    if (Array.isArray(x)) [v, t] = x;
    else if (x && typeof x === 'object') { v = x.id; t = typeof label === 'function' ? label(x) : x[label]; }
    else { v = x; t = x; }
    return `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(t)}</option>`;
  }).join('');
}

export function userName(id) {
  const u = id && (store.data.users || []).find((x) => x.id === id);
  return u ? (u.name || u.email || '—') : '—';
}

export function pointName(id) {
  const p = id && (store.data.points || []).find((x) => x.id === id);
  return p ? p.name : '—';
}

// ---------- формы ----------

// Поля формы → объект. checkbox → bool, type=number → число (пусто → 0), остальное — строка без пробелов по краям.
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number') out[el.name] = el.value === '' ? 0 : Number(el.value);
    else if (el.tagName === 'SELECT' && el.multiple) out[el.name] = [...el.selectedOptions].map((o) => o.value);
    else out[el.name] = typeof el.value === 'string' && el.type !== 'password' ? el.value.trim() : el.value;
  }
  return out;
}

// Блокирует кнопку до ответа (защита от двойного нажатия). Возвращает результат promise.
export async function busy(button, promise) {
  if (button) { button.disabled = true; button.dataset.busy = '1'; }
  try {
    return await (typeof promise === 'function' ? promise() : promise);
  } finally {
    if (button) { button.disabled = false; delete button.dataset.busy; }
  }
}

// ---------- модалка ----------

export const isModalOpen = () => !!$('#modal')?.firstElementChild;

// Открывает модалку (одна за раз; новая заменяет старую). onMount(box) вызывается после вставки.
// Закрытие: кнопка [data-close], Esc, клик по подложке (если не sticky).
// drawer: true — панель справа на всю высоту; разметка внутри: .dr-head (h2 + ×), .dr-body (прокрутка), .dr-foot (кнопки;
// submit связывается с формой атрибутом form=). Панель закрывается по Esc и при sticky — sticky держит только клик по подложке.
// confirmClose() → текст вопроса или '': если вернул текст, Esc сначала спрашивает подтверждение (× и «Отмена» закрывают сразу).
const closeGuards = new WeakMap();
export function openModal(html, onMount, { sticky = false, drawer = false, confirmClose = null } = {}) {
  const root = $('#modal');
  const cls = drawer ? ' drawer' : '';
  root.innerHTML = `<div class="overlay${cls}"><div class="modal${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  const overlay = root.firstElementChild;
  const box = overlay.firstElementChild;
  overlay.dataset.sticky = sticky && !drawer ? '1' : '';
  if (confirmClose) closeGuards.set(overlay, confirmClose);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !sticky) closeModal(); });
  box.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  if (onMount) onMount(box);
  const f = box.querySelector('[autofocus]') || box.querySelector('input:not([type=hidden]),select,textarea');
  if (f) f.focus();
  return box;
}

export function closeModal() {
  const root = $('#modal');
  if (!root || !root.firstElementChild) return;
  fadeAway(root.firstElementChild);
  root.innerHTML = '';
  document.dispatchEvent(new Event('ui:modalclose'));
}

// Анимация закрытия: #modal очищается сразу (состояние «модалка закрыта» не ждёт),
// а на месте окна на 0.2 с остаётся неактивная копия без id, которая плавно гаснет.
function fadeAway(overlay) {
  const ghost = overlay.cloneNode(true);
  ghost.classList.add('leaving');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll('[id],[name],[autofocus]').forEach((n) => { n.removeAttribute('id'); n.removeAttribute('name'); n.removeAttribute('autofocus'); });
  ghost.removeAttribute('id');
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), 200);
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#confirm')?.firstElementChild) return; // окно подтверждения закрывается само
  const ov = $('#modal')?.firstElementChild;
  if (!ov || ov.dataset.sticky) return;
  if (e.defaultPrevented) return; // Esc уже обработан внутри (например, закрыт выпадающий список)
  const ask = closeGuards.get(ov)?.();
  if (!ask) { closeModal(); return; }
  const back = document.activeElement;
  confirmDlg(ask, { ok: 'Закрыть', cancel: 'Отмена' }).then((yes) => {
    if ($('#modal')?.firstElementChild !== ov) return;
    if (yes) closeModal(); else if (back && ov.contains(back)) back.focus();
  });
});

// Подтверждение поверх модалки. → Promise<bool>
export function confirmDlg(text, { ok = 'Да', cancel = 'Отмена', danger = true } = {}) {
  return new Promise((resolve) => {
    const root = $('#confirm');
    root.innerHTML = `<div class="overlay top"><div class="modal small" role="alertdialog" aria-modal="true">
      <p>${esc(text)}</p>
      <div class="actions"><button class="btn ghost" data-v="0">${esc(cancel)}</button>
      <button class="btn${danger ? ' danger' : ''}" data-v="1">${esc(ok)}</button></div></div></div>`;
    const done = (v) => { root.innerHTML = ''; document.removeEventListener('keydown', key, true); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    root.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => done(b.dataset.v === '1')));
    root.querySelector('[data-v="1"]').focus();
  });
}

// ---------- сообщения ----------

// opts.onClick — тост кликабельный (клик вызывает и закрывает); opts.ms — сколько держать.
export function toast(text, kind = 'ok', opts = {}) {
  const root = $('#toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind + (opts.onClick ? ' click' : '');
  el.textContent = text;
  const hide = () => {
    if (el.classList.contains('out')) return;
    el.classList.add('out'); // уезжает вправо, затем удаляется
    setTimeout(() => el.remove(), 200);
  };
  if (opts.onClick) el.addEventListener('click', () => { hide(); opts.onClick(); });
  root.appendChild(el);
  setTimeout(hide, opts.ms || (kind === 'error' ? 6000 : 3000));
}

export const OFFLINE_TEXT = 'Нет связи с сервером, изменения не сохранены';

export function setOffline(on) {
  const el = $('#offline');
  if (el) el.hidden = !on;
}

const FIELD_NAMES = {
  email: 'Почта', password: 'Пароль', passwordConfirm: 'Повтор пароля', name: 'Имя', phone: 'Телефон',
  title: 'Название', model: 'Модель', price: 'Цена', qty: 'Количество', amount: 'Сумма',
};
const CODES = {
  validation_required: 'обязательно для заполнения',
  validation_not_unique: 'уже занято',
  validation_is_email: 'неверный формат почты',
  validation_invalid_email: 'неверный формат почты',
  validation_min_text_constraint: 'слишком короткое',
  validation_length_out_of_range: 'неверная длина',
  validation_values_mismatch: 'не совпадает',
  validation_invalid_number: 'должно быть числом',
};
const hasCyr = (s) => /[а-яё]/i.test(String(s || ''));

// Текст ошибки PocketBase по-русски.
export function errorText(err) {
  if (!err) return 'Неизвестная ошибка';
  if (typeof err === 'string') return err;
  if (err.status === 0 || err.isNetwork) return OFFLINE_TEXT;
  const r = err.response || err.data || {};
  const data = r.data || {};
  const fields = Object.entries(data).filter(([, v]) => v && typeof v === 'object' && (v.code || v.message));
  if (fields.length) {
    return fields.map(([k, v]) => {
      const msg = hasCyr(v.message) ? v.message : (CODES[v.code] || 'неверное значение');
      return `${FIELD_NAMES[k] || k}: ${msg}`;
    }).join('; ');
  }
  const m = r.message || err.message || '';
  if (hasCyr(m)) return m;
  if (err.status === 400 && /authenticate/i.test(m)) return 'Неверная почта или пароль';
  if (err.status === 401) return 'Нужно войти заново';
  if (err.status === 403) return 'Недостаточно прав';
  if (err.status === 404) return 'Запись не найдена';
  if (err.status === 400) return 'Проверьте заполнение полей';
  return 'Ошибка сервера' + (err.status ? ` (${err.status})` : '');
}

// Показывает ошибку тостом (сеть → плашка). Возвращает текст.
export function showError(err) {
  const t = errorText(err);
  if (err && (err.status === 0 || err.isNetwork)) setOffline(true);
  else toast(t, 'error');
  if (!(err && (err.status === 0 || err.status >= 400))) console.error(err);
  return t;
}

// ---------- выгрузка в Excel ----------

// Скачать оформленную книгу Excel: sheets — листы для xlsx.xlsxBook. Имя файла без расширения.
export function downloadXlsx(name, sheets) {
  const url = URL.createObjectURL(new Blob([xlsxBook(sheets)], { type: XLSX_TYPE }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.xlsx` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- печать ----------

export function printHtml(html) {
  const el = $('#print');
  el.innerHTML = html;
  const clear = () => { el.innerHTML = ''; window.removeEventListener('afterprint', clear); };
  window.addEventListener('afterprint', clear);
  window.print();
}
