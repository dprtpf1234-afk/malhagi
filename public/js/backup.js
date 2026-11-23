// 백업: 기기에서 암호화한 뒤 서버(/api/vault)에 보관합니다.
//
// 복구 코드(16자리) 하나에서 두 가지를 만듭니다.
//   1) 암호화 열쇠: 기록을 잠그고 푸는 데 씀. 기기 밖으로 나가지 않음.
//   2) 열쇠 확인값: 서버가 '이 백업의 주인'인지 확인하는 데 씀. 서버는 이 값의 해시만 보관.
// 그래서 서버나 운영자는 기록을 읽을 수 없고, 복구 코드를 잃으면 백업도 되살릴 수 없습니다.

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 헷갈리는 0·1·O·I 제외, 32자 → 글자당 5비트(16자 = 80비트)
const CODE_LEN = 16;
const KDF_SALT = 'malhagi-jjakkung/backup/v3';
const KDF_ITERATIONS = 210000;
const API = './api/vault';
const TIMEOUT_MS = 15000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── 복구 코드 ──

export function makeCode() {
  const r = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return Array.from(r, (x) => ALPHABET[x & 31]).join(''); // 256은 32의 배수라 치우침 없음
}

/** 입력값 정리: 공백·하이픈 제거, 대문자로. 형식이 틀리면 '' */
export function normalizeCode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== CODE_LEN) return '';
  for (const ch of s) if (!ALPHABET.includes(ch)) return '';
  return s;
}

export function formatCode(code) {
  return (code.match(/.{1,4}/g) || []).join('-');
}

// ── 열쇠 만들기 ──

const keyCache = new Map();

export async function deriveKeys(code) {
  if (keyCache.has(code)) return keyCache.get(code);
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(KDF_SALT), iterations: KDF_ITERATIONS }, base, 512));
  const aes = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const token = b64url(bits.slice(32, 64));
  const idHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`vault-id|${token}`)));
  const id = Array.from(idHash.slice(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
  const keys = { aes, token, id };
  keyCache.set(code, keys);
  return keys;
}

// ── 암호화 ──

async function gzip(bytes) {
  const cs = new CompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer());
}

async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}

const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** 기록 → 암호문 문자열 "v3.<g|p>.<iv>.<암호문>" (g: 압축함, p: 압축 안 함) */
export async function seal(obj, keys) {
  let bytes = enc.encode(JSON.stringify(obj));
  let mode = 'p';
  if (canZip()) { bytes = await gzip(bytes); mode = 'g'; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(keys.id) }, keys.aes, bytes);
  return `v3.${mode}.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function open(sealed, keys) {
  const [v, mode, ivs, cts] = String(sealed).split('.');
  if (v !== 'v3' || !ivs || !cts) throw new Error('format');
  let bytes = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64url(ivs), additionalData: enc.encode(keys.id) }, keys.aes, unb64url(cts)));
  if (mode === 'g') bytes = await gunzip(bytes);
  return JSON.parse(dec.decode(bytes));
}

// ── 서버 통신 ──

export class BackupError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

async function call(method, keys, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    const headers = keys ? { 'X-Vault-Id': keys.id, Authorization: `Bearer ${keys.token}` } : {};
    if (body) headers['Content-Type'] = 'application/json';
    res = await fetch(keys ? API : `${API}?ping=1`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctrl.signal,
    });
  } catch {
    throw new BackupError('offline');
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (res.ok) return data;
  const map = { 400: 'bad_request', 403: 'auth', 404: 'not_found', 409: 'conflict', 413: 'too_big', 429: 'busy', 503: 'not_configured' };
  const code = data.error === 'locked' ? 'locked' : (map[res.status] || 'server');
  throw new BackupError(code, { n: data.n });
}

/** 서버에 백업 기능이 켜져 있는지 (Vercel에 저장소를 연결했는지) */
export async function ping() {
  try {
    const r = await call('GET', null);
    return { reachable: true, configured: !!r.configured };
  } catch {
    return { reachable: false, configured: false };
  }
}

/** 서버의 백업 가져오기. 없으면 null */
export async function fetchRemote(code) {
  const keys = await deriveKeys(code);
  try {
    const r = await call('GET', keys);
    if (r.d == null) return null;
    return { n: r.n, payload: await open(r.d, keys) };
  } catch (e) {
    if (e.code === 'not_found') return null;
    if (e instanceof BackupError) throw e;
    throw new BackupError('decrypt');
  }
}

/** 저장. 서버 판(n)이 expectN과 다르면 BackupError('conflict', {n}) */
export async function storeRemote(code, expectN, payload) {
  const keys = await deriveKeys(code);
  const d = await seal(payload, keys);
  const r = await call('PUT', keys, { n: expectN, d });
  return r.n;
}

export async function deleteRemote(code) {
  const keys = await deriveKeys(code);
  await call('DELETE', keys);
}

/** 사용자에게 보여 줄 오류 문구 */
export function errorText(code) {
  return ({
    offline: '인터넷에 연결되어 있지 않아요. 연결되면 다시 시도할게요.',
    not_configured: '아직 백업 서버가 준비되지 않았어요. 기록은 이 기기에 잘 저장되고 있어요.',
    auth: '복구 코드가 맞지 않아요.',
    not_found: '이 복구 코드로 저장된 기록이 없어요. 코드를 다시 확인해 주세요.',
    busy: '요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.',
    locked: '여러 번 틀려서 잠시 잠겼어요. 1시간 뒤에 다시 해 주세요.',
    too_big: '기록이 너무 많아 백업하지 못했어요. 파일로 저장해 주세요.',
    decrypt: '기록을 열지 못했어요. 복구 코드를 다시 확인해 주세요.',
  })[code] || '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
}
