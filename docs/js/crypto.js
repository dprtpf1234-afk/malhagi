// 기기 내 암호화 (PRD v1.2 F-01, F-08, 6.5)
// - 데이터 열쇠: AES-256-GCM, 기기에는 '내보낼 수 없는' CryptoKey로만 저장
// - 복구 코드 → PBKDF2-SHA256 → [조회값 32바이트 | 열쇠 해제값(AES-KW) 32바이트]
//   조회값만 서버로 가고, 열쇠 해제값은 기기를 떠나지 않습니다.

import { CONFIG } from './config.js';

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

// ── base64url ──
export function b64u(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
/** 128비트 무작위 ID (user_id, device_id, record_id) */
export function randomId() { return b64u(randomBytes(16)); }
/** 256비트 비밀값 (기기 토큰) */
export function randomSecret() { return b64u(randomBytes(32)); }

// ── 복구 코드 ──
// 헷갈리는 0/O, 1/I/L을 뺀 31자. 16자리 ≈ 79비트.
export const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RECOVERY_LENGTH = 16;

export function generateRecoveryCode() {
  const A = RECOVERY_ALPHABET;
  const limit = 256 - (256 % A.length); // 편향 없는 거부 샘플링
  let out = '';
  while (out.length < RECOVERY_LENGTH) {
    for (const b of randomBytes(32)) {
      if (b < limit && out.length < RECOVERY_LENGTH) out += A[b % A.length];
    }
  }
  return out;
}

/** 사용자가 입력한 코드 정리. 형식이 맞지 않으면 null. */
export function normalizeRecoveryCode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== RECOVERY_LENGTH) return null;
  for (const ch of s) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return s;
}

export function formatRecoveryCode(code) {
  return code.match(/.{1,4}/g).join('-');
}

/** 복구 코드 → { lookup: 서버로 보낼 조회값, kek: 열쇠 해제용 AES-KW 열쇠(내보내기 불가) } */
export async function deriveFromRecoveryCode(code, iterations = CONFIG.PBKDF2_ITERATIONS) {
  const base = await subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(CONFIG.KDF_SALT), iterations },
    base,
    512,
  ));
  const lookup = b64u(bits.slice(0, 32));
  const kek = await subtle.importKey('raw', bits.slice(32), { name: 'AES-KW' }, false, ['wrapKey', 'unwrapKey']);
  bits.fill(0);
  return { lookup, kek };
}

// ── 데이터 열쇠 ──

/** 새 데이터 열쇠를 만들고 kek로 감쌉니다. 기기에는 내보낼 수 없는 열쇠만 남깁니다. */
export async function createDataKey(kek) {
  const tmp = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapped = b64u(await subtle.wrapKey('raw', tmp, kek, 'AES-KW'));
  const key = await unwrapDataKey(wrapped, kek);
  return { key, wrapped };
}

export async function unwrapDataKey(wrapped, kek) {
  return subtle.unwrapKey('raw', fromB64u(wrapped), kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// ── 기록 암호화 ──
// 추가 인증 데이터(AAD)에 user_id·종류·record_id를 묶어, 서버에서 기록을 바꿔치기하면 복호화가 실패하게 합니다.
export function aadFor(userId, kind, recordId) {
  return te.encode(`${userId}|${kind}|${recordId}`);
}

export async function encryptJSON(key, obj, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64u(out);
}

export async function decryptJSON(key, payload, aad) {
  const buf = fromB64u(payload);
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct);
  return JSON.parse(td.decode(pt));
}

/** 공용 기기 잠금 PIN 확인용 해시 (기기 안에서만 사용) */
export async function hashPin(pin, salt) {
  const base = await subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(salt), iterations: 100000 }, base, 256);
  return b64u(bits);
}
