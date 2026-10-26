// Подсказки формы приёма: марки и модели, неисправности, цвета, внешний вид, цена похожего ремонта.
// Справочник + то, что уже вводили в заказах (частые — первыми). Чистый модуль: импортируется и в node-тестах.

const IPHONES = [
  'iPhone 6', 'iPhone 6s', 'iPhone 6s Plus', 'iPhone 7', 'iPhone 7 Plus', 'iPhone 8', 'iPhone 8 Plus', 'iPhone X', 'iPhone XR',
  'iPhone XS', 'iPhone XS Max', 'iPhone SE 2020', 'iPhone SE 2022', 'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max',
  'iPhone 12 mini', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 12 Pro Max', 'iPhone 13 mini', 'iPhone 13', 'iPhone 13 Pro',
  'iPhone 13 Pro Max', 'iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max', 'iPhone 15', 'iPhone 15 Plus',
  'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 16e', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max',
  'iPhone 17', 'iPhone Air', 'iPhone 17 Pro', 'iPhone 17 Pro Max',
];
const SAMSUNG = [
  'A02', 'A03', 'A04', 'A05', 'A06', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A20', 'A21s', 'A22', 'A23', 'A24', 'A25',
  'A26', 'A30', 'A31', 'A32', 'A33', 'A34', 'A35', 'A36', 'A50', 'A51', 'A52', 'A53', 'A54', 'A55', 'A56', 'A70', 'A71', 'A72', 'A73',
  'M21', 'M31', 'M52', 'S9', 'S10', 'S20', 'S20 FE', 'S21', 'S21 FE', 'S22', 'S22 Ultra', 'S23', 'S23 FE', 'S23 Ultra', 'S24',
  'S24 FE', 'S24 Ultra', 'S25', 'S25 Ultra', 'Note 10', 'Note 20', 'Z Flip 4', 'Z Flip 5', 'Z Fold 5',
].map((m) => `Galaxy ${m}`);
const XIAOMI = [
  'Redmi 9', 'Redmi 9A', 'Redmi 9C', 'Redmi 10', 'Redmi 10C', 'Redmi 12', 'Redmi 12C', 'Redmi 13', 'Redmi 13C', 'Redmi 14C', 'Redmi A3',
  'Redmi Note 8', 'Redmi Note 8 Pro', 'Redmi Note 9', 'Redmi Note 9 Pro', 'Redmi Note 10', 'Redmi Note 10 Pro', 'Redmi Note 11',
  'Redmi Note 11 Pro', 'Redmi Note 12', 'Redmi Note 12 Pro', 'Redmi Note 13', 'Redmi Note 13 Pro', 'Redmi Note 14', 'Redmi Note 14 Pro',
  'Poco X3 Pro', 'Poco X5', 'Poco X6', 'Poco X6 Pro', 'Poco X7', 'Poco F5', 'Poco M5', 'Poco M6', 'Poco C65',
  'Xiaomi 11T', 'Xiaomi 12', 'Xiaomi 12T', 'Xiaomi 13', 'Xiaomi 13T', 'Xiaomi 14', 'Xiaomi 14T',
];

// Справочник: тип устройства → [марка, модели]. Порядок марок — как в списке «Марка».
// MacBook — по страницам Apple «Определение модели MacBook Air / MacBook Pro» (support.apple.com 102869, 108052), новые сверху.
// Одинаковые у Apple названия («14-inch, 2024») различаются чипом: M4 и M4 Pro/Max. До M1 — Intel.
const MACBOOKS = [
  'MacBook Air 13 M5', 'MacBook Air 15 M5', 'MacBook Air 13 M4 2025', 'MacBook Air 15 M4 2025',
  'MacBook Air 13 M3 2024', 'MacBook Air 15 M3 2024', 'MacBook Air 15 M2 2023', 'MacBook Air 13 M2 2022', 'MacBook Air 13 M1 2020',
  'MacBook Air 13 2020 (Intel)', 'MacBook Air 13 2019', 'MacBook Air 13 2018', 'MacBook Air 13 2017', 'MacBook Air 13 2015', 'MacBook Air 11 2015',
  'MacBook Pro 14 M5', 'MacBook Pro 14 M5 Pro/Max', 'MacBook Pro 16 M5 Pro/Max',
  'MacBook Pro 14 M4 2024', 'MacBook Pro 14 M4 Pro/Max 2024', 'MacBook Pro 16 M4 Pro/Max 2024',
  'MacBook Pro 14 M3 2023', 'MacBook Pro 14 M3 Pro/Max 2023', 'MacBook Pro 16 M3 Pro/Max 2023',
  'MacBook Pro 14 M2 Pro/Max 2023', 'MacBook Pro 16 M2 Pro/Max 2023', 'MacBook Pro 13 M2 2022',
  'MacBook Pro 14 M1 Pro/Max 2021', 'MacBook Pro 16 M1 Pro/Max 2021', 'MacBook Pro 13 M1 2020',
  'MacBook Pro 13 2020 (Intel)', 'MacBook Pro 16 2019', 'MacBook Pro 15 2019', 'MacBook Pro 13 2019', 'MacBook Pro 15 2018', 'MacBook Pro 13 2018',
  'MacBook Pro 15 2017', 'MacBook Pro 13 2017', 'MacBook Pro 15 2016', 'MacBook Pro 13 2016', 'MacBook Pro 15 2015', 'MacBook Pro 13 2015',
];

const CATALOG = {
  'Телефон': [
    ['Apple', IPHONES.slice().reverse()], ['Samsung', SAMSUNG], ['Xiaomi', XIAOMI],
    ['Honor', ['10 Lite', '20', '50', '70', '90', 'X6', 'X7', 'X8', 'X9a', 'X9b'].map((m) => `Honor ${m}`)],
    ['Huawei', ['P30', 'P30 Lite', 'P40 Lite', 'Nova 9', 'Nova 11']],
    ['Realme', ['C30', 'C51', 'C53', 'C55', '10', '11', '12'].map((m) => `Realme ${m}`)],
    ['Tecno', ['Spark 10', 'Spark 20', 'Camon 20', 'Pova 5']], ['Infinix', ['Hot 30', 'Hot 40', 'Note 30']],
    ['Vivo', ['Y35', 'Y36']], ['OPPO', ['A17', 'A78']], ['Google', ['Pixel 7', 'Pixel 8']], ['Nokia', ['G21']],
  ],
  'Планшет': [
    ['Apple', ['iPad 9', 'iPad 10', 'iPad Air 4', 'iPad Air 5', 'iPad mini 6', 'iPad Pro 11', 'iPad Pro 12.9']],
    ['Samsung', ['Galaxy Tab A7', 'Galaxy Tab A8', 'Galaxy Tab A9', 'Galaxy Tab S6 Lite', 'Galaxy Tab S9']],
    ['Xiaomi', ['Pad 6', 'Redmi Pad SE']], ['Honor', ['Pad X9']], ['Huawei', ['MatePad 11']], ['Lenovo', ['Tab M10', 'Tab P11']],
  ],
  'Ноутбук': [
    ['Apple', MACBOOKS], ['Asus', []], ['Acer', []], ['Lenovo', []], ['HP', []],
    ['Huawei', ['MateBook']], ['Honor', ['MagicBook']], ['MSI', []], ['Dell', []],
  ],
  'Часы': [['Apple', ['Watch SE', 'Watch Series 8', 'Watch Series 9', 'Watch Ultra']], ['Samsung', ['Galaxy Watch']],
    ['Xiaomi', ['Mi Band', 'Redmi Watch']], ['Huawei', ['Watch', 'Band']], ['Amazfit', []]],
  'Наушники': [['Apple', ['AirPods', 'AirPods Pro', 'AirPods Max']], ['Samsung', ['Galaxy Buds']], ['JBL', []], ['Sony', []]],
};

const FAULTS_PHONE = [
  'Разбит экран', 'Замена аккумулятора', 'Не заряжается', 'Не включается', 'Попала вода', 'Разбита задняя крышка',
  'Не работает сенсор', 'Нет изображения', 'Не слышно собеседника', 'Не работает микрофон', 'Не работает динамик',
  'Не работает камера', 'Разбито стекло камеры', 'Не ловит сеть', 'Не работает Face ID', 'Перезагружается / зависает',
  'Не работают кнопки', 'Прошивка / сброс',
];
const FAULTS_LAPTOP = [
  'Не включается', 'Греется / шумит, чистка', 'Разбит экран', 'Не заряжается', 'Залит', 'Не работает клавиатура',
  'Медленно работает', 'Установка Windows', 'Замена аккумулятора', 'Сломан корпус / петли',
];
export const FAULTS = {
  'Телефон': FAULTS_PHONE,
  'Планшет': FAULTS_PHONE.filter((f) => !/собеседника|Face ID|сеть/.test(f)),
  'Ноутбук': FAULTS_LAPTOP,
  'Часы': ['Разбит экран', 'Замена аккумулятора', 'Не заряжается', 'Не включается', 'Попала вода'],
  'Наушники': ['Не заряжается', 'Не работает один наушник', 'Тихий звук', 'Не подключается', 'Замена аккумулятора'],
};
export const COLORS = ['Чёрный', 'Белый', 'Серый', 'Серебристый', 'Золотой', 'Синий', 'Голубой', 'Зелёный', 'Красный', 'Фиолетовый', 'Розовый', 'Жёлтый'];
// Внешний вид нового заказа по умолчанию — оба пункта есть в APPEARANCE (в списке они отмечены).
export const DEFAULT_APPEARANCE = 'Потёртости по корпусу, следы эксплуатации';
export const APPEARANCE = ['Потёртости по корпусу', 'Следы эксплуатации', 'Без видимых повреждений', 'Царапины', 'Потёртости', 'Сколы', 'Трещины на экране', 'Разбита крышка',
  'Следы влаги', 'Погнут корпус', 'В чехле', 'Без SIM', 'С зарядкой'];

const low = (s) => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

// Значения поля f из заказов: по убыванию частоты, без повторов (без регистра), в самом частом написании.
export function usedValues(orders, f, { deviceType = '', maxLen = 60 } = {}) {
  const map = new Map();
  for (const o of orders || []) {
    if (deviceType && o.deviceType && low(o.deviceType) !== low(deviceType)) continue;
    const v = String(o[f] ?? '').trim();
    if (!v || v.length > maxLen) continue;
    const k = low(v);
    const e = map.get(k) || { n: 0, forms: new Map() };
    e.n++;
    e.forms.set(v, (e.forms.get(v) || 0) + 1);
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.n - a.n)
    .map((e) => [...e.forms].sort((a, b) => b[1] - a[1])[0][0]);
}

// Объединить списки без повторов (без регистра), сохраняя порядок.
export function mergeUnique(...lists) {
  const seen = new Set();
  const out = [];
  for (const v of lists.flat()) {
    const k = low(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

const catalogOf = (deviceType) => CATALOG[deviceType] || (deviceType ? [] : CATALOG['Телефон']);
const ALL = Object.values(CATALOG).flat();
const BRAND_RULES = [[/^(iphone|ipad|macbook|airpods|apple)/, 'Apple'], [/^galaxy/, 'Samsung'], [/^(redmi|poco|mi )/, 'Xiaomi'], [/^pixel/, 'Google']];

// Марка по модели — для старых заказов без марки: «iPhone 11» → Apple, «Redmi Note 12» → Xiaomi.
export function guessBrand(model) {
  const m = low(model);
  if (!m) return '';
  for (const [b] of ALL) if (m.startsWith(low(b) + ' ')) return b;
  for (const [b, models] of ALL) if (models.some((x) => low(x) === m)) return b;
  const rule = BRAND_RULES.find(([re]) => re.test(m));
  return rule ? rule[1] : '';
}

// Устройство целиком: марка + модель без повтора («Xiaomi» + «Xiaomi 13T» → «Xiaomi 13T»).
// Близнец — deviceName() в pb_hooks/lib/expert.js (текст СМС): меняешь условие здесь — поменяй и там.
export function deviceName(o) {
  const brand = String(o?.brand || '').trim();
  const model = String(o?.model || '').trim();
  if (!brand) return model;
  if (!model) return brand;
  return low(model).startsWith(low(brand)) ? model : `${brand} ${model}`;
}

// Единый вид {brand, model}: марка как в справочнике (или угаданная), модель как в справочнике,
// без марки в начале, если в справочнике она так записана («Samsung Galaxy A52» → Samsung / «Galaxy A52»).
export function normDevice(brand, model) {
  let b = String(brand || '').trim() || guessBrand(model);
  const known = ALL.find(([x]) => low(x) === low(b));
  if (known) b = known[0];
  const ofBrand = ALL.filter(([x]) => x === b).flatMap(([, l]) => l);
  let m = String(model || '').trim();
  if (b && low(m).startsWith(low(b) + ' ') && !ofBrand.some((x) => low(x) === low(m))) m = m.slice(b.length + 1);
  return { brand: b, model: ofBrand.find((x) => low(x) === low(m)) || m };
}

// Устройство заказа для показа, поиска, бланка и CSV: марка угадывается у старых заказов без марки
// ({model: 'iPhone 11'} → «Apple iPhone 11»), запись в базе не меняется. Одно правило везде.
export const orderDevice = (o) => deviceName(normDevice(o?.brand, o?.model));

// Марки: встречавшиеся в заказах этого типа (частые первыми), потом справочник.
export function brandOptions(orders, deviceType = '') {
  const withBrand = (orders || []).map((o) => ({ deviceType: o.deviceType, brand: normDevice(o.brand, o.model).brand }));
  return mergeUnique(usedValues(withBrand, 'brand', { deviceType }), catalogOf(deviceType).map(([b]) => b));
}

// Модели [{brand, model}]: уже принятые (частые первыми), потом справочник; brand — только этой марки.
export function modelOptions(orders, deviceType = '', brand = '') {
  const want = low(brand);
  const counts = new Map();
  for (const o of orders || []) {
    if (deviceType && o.deviceType && low(o.deviceType) !== low(deviceType)) continue;
    if (!String(o.model || '').trim() || String(o.model).length > 60) continue;
    const d = normDevice(o.brand, o.model);
    const k = `${low(d.brand)}|${low(d.model)}`;
    const e = counts.get(k) || { d, n: 0 };
    e.n++;
    counts.set(k, e);
  }
  const used = [...counts.values()].sort((a, b) => b.n - a.n).map((e) => e.d);
  const base = catalogOf(deviceType).flatMap(([b, models]) => models.map((model) => ({ brand: b, model })));
  const seen = new Set();
  return [...used, ...base].filter((d) => {
    const k = `${low(d.brand)}|${low(d.model)}`;
    if ((want && low(d.brand) !== want) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Поиск по-человечески: бренд («apple» → iPhone/iPad), русские написания («айфон 11 про», «редми»).
const ALIASES = [
  [/iphone/i, 'apple эпл эппл айфон'], [/ipad/i, 'apple эпл айпад'], [/macbook/i, 'apple эпл макбук'],
  [/airpods/i, 'apple эпл аирподс эйрподс'], [/^apple/i, 'эпл эппл'],
  [/samsung/i, 'самсунг галакси'], [/xiaomi/i, 'сяоми ксиоми ксяоми ми'], [/redmi/i, 'редми'], [/poco/i, 'поко'],
  [/honor/i, 'хонор'], [/huawei/i, 'хуавей хуавэй'], [/realme/i, 'реалми'], [/tecno/i, 'текно техно'],
  [/infinix/i, 'инфиникс'], [/vivo/i, 'виво'], [/oppo/i, 'оппо'], [/pixel|google/i, 'гугл пиксель'], [/nokia/i, 'нокиа'],
  [/lenovo/i, 'леново'], [/asus/i, 'асус'], [/acer/i, 'асер'],
];
const LAT = { а: 'a', с: 'c', е: 'e', о: 'o', к: 'k', р: 'p', х: 'x', м: 'm', т: 't', в: 'b', н: 'h' };
const WORDS = { pro: 'про', max: 'макс', plus: 'плюс', mini: 'мини', ultra: 'ультра', note: 'ноут', air: 'эир аир' };
const hay = (m) => {
  const words = low(m).split(' ');
  const extra = ALIASES.filter(([re]) => re.test(m)).map(([, a]) => a);
  // + копия с s→c: русская «с» в «с23» читается как S (S23), а как латинская c — в C55, 9C
  return [low(m), low(m).replace(/s/g, 'c'), ...extra, ...words.map((w) => WORDS[w] || '')].join(' ');
};

// Марки (строки) или модели ({brand, model}), где есть каждое слово запроса; начинающиеся с запроса — выше.
export function searchModels(items, query, limit = 12) {
  // «а52», «с23», «13т», набранные русскими буквами, = A52, S23, 13T (только в словах с цифрами)
  query = String(query ?? '').replace(/[а-яё\d]*\d[а-яё\d]*/gi, (w) => w.replace(/[асеокрхмтвн]/gi, (c) => LAT[c.toLowerCase()]));
  const words = low(query).split(' ').filter(Boolean);
  if (!words.length) return items.slice(0, limit);
  const q = low(query);
  const text = (x) => (typeof x === 'string' ? x : `${x.brand} ${deviceName(x)}`);
  const name = (x) => low(typeof x === 'string' ? x : x.model);
  const found = items.filter((x) => { const h = hay(text(x)); return words.every((w) => h.includes(w)); });
  return [...new Set([...found.filter((x) => name(x).startsWith(q)), ...found])].slice(0, limit);
}

// Кнопки неисправностей — только справочник по типу: введённое в заказах руками (в т. ч. мусор) кнопкой не становится.
export function faultChips(deviceType = '') {
  return FAULTS[deviceType] || FAULTS['Телефон'];
}

// Дописать вариант в поле через запятую; если такой уже есть — убрать (повторный клик снимает выбор).
export function toggleItem(text, item) {
  const parts = String(text || '').split(/\s*[,;]\s*|\n+/).map((s) => s.trim()).filter(Boolean);
  const i = parts.findIndex((p) => low(p) === low(item));
  if (i >= 0) parts.splice(i, 1); else parts.push(item);
  return parts.join(', ');
}
export const hasItem = (text, item) =>
  String(text || '').split(/\s*[,;]\s*|\n+/).some((p) => low(p) === low(item));

// Обычная цена такого же ремонта: выданные не гарантийные заказы той же марки и модели с той же неисправностью.
// Старые заказы без марки сравниваются по угаданной марке (normDevice).
export function priceHint(orders, model, fault, brand = '') {
  const key = (b, x) => { const d = normDevice(b, x); return `${low(d.brand)}|${low(d.model)}`; };
  const f = low(fault);
  if (!low(model) || !f) return null;
  const m = key(brand, model);
  const prices = (orders || [])
    .filter((o) => o.status === 'issued' && !o.warrantyOf && Number(o.price) > 0 && key(o.brand, o.model) === m && low(o.fault) === f)
    .map((o) => Number(o.price)).sort((a, b) => a - b);
  if (!prices.length) return null;
  const mid = prices.length >> 1;
  const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
  return { price: median, n: prices.length, min: prices[0], max: prices[prices.length - 1] };
}
