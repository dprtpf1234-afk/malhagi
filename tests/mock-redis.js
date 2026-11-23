// 시험용 가짜 Upstash Redis (REST /pipeline). api/vault.js가 쓰는 명령만 흉내 냅니다.
// EVAL은 스크립트 첫 줄의 이름(-- malhagi:put / del)으로 알아보고 같은 동작을 JS로 합니다.

export function createMockRedis() {
  const kv = new Map();     // key -> string | Map(hash)
  const exp = new Map();    // key -> 만료 시각(ms)
  const log = [];

  const alive = (k) => {
    if (exp.has(k) && exp.get(k) <= Date.now()) { kv.delete(k); exp.delete(k); }
    return kv.has(k);
  };
  const hash = (k) => {
    if (!alive(k)) kv.set(k, new Map());
    return kv.get(k);
  };

  function run(cmd) {
    const [name, ...a] = cmd.map(String);
    log.push(name);
    switch (name.toUpperCase()) {
      case 'INCR': {
        const v = alive(a[0]) ? Number(kv.get(a[0])) + 1 : 1;
        kv.set(a[0], String(v));
        return v;
      }
      case 'GET': return alive(a[0]) ? kv.get(a[0]) : null;
      case 'EXPIRE': if (!alive(a[0])) return 0; exp.set(a[0], Date.now() + Number(a[1]) * 1000); return 1;
      case 'HMGET': { if (!alive(a[0])) return a.slice(1).map(() => null); const m = kv.get(a[0]); return a.slice(1).map((f) => (m.has(f) ? m.get(f) : null)); }
      case 'EVAL': {
        const [script, , key, ...argv] = a;
        const first = script.split('\n')[0];
        const m = alive(key) ? kv.get(key) : null;
        if (first.includes('malhagi:put')) {
          const [auth, expectN, data, now, ttl] = argv;
          if (m && m.get('a') !== auth) return [-1, 0];
          const n = m ? Number(m.get('n') || 0) : 0;
          if (n !== Number(expectN)) return [-2, n];
          const h = hash(key);
          h.set('a', auth); h.set('d', data); h.set('n', String(n + 1)); h.set('t', now);
          exp.set(key, Date.now() + Number(ttl) * 1000);
          return [0, n + 1];
        }
        if (first.includes('malhagi:del')) {
          if (!m) return 0;
          if (m.get('a') !== argv[0]) return -1;
          kv.delete(key); exp.delete(key);
          return 1;
        }
        throw new Error(`unknown script ${first}`);
      }
      default: throw new Error(`unsupported ${name}`);
    }
  }

  /** fetch 대신 쓸 함수: URL이 base로 시작하면 가짜 Redis가 답함 */
  function handle(body) {
    const cmds = JSON.parse(body);
    return cmds.map((c) => {
      try { return { result: run(c) }; } catch (e) { return { error: e.message }; }
    });
  }

  return { kv, exp, log, handle };
}

export const MOCK_URL = 'https://mock-redis.test';
export const MOCK_TOKEN = 'mock-token';

/** 전역 fetch를 감싸 가짜 Redis로 보냄 */
export function installMockFetch(mock) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith(MOCK_URL)) {
      if (opts.headers?.Authorization !== `Bearer ${MOCK_TOKEN}`) return new Response('unauthorized', { status: 401 });
      return new Response(JSON.stringify(mock.handle(opts.body)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(url, opts);
  };
  return () => { globalThis.fetch = real; };
}
