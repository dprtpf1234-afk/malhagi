// 기기 쪽 코드 시험: 복구 코드·암호화·기록 합치기·오늘의 목록, 그리고 기기 ↔ 서버 왕복
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockRedis, installMockFetch, MOCK_URL, MOCK_TOKEN } from './mock-redis.js';

const mock = createMockRedis();
process.env.KV_REST_API_URL = MOCK_URL;
process.env.KV_REST_API_TOKEN = MOCK_TOKEN;
installMockFetch(mock);
const api = await import('../api/vault.js');

// 앱의 상대 주소 요청(./api/vault)을 서버 함수로 보냄
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('./api/vault')) {
    const request = new Request(`https://app.test${u.slice(1)}`, { ...opts, headers: { ...(opts.headers || {}), 'x-forwarded-for': '1.2.3.4' } });
    return api[opts.method || 'GET'](request);
  }
  return realFetch(url, opts);
};

const backup = await import('../public/js/backup.js');
const store = await import('../public/js/store.js');
const words = await import('../public/js/words.js');

test('복구 코드: 16자리, 헷갈리는 글자 없음, 입력 정리', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = backup.makeCode();
    assert.match(c, /^[2-9A-HJ-NP-Z]{16}$/);
    seen.add(c);
  }
  assert.equal(seen.size, 200);
  const c = backup.makeCode();
  assert.equal(backup.normalizeCode(` ${backup.formatCode(c).toLowerCase()} `), c);
  assert.equal(backup.normalizeCode('ABCD-EFGH-JKLM-NPQ0'), '', '0은 쓰지 않는 글자');
  assert.equal(backup.normalizeCode('ABCD'), '');
  assert.equal(backup.formatCode('ABCDEFGHJKLMNPQR'), 'ABCD-EFGH-JKLM-NPQR');
});

test('열쇠: 같은 코드 → 같은 값, 다른 코드 → 다른 값', async () => {
  const a = await backup.deriveKeys('ABCDEFGHJKLMNPQR');
  const b = await backup.deriveKeys('ABCDEFGHJKLMNPQS');
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.token, b.token);
  assert.equal((await backup.deriveKeys('ABCDEFGHJKLMNPQR')).id, a.id);
});

test('암호화: 왕복, 평문이 남지 않음, 다른 열쇠로는 못 엶', async () => {
  const keys = await backup.deriveKeys('ABCDEFGHJKLMNPQR');
  const other = await backup.deriveKeys('ABCDEFGHJKLMNPQS');
  const obj = { myWords: { 'm:abc123': { t: '영희', k: 'word', at: 1 } }, days: {} };
  const sealed = await backup.seal(obj, keys);
  assert.match(sealed, /^v3\.g\./);
  assert.ok(!sealed.includes('영희') && !Buffer.from(sealed).toString('utf8').includes('영희'));
  assert.deepEqual(await backup.open(sealed, keys), obj);
  await assert.rejects(backup.open(sealed, other));
  const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
  await assert.rejects(backup.open(tampered, keys));
});

test('기기 ↔ 서버: 저장, 불러오기, 충돌, 지우기', async () => {
  const code = backup.makeCode();
  assert.equal(await backup.fetchRemote(code), null);
  const n1 = await backup.storeRemote(code, 0, { app: 'malhagi', myWords: {}, days: { '2026-11-22': { at: 1, plan: {}, items: {} } } });
  assert.equal(n1, 1);
  const r = await backup.fetchRemote(code);
  assert.equal(r.n, 1);
  assert.ok(r.payload.days['2026-11-22']);
  await assert.rejects(backup.storeRemote(code, 0, {}), (e) => e.code === 'conflict' && e.n === 1);
  const stored = [...mock.kv.entries()].filter(([k]) => k.startsWith('v:')).map(([, v]) => v.get('d')).join('');
  assert.ok(!stored.includes('2026-11-22'), '서버에는 날짜도 평문으로 남지 않음');
  await backup.deleteRemote(code);
  assert.equal(await backup.fetchRemote(code), null);
});

test('잘못된 복구 코드로 불러오면 not_found (다른 사람 백업에 닿지 않음)', async () => {
  const code = backup.makeCode();
  await backup.storeRemote(code, 0, { days: {}, myWords: {} });
  assert.equal(await backup.fetchRemote(backup.makeCode()), null);
});

test('합치기: 들은 횟수는 큰 쪽, 항목은 모두, 나만의 낱말은 나중 것', () => {
  const a = {
    myWords: { 'm:aaaaaa': { t: '영희', k: 'word', at: 10 }, 'm:bbbbbb': { t: '철수', k: 'word', at: 10 } },
    days: { '2026-11-22': { at: 5, plan: { word: [{ id: 'w:food:밥', t: '밥', k: 'word', c: '음식·음료' }] }, items: { 'w:food:밥': { t: '밥', k: 'word', c: '음식·음료', p: 3 } } } },
  };
  const b = {
    myWords: { 'm:aaaaaa': { t: '', k: 'word', at: 20, del: true }, 'm:bbbbbb': { t: '철수2', k: 'word', at: 5 } },
    days: {
      '2026-11-22': { at: 9, plan: { word: [{ id: 'w:food:물', t: '물', k: 'word', c: '음식·음료' }] }, items: { 'w:food:밥': { t: '밥', k: 'word', c: '음식·음료', p: 1 }, 'w:food:물': { t: '물', k: 'word', c: '음식·음료', p: 2 } } },
      '2026-11-21': { at: 1, plan: {}, items: { 's:help:도와주세요': { t: '도와주세요', k: 'sentence', c: '도움 요청', p: 1 } } },
    },
  };
  const m = store.merge(a, b);
  assert.equal(m.myWords['m:aaaaaa'].del, true);
  assert.equal(m.myWords['m:bbbbbb'].t, '철수');
  assert.equal(m.days['2026-11-22'].items['w:food:밥'].p, 3);
  assert.equal(m.days['2026-11-22'].items['w:food:물'].p, 2);
  assert.equal(m.days['2026-11-22'].plan.word[0].t, '밥', '오늘의 목록은 원래 것 유지');
  assert.ok(m.days['2026-11-21']);
  assert.ok(store.sameSynced(store.merge(m, b), m), '여러 번 합쳐도 같음');
  assert.ok(store.sameSynced(store.merge(m, a), m));
});

test('검사: 이상한 값은 버리고 형식을 맞춤', () => {
  const s = store.sanitizeSynced({
    myWords: { 'm:good12': { t: '  영희  ', k: 'word', at: 1 }, bad: { t: 'x' }, 'm:long12': { t: '가'.repeat(100), k: 'word', at: 1 } },
    days: {
      '2026-11-22': { at: 1, items: { 'w:food:밥': { t: '밥', k: 'word', p: -5 }, '<script>': { t: 'x', p: 1 }, 's:outing:이거 얼마예요?': { t: '이거 얼마예요?', k: 'sentence', p: 2 } } },
      'not-a-date': { items: {} },
    },
    evil: 1,
  });
  assert.equal(s.myWords['m:good12'].t, '영희');
  assert.equal(s.myWords['m:long12'].t.length, store.LIMITS.WORD_LEN);
  assert.ok(!s.myWords.bad);
  assert.equal(s.days['2026-11-22'].items['w:food:밥'].p, 0);
  assert.ok(!s.days['2026-11-22'].items['<script>']);
  assert.equal(s.days['2026-11-22'].items['s:outing:이거 얼마예요?'].p, 2);
  assert.ok(!s.days['not-a-date']);
  assert.ok(!('evil' in s));
});

test('오늘의 목록: 낱말 10·문장 5, 같은 날은 같고 날마다 다름, 겹치지 않음', () => {
  const w1 = words.pickToday('word', '2026-11-23', {});
  const w2 = words.pickToday('word', '2026-11-23', {});
  const w3 = words.pickToday('word', '2026-11-24', {});
  assert.equal(w1.length, 10);
  assert.deepEqual(w1, w2);
  assert.notDeepEqual(w1.map((x) => x.id), w3.map((x) => x.id));
  assert.equal(new Set(w1.map((x) => x.t)).size, 10, '같은 글자(예: 눈)가 두 번 나오지 않음');
  assert.equal(new Set(w1.map((x) => x.c)).size, 10, '여러 분야에서 고루');
  assert.equal(words.pickToday('sentence', '2026-11-23', {}).length, 5);
});

test('오늘의 목록: 나만의 낱말을 몇 개 넣고, 최근에 나온 것은 피함', () => {
  const mine = {
    'm:aaaaaa': { t: '영희', k: 'word', at: 1 }, 'm:bbbbbb': { t: '복지관', k: 'word', at: 2 },
    'm:cccccc': { t: '보청기', k: 'word', at: 3 }, 'm:dddddd': { t: '철수', k: 'word', at: 4 },
    'm:eeeeee': { t: '', k: 'word', at: 5, del: true }, 'm:ffffff': { t: '영희야 밥 먹었니?', k: 'sentence', at: 6 },
  };
  const w = words.pickToday('word', '2026-11-23', mine);
  assert.equal(w.filter((x) => x.id.startsWith('m:')).length, 3);
  assert.equal(w.length, 10);
  const s = words.pickToday('sentence', '2026-11-23', mine);
  assert.ok(s.some((x) => x.t === '영희야 밥 먹었니?'));
  const recent = new Set(words.pickToday('word', '2026-11-22', {}).map((x) => x.id));
  const today = words.pickToday('word', '2026-11-23', {}, recent);
  assert.ok(today.every((x) => !recent.has(x.id)));
});

test('단어장 항목 번호가 모두 저장 형식 검사를 통과함', () => {
  const all = [...words.categories('word'), ...words.categories('sentence')].flatMap((c) => c.items);
  const days = { '2026-11-23': { at: 1, plan: {}, items: Object.fromEntries(all.map((it) => [it.id, { t: it.t, k: it.k, c: it.c, p: 1 }])) } };
  const s = store.sanitizeSynced({ myWords: {}, days });
  assert.equal(Object.keys(s.days['2026-11-23'].items).length, all.length);
});
