// 백업 서버(api/vault.js) 시험: 가짜 Redis로 실제 함수를 그대로 돌립니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockRedis, installMockFetch, MOCK_URL, MOCK_TOKEN } from './mock-redis.js';

const mock = createMockRedis();
process.env.KV_REST_API_URL = MOCK_URL;
process.env.KV_REST_API_TOKEN = MOCK_TOKEN;
installMockFetch(mock);
const api = await import('../api/vault.js');

const ID = 'a'.repeat(32);
const TOKEN = 'T'.repeat(43);
const DATA = `v3.g.${'A'.repeat(16)}.${'B'.repeat(100)}`;
let ip = 0;
const req = (method, { id = ID, token = TOKEN, body, query = '', fixedIp } = {}) => new Request(`https://x.test/api/vault${query}`, {
  method,
  headers: { 'x-vault-id': id, authorization: `Bearer ${token}`, 'x-forwarded-for': fixedIp || `10.0.0.${++ip % 250}` },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const call = async (method, opts) => { const r = await api[method](req(method, opts)); return { status: r.status, body: await r.json() }; };

test('ping은 설정 여부만 알려 줌', async () => {
  const r = await call('GET', { query: '?ping=1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, configured: true });
});

test('없는 백업은 d: null, 처음 저장은 n=0에서 1이 됨', async () => {
  assert.deepEqual(await call('GET'), { status: 200, body: { n: 0, d: null } });
  const r = await call('PUT', { body: { n: 0, d: DATA } });
  assert.deepEqual(r, { status: 200, body: { n: 1 } });
  const g = await call('GET');
  assert.equal(g.status, 200);
  assert.equal(g.body.n, 1);
  assert.equal(g.body.d, DATA);
});

test('서버에는 열쇠 확인값 원본이 아니라 해시만 남음', () => {
  const h = mock.kv.get(`v:${ID}`);
  assert.ok(h.get('a') && h.get('a') !== TOKEN && !h.get('a').includes(TOKEN));
  assert.equal(h.get('a').length, 64);
});

test('판 번호가 다르면 409와 서버의 현재 번호', async () => {
  const r = await call('PUT', { body: { n: 0, d: DATA } });
  assert.equal(r.status, 409);
  assert.equal(r.body.n, 1);
  assert.equal((await call('PUT', { body: { n: 1, d: DATA } })).body.n, 2);
});

test('다른 열쇠로는 읽기·쓰기·지우기 모두 403', async () => {
  const bad = 'X'.repeat(43);
  assert.equal((await call('GET', { token: bad })).status, 403);
  assert.equal((await call('PUT', { token: bad, body: { n: 2, d: DATA } })).status, 403);
  assert.equal((await call('DELETE', { token: bad })).status, 403);
  assert.equal((await call('GET')).body.n, 2, '원래 백업은 그대로');
});

test('인증 실패가 쌓이면 맞는 열쇠도 잠시 잠김', async () => {
  const id = 'b'.repeat(32);
  await call('PUT', { id, body: { n: 0, d: DATA } });
  for (let i = 0; i < 10; i++) await call('GET', { id, token: 'Y'.repeat(43) });
  const r = await call('GET', { id });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'locked');
});

test('형식이 틀린 요청은 400, 너무 큰 암호문은 413', async () => {
  assert.equal((await call('GET', { id: 'xyz' })).status, 400);
  assert.equal((await call('GET', { token: 'short' })).status, 400);
  assert.equal((await call('PUT', { body: { n: 2, d: 'plain text' } })).status, 400);
  assert.equal((await call('PUT', { body: { n: -1, d: DATA } })).status, 400);
  const big = `v3.g.${'A'.repeat(16)}.${'B'.repeat(950_000)}`;
  assert.equal((await call('PUT', { body: { n: 2, d: big } })).status, 413);
});

test('같은 주소에서 1분에 60번이 넘으면 429', async () => {
  let last;
  for (let i = 0; i < 62; i++) last = await call('GET', { query: '', fixedIp: '192.168.1.1', id: 'c'.repeat(32) });
  assert.equal(last.status, 429);
  assert.equal(last.body.error, 'busy');
  const keys = [...mock.kv.keys()].filter((k) => k.startsWith('rl:'));
  assert.ok(keys.every((k) => !k.includes('192.168')), '접속 주소는 해시로만 남음');
});

test('지우면 사라지고, 저장할 때마다 400일 만료가 걸림', async () => {
  assert.ok(mock.exp.get(`v:${ID}`) > Date.now() + 399 * 86400_000);
  const r = await call('DELETE');
  assert.deepEqual(r.body, { ok: true, deleted: true });
  assert.equal((await call('GET')).body.d, null);
});

test('저장소가 연결되지 않으면 503 not_configured', async () => {
  const saved = process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_URL;
  try {
    assert.deepEqual((await call('GET', { query: '?ping=1' })).body, { ok: true, configured: false });
    const r = await call('GET');
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'not_configured');
  } finally {
    process.env.KV_REST_API_URL = saved;
  }
});
