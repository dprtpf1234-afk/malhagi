// 말하기 짝꿍 백업 서버 (Vercel Function, Node.js)
//
// 이 서버가 보관하는 것: 휴대폰에서 미리 암호화한 기록(암호문)과, 열쇠 확인값의 해시뿐입니다.
// 암호를 푸는 열쇠는 사용자의 복구 코드에서만 만들어지므로 서버와 운영자는 내용을 읽을 수 없습니다.
//
// 저장소: Upstash Redis (Vercel → Storage에서 연결하면 KV_REST_API_URL / KV_REST_API_TOKEN이 자동으로 들어옵니다)
// 추가 패키지 없이 Upstash REST API를 fetch로 부릅니다.
//
//   GET    /api/vault?ping=1     서버 상태 (인증 없음): { ok, configured }
//   GET    /api/vault            내 백업 가져오기     → { n, d } (아직 없으면 { n: 0, d: null })
//   PUT    /api/vault            백업 저장 { n, d }    → { n }    | 409 { n } (다른 기기가 먼저 저장함)
//   DELETE /api/vault            백업 지우기           → { ok }
//   헤더: X-Vault-Id (32자리 16진수), Authorization: Bearer <열쇠 확인값 43자>

import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({
  BODY_MAX: 1_000_000,          // 요청 본문 최대 글자 수
  DATA_MAX: 900_000,            // 암호문 최대 글자 수 (Upstash 무료 요청 한도 1MB 안쪽)
  TTL_SECONDS: 400 * 24 * 3600, // 마지막 사용 후 400일이 지나면 자동 삭제
  IP_PER_MIN: 60,               // 한 접속 주소에서 1분에 받을 수 있는 요청 수
  FAIL_PER_HOUR: 10,            // 한 백업에 대해 1시간에 허용하는 인증 실패 수
});

// 스크립트 첫 줄의 이름은 시험용 가짜 Redis가 스크립트를 알아보는 데 씁니다.
export const SCRIPTS = Object.freeze({
  put: `-- malhagi:put
local a = redis.call('HGET', KEYS[1], 'a')
if a and a ~= ARGV[1] then return {-1, 0} end
local n = tonumber(redis.call('HGET', KEYS[1], 'n') or '0')
if n ~= tonumber(ARGV[2]) then return {-2, n} end
n = n + 1
redis.call('HSET', KEYS[1], 'a', ARGV[1], 'd', ARGV[3], 'n', tostring(n), 't', ARGV[4])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
return {0, n}`,
  del: `-- malhagi:del
local a = redis.call('HGET', KEYS[1], 'a')
if not a then return 0 end
if a ~= ARGV[1] then return -1 end
redis.call('DEL', KEYS[1])
return 1`,
});

const ID_RE = /^[0-9a-f]{32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const DATA_RE = /^v3\.[gp]\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/;

function env() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Upstash REST 파이프라인: 명령 여러 개를 한 번에 보내고 결과 배열을 받습니다. */
async function redis(cfg, commands) {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis http ${res.status}`);
  const out = await res.json();
  return out.map((x) => {
    if (x && x.error) throw new Error(`redis: ${x.error}`);
    return x ? x.result : null;
  });
}

function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

/** 너무 잦은 요청 막기. 접속 주소는 해시로만 잠깐(2분) 남깁니다. */
async function rateLimited(cfg, request) {
  const minute = Math.floor(Date.now() / 60000);
  const key = `rl:${sha256(`${clientIp(request)}|${minute}`).slice(0, 24)}`;
  const [count] = await redis(cfg, [['INCR', key], ['EXPIRE', key, 120]]);
  return Number(count) > LIMITS.IP_PER_MIN;
}

function readAuth(request) {
  const id = (request.headers.get('x-vault-id') || '').trim();
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  const token = m ? m[1] : '';
  if (!ID_RE.test(id) || !TOKEN_RE.test(token)) return null;
  return { id, key: `v:${id}`, failKey: `f:${id}`, a: sha256(`malhagi|${token}`) };
}

async function tooManyFailures(cfg, auth) {
  const [fails] = await redis(cfg, [['GET', auth.failKey]]);
  return Number(fails || 0) >= LIMITS.FAIL_PER_HOUR;
}

async function noteFailure(cfg, auth) {
  await redis(cfg, [['INCR', auth.failKey], ['EXPIRE', auth.failKey, 3600]]);
}

/** 공통 앞단: 설정 확인 → 요청 수 제한 → 인증값 형식 확인 → 실패 잠금 확인 */
async function guard(request) {
  const cfg = env();
  if (!cfg) return { res: json(503, { error: 'not_configured' }) };
  try {
    if (await rateLimited(cfg, request)) return { res: json(429, { error: 'busy' }) };
    const auth = readAuth(request);
    if (!auth) return { res: json(400, { error: 'bad_request' }) };
    if (await tooManyFailures(cfg, auth)) return { res: json(429, { error: 'locked' }) };
    return { cfg, auth };
  } catch (e) {
    console.error('guard', e.message);
    return { res: json(502, { error: 'storage' }) };
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.has('ping')) return json(200, { ok: true, configured: !!env() });

  const g = await guard(request);
  if (g.res) return g.res;
  const { cfg, auth } = g;
  try {
    const [row] = await redis(cfg, [['HMGET', auth.key, 'a', 'd', 'n']]);
    const [a, d, n] = row || [];
    if (!a) return json(200, { n: 0, d: null });
    if (a !== auth.a) { await noteFailure(cfg, auth); return json(403, { error: 'auth' }); }
    await redis(cfg, [['EXPIRE', auth.key, LIMITS.TTL_SECONDS]]);
    return json(200, { n: Number(n), d });
  } catch (e) {
    console.error('get', e.message);
    return json(502, { error: 'storage' });
  }
}

export async function PUT(request) {
  const g = await guard(request);
  if (g.res) return g.res;
  const { cfg, auth } = g;

  let body;
  try {
    const text = await request.text();
    if (text.length > LIMITS.BODY_MAX) return json(413, { error: 'too_big' });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const n = Number(body && body.n);
  const d = body && body.d;
  if (!Number.isInteger(n) || n < 0 || typeof d !== 'string' || !DATA_RE.test(d)) return json(400, { error: 'bad_request' });
  if (d.length > LIMITS.DATA_MAX) return json(413, { error: 'too_big' });

  try {
    const [res] = await redis(cfg, [['EVAL', SCRIPTS.put, 1, auth.key, auth.a, n, d, Date.now(), LIMITS.TTL_SECONDS]]);
    const [code, cur] = (res || []).map(Number);
    if (code === -1) { await noteFailure(cfg, auth); return json(403, { error: 'auth' }); }
    if (code === -2) return json(409, { error: 'conflict', n: cur });
    return json(200, { n: cur });
  } catch (e) {
    console.error('put', e.message);
    return json(502, { error: 'storage' });
  }
}

export async function DELETE(request) {
  const g = await guard(request);
  if (g.res) return g.res;
  const { cfg, auth } = g;
  try {
    const [res] = await redis(cfg, [['EVAL', SCRIPTS.del, 1, auth.key, auth.a]]);
    if (Number(res) === -1) { await noteFailure(cfg, auth); return json(403, { error: 'auth' }); }
    return json(200, { ok: true, deleted: Number(res) === 1 });
  } catch (e) {
    console.error('delete', e.message);
    return json(502, { error: 'storage' });
  }
}
