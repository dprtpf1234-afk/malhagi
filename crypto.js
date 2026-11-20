// IndexedDB 저장소. 열쇠(CryptoKey)는 내보낼 수 없는 형태 그대로 저장됩니다.
// 스토어: kv(설정·신원), sessions(복호화된 연습 기록), outbox(전송 대기 암호문)

const DB_NAME = 'malhagi';
const DB_VERSION = 1;
let dbPromise = null;
let memory = null; // IndexedDB를 쓸 수 없는 환경용 (새로고침 시 사라짐)

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in globalThis)) { memory = new Map(); resolve(null); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { memory = new Map(); resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'recordId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { memory = new Map(); resolve(null); };
  });
  return dbPromise;
}

function memStore(name) {
  if (!memory.has(name)) memory.set(name, new Map());
  return memory.get(name);
}

async function tx(storeName, mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function isPersistent() { return memory === null; }

export async function kvGet(key) {
  const db = await open();
  if (!db) return memStore('kv').get(key);
  return tx('kv', 'readonly', (s) => wrap(s.get(key)));
}
export async function kvSet(key, value) {
  const db = await open();
  if (!db) { memStore('kv').set(key, value); return; }
  return tx('kv', 'readwrite', (s) => wrap(s.put(value, key)));
}
export async function kvDel(key) {
  const db = await open();
  if (!db) { memStore('kv').delete(key); return; }
  return tx('kv', 'readwrite', (s) => wrap(s.delete(key)));
}

export async function getAll(storeName) {
  const db = await open();
  if (!db) return [...memStore(storeName).values()];
  return tx(storeName, 'readonly', (s) => wrap(s.getAll()));
}
export async function put(storeName, value) {
  const db = await open();
  const keyField = storeName === 'sessions' ? 'id' : 'recordId';
  if (!db) { memStore(storeName).set(value[keyField], value); return; }
  return tx(storeName, 'readwrite', (s) => wrap(s.put(value)));
}
export async function del(storeName, key) {
  const db = await open();
  if (!db) { memStore(storeName).delete(key); return; }
  return tx(storeName, 'readwrite', (s) => wrap(s.delete(key)));
}
export async function count(storeName) {
  const db = await open();
  if (!db) return memStore(storeName).size;
  return tx(storeName, 'readonly', (s) => wrap(s.count()));
}
export async function clearStore(storeName) {
  const db = await open();
  if (!db) { memStore(storeName).clear(); return; }
  return tx(storeName, 'readwrite', (s) => wrap(s.clear()));
}

/** 기기의 모든 데이터와 열쇠를 지웁니다. */
export async function clearAll() {
  for (const name of ['kv', 'sessions', 'outbox']) await clearStore(name);
}

/** 브라우저에 저장소를 함부로 지우지 말라고 요청 (지원 브라우저만) */
export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* 무시 */ }
  return false;
}
