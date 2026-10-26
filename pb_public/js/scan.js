// Сканер штрихкодов (USB/Bluetooth) работает как клавиатура: «печатает» код очень быстро и жмёт Enter.
// Скан = быстрая серия ≥ MIN_LEN символов, все интервалы < GAP мс, завершённая Enter.
// Чистый модуль: импортируется в node, DOM — только внутри listenScan.

const MIN_LEN = 6;
const GAP = 50;

// times — моменты нажатий (мс) по порядку, text — набранные символы.
export function isScanBurst(times, text) {
  if (String(text || '').length < MIN_LEN || !Array.isArray(times) || times.length < 2) return false;
  for (let i = 1; i < times.length; i++) if (!(times[i] - times[i - 1] < GAP)) return false;
  return true;
}

// Нормализация штрихкода для сравнения: без пробелов по краям и без учёта регистра.
export const normCode = (c) => String(c ?? '').trim().toLowerCase();

// Поиск позиции по штрихкоду: here — на точке point, others — с тем же кодом на других точках.
// kind ('part'|'product') — для единообразия вызовов; пустой код ничего не находит.
export function findByBarcode(kind, list, code, point) {
  const c = normCode(code);
  if (!c) return { here: null, others: [] };
  const same = (list || []).filter((x) => normCode(x.barcode) === c);
  const here = (point && same.find((x) => x.point === point)) || null;
  return { here, others: same.filter((x) => x.point !== point) };
}

const isField = (n) => !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);

// Слушает keydown на target (обычно document, фаза перехвата) и вызывает onCode(code) на скан.
// Ручной ввод не трогает: обычные нажатия проходят как есть. Если сканер «напечатал» код в поле ввода,
// код из поля убирается (значение возвращается к тому, что было до серии), а Enter не доходит до формы.
// Возвращает off() — снять слушатель.
export function listenScan(target, onCode) {
  let text = '';
  let times = [];
  let field = null;
  let before = '';
  const reset = () => { text = ''; times = []; field = null; };

  const onKey = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) { reset(); return; }
    const now = e.timeStamp || Date.now();
    if (e.key === 'Enter') {
      const code = text.trim();
      const ok = isScanBurst([...times, now], code);
      const f = field;
      const was = before;
      reset();
      if (!ok) return;
      e.preventDefault();
      e.stopPropagation();
      if (f && 'value' in f && f.tagName !== 'SELECT' && f.value !== was) {
        f.value = was;
        f.dispatchEvent(new Event('input', { bubbles: true }));
      }
      onCode(code);
      return;
    }
    if (e.key.length !== 1) { if (e.key !== 'Shift') reset(); return; } // Shift сканер шлёт для заглавных
    if (times.length && now - times[times.length - 1] >= GAP) reset();
    if (!times.length) {
      const a = isField(e.target) ? e.target : (typeof document !== 'undefined' ? document.activeElement : null);
      field = isField(a) ? a : null;
      before = field && 'value' in field ? field.value : '';
    }
    text += e.key;
    times.push(now);
  };

  target.addEventListener('keydown', onKey, true);
  return () => target.removeEventListener('keydown', onKey, true);
}
