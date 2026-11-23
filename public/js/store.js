// 기기 저장소 (localStorage)
//
// data (백업 대상: myWords, days)
//   schema: 3
//   consent: { at, version, backup }        안내 확인·백업 동의
//   backup:  { on, code, n, lastAt, dirty, error }
//   myWords: { [id]: { t, k, at, del? } }   나만의 낱말·문장 (k: 'word' | 'sentence', del: 지운 표시)
//   days:    { 'YYYY-MM-DD': { at, plan: { word: Item[], sentence: Item[] }, items: { [itemId]: { t, k, c, p } } } }
//            p = 들은 횟수, c = 분야 이름
// 기기 설정(글씨 크기·목소리·빠르기)은 기기마다 다르게 쓰므로 따로 저장하고 백업하지 않습니다.

const KEY = 'malhagi.v3.data';
const DEVICE_KEY = 'malhagi.v3.device';
export const SCHEMA = 3;
export const LIMITS = Object.freeze({ MY_WORDS: 60, WORD_LEN: 20, SENTENCE_LEN: 40, DAYS: 3660, ITEMS_PER_DAY: 400 });

let memData = null;
let memDevice = null;
let persistent = true;

function readJson(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    persistent = false;
    return null;
  }
}

function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    persistent = false;
    return false;
  }
}

export const canPersist = () => persistent;

export function blank() {
  return {
    schema: SCHEMA,
    createdAt: Date.now(),
    consent: null,
    backup: { on: false, code: '', n: 0, lastAt: 0, dirty: false, error: '' },
    myWords: {},
    days: {},
  };
}

export function load() {
  const d = readJson(KEY);
  memData = d && d.schema === SCHEMA ? d : null;
  if (memData) {
    memData.backup = { ...blank().backup, ...(memData.backup || {}) };
    const s = sanitizeSynced(memData);
    memData.myWords = s.myWords;
    memData.days = s.days;
  }
  return memData;
}

export const data = () => memData;
export function set(d) { memData = d; save(); }
export function save() { if (memData) writeJson(KEY, memData); }
export function wipe() { memData = null; writeJson(KEY, null); }

// ── 기기 설정 ──

const DEVICE_DEFAULTS = { voice: '', rate: 1, autoplay: true };

export function device() {
  if (!memDevice) memDevice = { ...DEVICE_DEFAULTS, ...(readJson(DEVICE_KEY) || {}) };
  return memDevice;
}

export function setDevice(patch) {
  memDevice = { ...device(), ...patch };
  writeJson(DEVICE_KEY, memDevice);
}

export function wipeDevice() {
  memDevice = null;
  writeJson(DEVICE_KEY, null);
}

// ── 날짜 ──

export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// ── 검사: 파일·백업에서 들어온 값은 믿지 않고 형식을 맞춥니다 ──

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 단어장 항목: w:<분야>:<낱말>, s:<분야>:<문장> / 나만의 낱말: m:<임의값>
const ID_RE = /^(?:[ws]:[a-z]{2,12}:[^\u0000-\u001f]{1,60}|m:[a-z0-9]{6,20})$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const kind = (v) => (v === 'sentence' ? 'sentence' : 'word');
const num = (v, max = 1e6) => (Number.isFinite(+v) && +v >= 0 ? Math.min(Math.floor(+v), max) : 0);

function cleanItem(x) {
  if (!x || typeof x !== 'object') return null;
  const id = str(x.id, 90);
  const t = str(x.t, LIMITS.SENTENCE_LEN);
  if (!ID_RE.test(id) || !t) return null;
  return { id, t, k: kind(x.k), c: str(x.c, 30) };
}

export function sanitizeSynced(src) {
  const out = { myWords: {}, days: {} };
  const mw = src && typeof src.myWords === 'object' && src.myWords ? src.myWords : {};
  for (const [id, w] of Object.entries(mw).slice(0, LIMITS.MY_WORDS * 4)) {
    if (!/^m:[a-z0-9]{6,20}$/.test(id) || !w || typeof w !== 'object') continue;
    const k = kind(w.k);
    const t = str(w.t, k === 'word' ? LIMITS.WORD_LEN : LIMITS.SENTENCE_LEN);
    if (!t && !w.del) continue;
    out.myWords[id] = { t, k, at: num(w.at, 1e13), ...(w.del ? { del: true } : {}) };
  }
  const days = src && typeof src.days === 'object' && src.days ? src.days : {};
  for (const [key, day] of Object.entries(days).slice(-LIMITS.DAYS)) {
    if (!DATE_RE.test(key) || !day || typeof day !== 'object') continue;
    const items = {};
    for (const [id, it] of Object.entries(day.items || {}).slice(0, LIMITS.ITEMS_PER_DAY)) {
      const c = cleanItem({ id, ...it });
      if (c) items[id] = { t: c.t, k: c.k, c: c.c, p: num(it.p, 100000) };
    }
    const plan = {};
    for (const type of ['word', 'sentence']) {
      const list = Array.isArray(day.plan && day.plan[type]) ? day.plan[type] : null;
      if (list) plan[type] = list.slice(0, 30).map(cleanItem).filter(Boolean);
    }
    out.days[key] = { at: num(day.at, 1e13), plan, items };
  }
  return out;
}

// ── 합치기: 다른 기기의 기록과 합칠 때 아무것도 잃지 않게 ──
//  나만의 낱말: 같은 항목이면 나중에 바뀐 쪽 (지운 표시 포함)
//  날짜별 기록: 항목을 모두 모으고, 들은 횟수는 큰 쪽
//  오늘의 목록(plan): 이미 있는 쪽을 유지 (같은 날 목록이 바뀌지 않게)

export function merge(a, b) {
  const out = { myWords: { ...a.myWords }, days: {} };
  for (const [id, w] of Object.entries(b.myWords)) {
    const cur = out.myWords[id];
    if (!cur || w.at > cur.at) out.myWords[id] = w;
  }
  const keys = new Set([...Object.keys(a.days), ...Object.keys(b.days)]);
  for (const key of [...keys].sort()) {
    const x = a.days[key];
    const y = b.days[key];
    if (!x || !y) { out.days[key] = structuredClone(x || y); continue; }
    const items = { ...structuredClone(x.items) };
    for (const [id, it] of Object.entries(y.items)) {
      items[id] = items[id] ? { ...items[id], p: Math.max(items[id].p, it.p) } : { ...it };
    }
    const plan = {};
    for (const type of ['word', 'sentence']) {
      const p = (x.plan && x.plan[type]) || (y.plan && y.plan[type]);
      if (p) plan[type] = structuredClone(p);
    }
    out.days[key] = { at: Math.max(x.at, y.at), plan, items };
  }
  return out;
}

/** 두 기록이 같은지 (백업이 필요한지 판단) */
export function sameSynced(a, b) {
  const norm = (s) => JSON.stringify({
    myWords: Object.fromEntries(Object.entries(s.myWords).sort()),
    days: Object.fromEntries(Object.entries(s.days).sort()),
  });
  return norm(a) === norm(b);
}

export function newId() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return `m:${Array.from(r, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12)}`;
}

/** 브라우저가 저장 공간을 함부로 지우지 않게 요청 (지원하는 브라우저만) */
export async function askPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* 무시 */ }
  return false;
}
