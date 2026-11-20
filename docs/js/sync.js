// 신원(열쇠)·기록 관리와 서버 동기화.
// 기기 저장소가 기준이고, 서버는 암호문 백업·기기 간 이동 통로입니다.

import { CONFIG } from './config.js';
import * as store from './store.js';
import { call, authOf, ApiError } from './api.js';
import {
  randomId, randomSecret, generateRecoveryCode, deriveFromRecoveryCode,
  createDataKey, unwrapDataKey, encryptJSON, decryptJSON, aadFor,
} from './crypto.js';

export const DEFAULT_SETTINGS = Object.freeze({
  voiceName: '',
  rate: 1.0,
  stage: null,
  reaskQueue: [],        // [{id, stage, text, accept}]
  metricsConsent: false,
  consentVersion: '',
  updatedAt: 0,
});

// ── 신원 ──

export async function loadIdentity() {
  return (await store.kvGet('identity')) || null;
}

/**
 * 최초 설정: 열쇠와 복구 코드를 만들고 서버에 등록합니다.
 * @returns {Promise<{identity, recoveryCode}>}
 */
export async function createIdentity({ metricsConsent }) {
  const recoveryCode = generateRecoveryCode();
  const { lookup, kek } = await deriveFromRecoveryCode(recoveryCode);
  const { key, wrapped } = await createDataKey(kek);
  const identity = { userId: randomId(), deviceId: randomId(), deviceToken: randomSecret(), dataKey: key };
  await call('register', {
    userId: identity.userId,
    deviceId: identity.deviceId,
    deviceToken: identity.deviceToken,
    recoveryLookup: lookup,
    wrappedKey: wrapped,
    metricsConsent: !!metricsConsent,
  });
  await store.kvSet('identity', identity);
  return { identity, recoveryCode };
}

/** 복구 코드로 이 기기를 연결하고 서버의 기록을 내려받습니다. */
export async function recoverIdentity(code) {
  const { lookup, kek } = await deriveFromRecoveryCode(code);
  const deviceId = randomId();
  const deviceToken = randomSecret();
  const res = await call('recover', { recoveryLookup: lookup, deviceId, deviceToken });
  const dataKey = await unwrapDataKey(res.wrappedKey, kek);
  const identity = { userId: res.userId, deviceId, deviceToken, dataKey };
  await store.kvSet('identity', identity);
  // 이 기기에 남아 있던 기록(연결이 끊겼던 기기 등)은 새 열쇠로 다시 봉인해 보냄.
  // 서버는 record_id 기준으로 덮어쓰므로 중복되지 않음.
  await store.clearStore('outbox');
  await store.kvDel('lastPullDate');
  for (const s of await loadSessions()) await enqueue(identity, 'session', s.id, s);
  await pullAndMerge(identity);
  await flush(identity).catch(() => {});
  return identity;
}

// ── 기록 ──

async function sealRecord(identity, kind, recordId, data) {
  const ciphertext = await encryptJSON(identity.dataKey, data, aadFor(identity.userId, kind, recordId));
  return { recordId, kind, ciphertext };
}

/** 기록을 암호화해 전송 대기열에 넣습니다. */
export async function enqueue(identity, kind, recordId, data) {
  let sealed = await sealRecord(identity, kind, recordId, data);
  if (sealed.ciphertext.length > 85000 && kind === 'session') {
    // 서버 한도(약 64KB)를 넘으면 시도별 세부 기록을 빼고 다시 봉인 (요약은 유지)
    const slim = { ...data, items: data.items.map((it) => ({ ...it, attempts: [] })) };
    sealed = await sealRecord(identity, kind, recordId, slim);
  }
  // 대기열이 길어져도 지우지 않음(기록 유실 방지). OUTBOX_MAX를 넘으면 화면에서 연결을 안내.
  await store.put('outbox', sealed);
}

export async function saveSession(identity, session) {
  await store.put('sessions', session);
  await enqueue(identity, 'session', session.id, session);
}

export async function saveSettings(identity, settings) {
  settings.updatedAt = Date.now();
  await store.kvSet('settings', settings);
  if (identity) await enqueue(identity, 'settings', 'settings', settings);
}

export async function saveCustomWords(identity, words) {
  const doc = { words, updatedAt: Date.now() };
  await store.kvSet('customWords', doc);
  if (identity) await enqueue(identity, 'custom_words', 'custom_words', doc);
}

export async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...((await store.kvGet('settings')) || {}) };
}
export async function loadCustomWords() {
  return ((await store.kvGet('customWords')) || { words: [] }).words;
}
export async function loadSessions() {
  const list = await store.getAll('sessions');
  return list.sort((a, b) => a.startedAt - b.startedAt);
}

/** 오늘 날짜(기기 시간대) 'YYYY-MM-DD' */
export function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 오늘의 이용 통계 (선택 동의한 경우에만 전송) */
async function todayMetrics() {
  const today = dateKey();
  const sessions = (await loadSessions()).filter((s) => dateKey(s.startedAt) === today);
  let itemsDone = 0;
  let passed = 0;
  sessions.forEach((s) => s.items.forEach((it) => { itemsDone++; if (it.final === 'pass') passed++; }));
  return { date: today, sessions: sessions.length, itemsDone, passed };
}

/** 대기열을 서버로 보냅니다. 실패하면 대기열에 그대로 둡니다. */
export async function flush(identity) {
  if (!identity) return { sent: 0 };
  const settings = await loadSettings();
  let sent = 0;
  for (;;) {
    const batch = (await store.getAll('outbox')).slice(0, CONFIG.PUSH_BATCH);
    if (!batch.length) break;
    const body = { ...authOf(identity), records: batch };
    if (settings.metricsConsent) body.metrics = await todayMetrics();
    await call('push', body);
    for (const r of batch) await store.del('outbox', r.recordId);
    sent += batch.length;
  }
  return { sent };
}

/** 서버의 암호문을 받아 복호화하고 기기 기록과 합칩니다. */
export async function pullAndMerge(identity) {
  // 연습 기록은 바뀌지 않으므로 마지막으로 받은 날 이후 것만 받음 (설정·단어장은 항상)
  const last = await store.kvGet('lastPullDate');
  const sinceDate = last ? dateKey(new Date(`${last}T00:00:00`).getTime() - 2 * 86400000) : '';
  const res = await call('pull', { ...authOf(identity), sinceDate });
  let failed = 0;
  const local = new Set((await store.getAll('sessions')).map((s) => s.id));
  for (const r of res.records) {
    let data;
    try {
      data = await decryptJSON(identity.dataKey, r.ciphertext, aadFor(identity.userId, r.kind, r.recordId));
    } catch {
      failed++;
      continue;
    }
    if (r.kind === 'session') {
      if (!local.has(data.id)) await store.put('sessions', data);
    } else if (r.kind === 'settings') {
      const mine = await store.kvGet('settings');
      if (!mine || (data.updatedAt || 0) > (mine.updatedAt || 0)) await store.kvSet('settings', data);
    } else if (r.kind === 'custom_words') {
      const mine = await store.kvGet('customWords');
      if (!mine || (data.updatedAt || 0) > (mine.updatedAt || 0)) await store.kvSet('customWords', data);
    }
  }
  if (!failed) await store.kvSet('lastPullDate', dateKey());
  const settings = await loadSettings();
  if (settings.metricsConsent !== !!res.metricsConsent) {
    settings.metricsConsent = !!res.metricsConsent;
    await store.kvSet('settings', settings);
  }
  return { failed };
}

/** 앱 시작·연결 복구 때 호출. 오류는 조용히 넘깁니다(다음에 다시 시도). */
export async function backgroundSync(identity) {
  if (!identity || !navigator.onLine) return { ok: false };
  try {
    await flush(identity);
    const r = await pullAndMerge(identity);
    return { ok: true, failed: r.failed };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.code : 'unknown' };
  }
}

// ── 기기·코드 관리 ──

/** 인증만 확인. 'ok' | 'revoked'(토큰 거부) | 'unknown'(네트워크 등) */
export async function checkAuth(identity) {
  try { await call('devices', authOf(identity)); return 'ok'; } catch (e) {
    return e instanceof ApiError && e.code === 'request_failed' ? 'revoked' : 'unknown';
  }
}

export async function listDevices(identity) {
  return (await call('devices', authOf(identity))).devices;
}

export async function revokeOthers(identity) {
  return (await call('revokeOthers', authOf(identity))).revoked;
}

export async function setMetricsConsent(identity, consent) {
  await call('consent', { ...authOf(identity), metricsConsent: !!consent });
  const settings = await loadSettings();
  settings.metricsConsent = !!consent;
  await saveSettings(identity, settings);
}

/**
 * 복구 코드 새로 만들기 (열쇠 교체).
 * 모든 기록을 새 열쇠로 다시 암호화해 보내고, 다른 기기의 연결은 끊깁니다.
 */
export async function rekey(identity) {
  await flush(identity);
  await pullAndMerge(identity);

  const recoveryCode = generateRecoveryCode();
  const { lookup, kek } = await deriveFromRecoveryCode(recoveryCode);
  const { key, wrapped } = await createDataKey(kek);
  const next = { ...identity, dataKey: key };

  const records = [];
  for (const s of await loadSessions()) records.push(await sealRecord(next, 'session', s.id, s));
  const settings = await store.kvGet('settings');
  if (settings) records.push(await sealRecord(next, 'settings', 'settings', settings));
  const words = await store.kvGet('customWords');
  if (words) records.push(await sealRecord(next, 'custom_words', 'custom_words', words));

  await call('rekey', { ...authOf(identity), newRecoveryLookup: lookup, newWrappedKey: wrapped, records });
  await store.kvSet('identity', next);
  await store.clearStore('outbox');
  await store.kvSet('lastPullDate', dateKey());
  return { identity: next, recoveryCode };
}

/** 내 기록 모두 지우기: 서버 행 삭제 + 기기 열쇠 파기 */
export async function deleteEverything(identity) {
  if (identity) await call('deleteAll', authOf(identity));
  await store.clearAll();
}

/** 서버 단어장 (실패하면 null) */
export async function fetchCurriculum() {
  try {
    const res = await call('curriculum');
    if (Array.isArray(res.items) && res.items.length) {
      await store.kvSet('curriculum', res.items);
      return res.items;
    }
  } catch { /* 오프라인 등 */ }
  return (await store.kvGet('curriculum')) || null;
}
