// 말하기 짝꿍 v3 – 듣고 따라 말하는 한글 연습
// 화면: 시작 → 첫 설정(글씨 크기 → 안내·백업 선택 → 목소리 → 복구 코드) → 홈 → 연습 / 기록 / 설정

import { h, btn, modal, toast, applyFontScale, getFontScale, FONT_SIZES, fitText, dateLabel, WEEKDAYS, closeModal } from './ui.js';
import * as store from './store.js';
import * as speech from './speech.js';
import * as words from './words.js';
import * as backup from './backup.js';

const VERSION = '3.4.1';
const CONSENT_VERSION = '2026-11-v3';
const SAMPLE = '사과, 할머니, 물 좀 주세요';
const RATE_SAMPLE = '물 좀 주세요';

const app = document.getElementById('app');
const env = speech.detectEnv();
const S = {
  server: null,        // { reachable, configured }
  practice: null,      // { items, i, title, from, kind }
  lastDone: null,
  setup: { restoring: false, afterCode: 'home' },
  calMonth: null,
  syncing: null,
  rev: 0,
};

// ── 시작 화면 (index.html의 #splash) ──
// 로고가 입체적으로 떠오르는 동안 앱을 준비하고, 약 2초 뒤 본 화면으로 넘어갑니다. 화면을 누르면 바로 넘어갑니다.
function finishSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  if (globalThis.__MALHAGI_NO_SPLASH) { el.remove(); return; }
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const MIN_MS = reduce ? 700 : 2300;
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 600);
  };
  el.addEventListener('click', close);
  setTimeout(close, Math.max(0, MIN_MS - performance.now()));
}

// ── 이동 ──

function route() {
  const [name = '', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name, arg: decodeURIComponent(rest.join('/')) };
}

function go(path) {
  const target = `#/${path}`;
  if (location.hash === target) render();
  else location.hash = target;
}

const PRE_SETUP = ['start', 'setup-font', 'setup-intro', 'restore'];

function render() {
  speech.stop();
  closeModal();
  const { name, arg } = route();
  const d = store.data();
  let screen = name;
  if (!d || !d.consent) {
    // 첫 설정 전: 시작·글씨 크기·안내·불러오기 화면만
    if (!PRE_SETUP.includes(name)) screen = 'start';
  } else if (['', 'start', 'setup-font', 'setup-intro'].includes(name)) {
    screen = 'home';
  }
  if (screen === 'practice' && !S.practice) screen = 'home';
  if (screen === 'done' && !S.lastDone) screen = 'home';
  const fn = SCREENS[screen] || SCREENS.home;
  window.scrollTo(0, 0);
  fn(arg);
}

/** 화면 틀: 위쪽 막대(뒤로·글씨 크기·전체화면) + 본문 + 아래쪽 메뉴 */
function frame({ title, sub, back, nav, body, cls = '' }) {
  const top = h('header', { class: 'topbar' },
    back
      ? btn(`‹ ${back.label || '뒤로'}`, back.onClick || (() => history.back()), { kind: 'ghost', cls: 'back' })
      : h('span', { class: 'brand' }, '말하기 짝꿍'),
    h('div', { class: 'top-actions' },
      btn('글씨 크기', openFontModal, { kind: 'ghost', cls: 'small' }),
      fullscreenButton()));
  const heading = title ? h('h1', { tabindex: '-1' }, title) : null;
  const main = h('main', { class: `screen ${cls}`, id: 'main' },
    heading, sub ? h('p', { class: 'sub' }, sub) : null, body);
  app.replaceChildren(top, main, nav ? bottomNav(nav) : '');
  document.title = title && title !== '말하기 짝꿍' ? `${title} · 말하기 짝꿍` : '말하기 짝꿍';
  if (heading) heading.focus({ preventScroll: true });
  return main;
}

function bottomNav(active) {
  const item = (id, label, path) => h('button', {
    type: 'button', class: `nav-item${active === id ? ' on' : ''}`, 'aria-current': active === id ? 'page' : null,
    onclick: () => go(path),
  }, label);
  return h('nav', { class: 'bottom-nav', 'aria-label': '주 메뉴' }, item('home', '홈', 'home'), item('records', '나의 기록', 'records'), item('settings', '설정', 'settings'));
}

const note = (text, kind = '') => h('p', { class: `note ${kind}`.trim() }, text);
const card = (...kids) => h('section', { class: 'card' }, ...kids);
// 고르기 버튼: 고른 것은 ✓ 표시 (✓는 화면에만, 화면 읽기 프로그램에는 '눌림'으로 전달)
const choice = (label, pressed, onClick, extra = {}) =>
  h('button', { type: 'button', class: `choice${pressed ? ' on' : ''}`, 'aria-pressed': pressed ? 'true' : 'false', onclick: () => onClick(), ...extra },
    pressed ? h('span', { class: 'tick', 'aria-hidden': 'true' }, '✓ ') : null, label);

// ── 글씨 크기 ──

function openFontModal() {
  modal({
    title: '글씨 크기',
    body: [h('p', { class: 'preview' }, '사과 · 물 좀 주세요'), fontPicker()],
    actions: [{ label: '닫기', value: true, kind: 'primary' }],
  });
}

function fontPicker() {
  const wrap = h('div', { class: 'choices' });
  const draw = () => {
    const v = getFontScale();
    wrap.replaceChildren(...FONT_SIZES.map((s) => choice(s.label, s.value === v, () => {
      applyFontScale(s.value);
      draw();
      wrap.querySelector('.on')?.focus();
      refit();
    })));
  };
  draw();
  return wrap;
}

function refit() {
  document.querySelectorAll('.target').forEach((el) => fitText(el));
}

// ── 전체화면 ──

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const fsSupported = () => {
  const el = document.documentElement;
  return !!((el.requestFullscreen || el.webkitRequestFullscreen) && (document.fullscreenEnabled || document.webkitFullscreenEnabled));
};

const appBridge = globalThis.MalhagiAndroid;
const appFullscreen = () => { try { return !!(appBridge && appBridge.isFullscreen()); } catch { return false; } };

function fullscreenButton() {
  if (env.isIOS && env.standalone) return ''; // 홈 화면 앱은 이미 화면 전체를 씀
  if (appBridge && appBridge.setFullscreen) {
    return btn(appFullscreen() ? '전체화면 끄기' : '전체화면', () => {
      appBridge.setFullscreen(!appFullscreen());
      document.querySelectorAll('.fs-btn').forEach((b) => { b.textContent = appFullscreen() ? '전체화면 끄기' : '전체화면'; });
      setTimeout(refit, 150);
    }, { kind: 'ghost', cls: 'small fs-btn' });
  }
  return btn(fsElement() ? '전체화면 끄기' : '전체화면', toggleFullscreen, { kind: 'ghost', cls: 'small fs-btn' });
}

// 전체화면이 켜지거나 꺼지면(뒤로 가기·Esc 포함) 버튼 글자만 바꿈. 화면을 다시 그리면 연습 중 소리가 다시 나므로 그리지 않음
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
  document.querySelectorAll('.fs-btn').forEach((b) => { b.textContent = fsElement() ? '전체화면 끄기' : '전체화면'; });
  setTimeout(refit, 100);
}));

async function toggleFullscreen() {
  try {
    if (fsElement()) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (fsSupported()) {
      const el = document.documentElement;
      await (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    } else {
      homeScreenGuide(true);
      return;
    }
  } catch {
    homeScreenGuide(true);
  }
}

function homeScreenGuide(fromFullscreen = false) {
  const steps = env.isIOS
    ? ['Safari 아래쪽 가운데의 공유 버튼(네모에서 화살표가 나오는 모양)을 누르세요.', "'홈 화면에 추가'를 누르세요. 안 보이면 목록을 아래로 내려 보세요.", "오른쪽 위 '추가'를 누르세요."]
    : env.isSamsung
      ? ['아래쪽 오른쪽의 ≡ 버튼을 누르세요.', "'현재 페이지 추가'를 누르세요.", "'홈 화면'을 고르세요."]
      : ['오른쪽 위의 ⋮ 버튼을 누르세요.', "'홈 화면에 추가' 또는 '앱 설치'를 누르세요.", "'추가' 또는 '설치'를 누르세요."];
  modal({
    title: '홈 화면에 추가하기',
    body: [
      fromFullscreen ? h('p', {}, '이 기기의 브라우저는 전체화면 버튼을 지원하지 않아요. 대신 홈 화면에 추가해서 열면 주소창 없이 화면 전체로 볼 수 있어요.') : h('p', {}, '홈 화면에 추가하면 앱처럼 바로 열 수 있고, 주소창 없이 화면 전체로 보여요.'),
      h('ol', { class: 'steps' }, steps.map((s) => h('li', {}, s))),
      env.isIOS ? note('아이폰 Safari는 7일 동안 열지 않은 사이트의 저장 기록을 지울 수 있어요. 홈 화면에 추가해 쓰거나 기록 백업을 켜 두세요.') : null,
    ],
    actions: [{ label: '알겠어요', value: true, kind: 'primary' }],
  });
}

function androidAppGuide() {
  modal({
    title: '안드로이드 앱 설치하기',
    body: [
      h('p', {}, '말하기 짝꿍을 휴대폰 앱으로 설치할 수 있어요. 앱은 이 웹앱을 주소창 없이 열어 주고, 웹앱이 바뀌면 앱도 저절로 새 버전이 돼요.'),
      h('ol', { class: 'steps' },
        h('li', {}, "아래 '설치 파일 내려받기'를 누르세요."),
        h('li', {}, '내려받은 malhagi-jjakkung.apk 파일을 여세요. (알림창이나 \u2018내 파일 → 다운로드\u2019에 있어요)'),
        h('li', {}, "'출처를 알 수 없는 앱' 허용을 물으면 이 브라우저를 허용하고, '설치'를 누르세요.")),
      note('브라우저에서 쓰던 기록은 앱으로 저절로 옮겨지지 않아요. 옮기려면 먼저 여기서 설정 → 기록 저장·불러오기 → \u2018기록 파일 내려받기\u2019를 한 뒤, 앱에서 \u2018불러오기\u2019로 그 파일을 고르세요.'),
      h('a', { class: 'btn btn-primary big', href: './download/malhagi-jjakkung.apk', download: 'malhagi-jjakkung.apk' }, '설치 파일 내려받기'),
    ],
    actions: [{ label: '닫기', value: true }],
  });
}

// ── 기록 ──

const dev = () => store.device();

function markDirty() {
  const d = store.data();
  if (!d) return;
  S.rev++;
  d.backup.dirty = true;
  store.save();
  if (d.backup.on) {
    clearTimeout(markDirty.timer);
    markDirty.timer = setTimeout(() => sync(), 4000);
  }
}

function today() {
  const d = store.data();
  const key = store.dateKey();
  if (!d.days[key]) d.days[key] = { at: Date.now(), plan: {}, items: {} };
  const day = d.days[key];
  let changed = false;
  for (const type of ['word', 'sentence']) {
    if (!day.plan[type] || !day.plan[type].length) {
      const recent = new Set();
      for (let i = 1; i <= 3; i++) {
        const p = d.days[store.addDays(key, -i)]?.plan?.[type] || [];
        p.forEach((it) => recent.add(it.id));
      }
      day.plan[type] = words.pickToday(type, key, d.myWords, recent);
      changed = true;
    }
  }
  if (changed) { day.at = Date.now(); markDirty(); }
  return day;
}

function itemRecord(it) {
  const day = today();
  if (!day.items[it.id]) {
    day.items[it.id] = { t: it.t, k: it.k, c: it.c || '', p: 0 };
    day.at = Date.now();
    markDirty();
  }
  return day.items[it.id];
}

function addPlay(it) {
  const rec = itemRecord(it);
  rec.p += 1;
  today().at = Date.now();
  markDirty();
  return rec.p;
}

const heardCount = (day, list) => list.filter((it) => (day.items[it.id]?.p || 0) > 0).length;
const practiced = (day) => day && Object.values(day.items).some(() => true);

function dayItems(day, type) {
  const out = [];
  const seen = new Set();
  for (const it of day.plan?.[type] || []) {
    if (day.items[it.id] && !seen.has(it.id)) { seen.add(it.id); out.push({ ...it, p: day.items[it.id].p }); }
  }
  for (const [id, it] of Object.entries(day.items)) {
    if (it.k === type && !seen.has(id)) { seen.add(id); out.push({ id, t: it.t, k: it.k, c: it.c, p: it.p }); }
  }
  return out;
}

// ── 백업 ──

const payload = (d) => ({ app: 'malhagi', schema: store.SCHEMA, myWords: d.myWords, days: d.days });

async function sync() {
  const d = store.data();
  if (!d || !d.backup.on || !d.backup.code) return { ok: false, skipped: true };
  if (S.syncing) return S.syncing;
  S.syncing = (async () => {
    let changed = false;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await backup.fetchRemote(d.backup.code);
        if (store.data() !== d || !d.backup.on) return { ok: false };
        let n = 0;
        let needPush = true;
        if (remote) {
          const r = store.sanitizeSynced(remote.payload);
          const before = { myWords: d.myWords, days: d.days };
          const merged = store.merge(before, r);
          if (!store.sameSynced(merged, before)) changed = true;
          d.myWords = merged.myWords;
          d.days = merged.days;
          store.save();
          n = remote.n;
          needPush = !store.sameSynced(merged, r);
        }
        const rev = S.rev;
        if (needPush) {
          try {
            n = await backup.storeRemote(d.backup.code, n, payload(d));
          } catch (e) {
            if (e.code === 'conflict') continue;
            throw e;
          }
        }
        if (store.data() !== d) return { ok: false };
        d.backup.n = n;
        d.backup.lastAt = Date.now();
        d.backup.error = '';
        d.backup.dirty = S.rev !== rev;
        store.save();
        if (d.backup.dirty) { clearTimeout(markDirty.timer); markDirty.timer = setTimeout(() => sync(), 4000); }
        return { ok: true, changed };
      }
      throw new backup.BackupError('conflict');
    } catch (e) {
      if (store.data() === d) { d.backup.error = e.code || 'server'; store.save(); }
      return { ok: false, error: e.code || 'server', changed };
    } finally {
      S.syncing = null;
    }
  })();
  return S.syncing;
}

function lastBackupText(d) {
  if (!d.backup.lastAt) return '아직 백업하지 않았어요.';
  const t = new Date(d.backup.lastAt);
  const hh = t.getHours();
  return `마지막 백업: ${dateLabel(t, { weekday: false })} ${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}:${String(t.getMinutes()).padStart(2, '0')}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요.');
  } catch {
    toast('복사하지 못했어요. 코드를 직접 적어 주세요.');
  }
}

function codeBox(code) {
  return h('div', { class: 'code-box', 'aria-label': `복구 코드 ${code.split('').join(' ')}` },
    backup.formatCode(code).split('-').map((g) => h('span', { class: 'code-group' }, g)));
}

function showCodeModal(code) {
  modal({
    title: '복구 코드',
    body: [codeBox(code), h('p', {}, '이 코드가 있으면 다른 기기에서 기록을 불러올 수 있어요. 다른 사람에게 보여 주지 마세요.')],
    actions: [{ label: '복사하기', value: 'copy' }, { label: '닫기', value: true, kind: 'primary' }],
  }).then((v) => { if (v === 'copy') copyText(backup.formatCode(code)); });
}

// 백업 서버(저장소)가 연결되어 있을 때만 백업 기능을 보여 줌. 연결하지 않으면 기기 저장 + 파일 저장으로만 동작
const backupAvailable = () => !!(S.server && S.server.configured);

// ── 화면들 ──

const SCREENS = {};

SCREENS.start = () => {
  frame({
    title: '말하기 짝꿍',
    sub: '낱말과 문장을 듣고 따라 말하며, 매일 조금씩 연습해요.',
    cls: 'start',
    body: [
      !env.tts ? note('이 브라우저에서는 소리를 낼 수 없어요. 안드로이드는 Chrome, 아이폰은 Safari로 열어 주세요.', 'warn') : null,
      env.inApp ? note("카카오톡 같은 앱 안에서 열었어요. 오른쪽 위(또는 아래) 메뉴에서 '다른 브라우저로 열기'를 눌러 주세요.", 'warn') : null,
      !store.canPersist() ? note('이 브라우저에서는 기록을 저장할 수 없어요. 사생활 보호(시크릿) 모드라면 일반 창으로 열어 주세요.', 'warn') : null,
      h('div', { class: 'stack' },
        btn('처음이에요', () => { S.setup = { restoring: false, afterCode: 'home' }; go('setup-font'); }, { kind: 'primary', cls: 'big' }),
        btn('다른 기기에서 쓰던 기록 불러오기', () => { S.setup = { restoring: true, afterCode: 'home' }; go('restore'); })),
    ],
  });
};

SCREENS['setup-font'] = () => {
  frame({
    title: '글씨 크기를 골라 주세요',
    sub: '읽기 편한 크기를 고르세요. 나중에 위쪽 ‘글씨 크기’ 버튼으로 언제든 바꿀 수 있어요.',
    back: { label: '처음으로', onClick: () => go('start') },
    body: [
      card(h('p', { class: 'preview' }, '사과'), h('p', { class: 'preview-s' }, '물 좀 주세요')),
      fontPicker(),
      h('div', { class: 'actions' }, btn('다음', () => go('setup-intro'), { kind: 'primary', cls: 'big' })),
    ],
  });
};

SCREENS['setup-intro'] = () => {
  const configured = S.server && S.server.configured;
  let agree = false;
  const startBtn = btn('', () => finish(), { kind: 'primary', cls: 'big' });
  const label = () => { startBtn.textContent = !configured ? '시작하기' : agree ? '백업 켜고 시작하기' : '이 기기에만 저장하고 시작하기'; };
  label();
  const check = h('input', { type: 'checkbox', id: 'agree-backup', onchange: (e) => { agree = e.target.checked; label(); } });

  function finish() {
    const d = store.data() || store.blank();
    d.consent = { at: Date.now(), version: CONSENT_VERSION, backup: !!(agree && configured) };
    if (agree && configured) d.backup = { ...d.backup, on: true, code: backup.makeCode(), n: 0, dirty: true, error: '' };
    store.set(d);
    store.askPersist();
    S.setup.afterCode = 'home';
    go('setup-voice');
  }

  frame({
    title: '시작하기 전에',
    back: { onClick: () => go('setup-font') },
    body: [
      card(h('h2', {}, '연습을 돕는 도구예요'),
        h('p', {}, '말하기 짝꿍은 소리를 듣고 따라 말하는 연습을 돕는 도구예요. 치료나 진단을 대신하지 않아요. 연습 방법은 담당 의사나 언어재활사와 상의해 주세요.')),
      card(h('h2', {}, '기록은 이 기기에 저장돼요'),
        h('p', {}, '어떤 낱말을 몇 번 들었는지가 이 휴대폰에 저장돼요. 이름이나 연락처는 묻지 않아요.'),
        env.isIOS ? note(configured ? '아이폰 Safari는 7일 동안 열지 않으면 저장 기록을 지울 수 있어요. 홈 화면에 추가해 쓰거나 아래 백업을 켜 두세요.' : '아이폰 Safari는 7일 동안 열지 않으면 저장 기록을 지울 수 있어요. 홈 화면에 추가해서 쓰세요.') : null,
        configured ? null : h('p', { class: 'small-text' }, '휴대폰을 바꿀 때는 설정 → 기록 저장·불러오기에서 기록을 파일로 옮길 수 있어요.')),
      configured
        ? card(h('h2', {}, '기록 백업 (선택)'),
          h('p', {}, '휴대폰을 바꾸거나 잃어버려도 기록을 되살릴 수 있게, 기록을 이 휴대폰에서 암호화한 뒤 백업 서버에 보관해요. 암호를 푸는 열쇠는 곧 받으실 복구 코드뿐이라, 운영자도 내용을 볼 수 없어요.'),
          h('label', { class: 'check', for: 'agree-backup' }, check,
            h('span', {}, '연습 기록(건강과 관련된 정보일 수 있어요)을 암호화해 백업 서버에 보관하는 데 동의해요.')),
          h('p', { class: 'small-text' }, '동의하지 않아도 앱을 모두 쓸 수 있어요. 백업은 나중에 설정에서 켜거나 끌 수 있어요.'))
        : null,
      h('p', {}, h('a', { href: './privacy.html', target: '_blank', rel: 'noopener' }, '개인정보 처리방침 보기')),
      h('div', { class: 'actions' }, startBtn),
    ],
  });
};

function voicePanel({ onDone, doneLabel }) {
  const list = h('div', { class: 'choices col', role: 'group', 'aria-label': '목소리' }, note('목소리를 찾고 있어요…'));
  const rates = h('div', { class: 'choices' });
  // 빠르기를 고르면 짧은 문장을 그 빠르기로 바로 들려줌
  const drawRates = () => rates.replaceChildren(...speech.RATES.map((r) =>
    choice(r.label, dev().rate === r.value, () => {
      store.setDevice({ rate: r.value });
      drawRates();
      speech.speak(RATE_SAMPLE, { voice: dev().voice, rate: r.value });
    })));
  drawRates();

  async function drawVoices(refresh = false) {
    list.replaceChildren(note('목소리를 찾고 있어요…'));
    const voices = await speech.getVoices({ refresh });
    if (!voices.length) {
      list.replaceChildren(note(env.tts ? '한국어 목소리를 찾지 못했어요. 기기의 기본 목소리로 들려줄게요. 아래 안내대로 한국어 목소리를 설치하면 더 또렷해져요.' : '이 브라우저에서는 소리를 낼 수 없어요.', 'warn'));
      return;
    }
    const cur = voices.find((v) => v.voiceURI === dev().voice || v.name === dev().voice) || voices[0];
    list.replaceChildren(...voices.map((v, i) => choice(`목소리 ${i + 1} · ${speech.voiceLabel(v)}`, v === cur, () => {
      store.setDevice({ voice: v.voiceURI || v.name });
      drawVoices();
      speech.speak(SAMPLE, { voice: v.voiceURI || v.name, rate: dev().rate });
    })));
  }

  const autoplay = h('input', { type: 'checkbox', id: 'autoplay', checked: dev().autoplay ? true : null, onchange: (e) => store.setDevice({ autoplay: e.target.checked }) });

  const sampleBtn = btn('들어 보기', () => speech.speak(SAMPLE, { voice: dev().voice, rate: dev().rate }), { kind: 'primary' });
  const common = [
    h('h2', {}, '빠르기'),
    rates,
    h('label', { class: 'check', for: 'autoplay' }, autoplay, h('span', {}, '낱말이 나오면 자동으로 한 번 들려주기')),
  ];

  // 안드로이드 앱: 휴대폰 기본 목소리(Chrome에서 듣던 소리) 하나만 씀
  if (env.isApp) {
    return [
      h('h2', {}, '목소리'),
      h('p', {}, '휴대폰에 기본으로 정해진 목소리로 읽어요. Chrome에서 듣던 소리와 같아요.'),
      h('div', { class: 'row' }, sampleBtn),
      ...common,
      h('details', { class: 'card' }, h('summary', {}, '목소리를 바꾸고 싶을 때'),
        h('p', {}, '앱은 휴대폰 설정의 \u2018텍스트 음성 변환\u2019 목소리를 그대로 써요. 거기서 바꾸면 앱 목소리도 바뀌어요.'),
        h('ol', { class: 'steps' },
          h('li', {}, '휴대폰 설정 맨 위 검색(돋보기)에 \u2018텍스트 음성 변환\u2019을 입력해 들어가세요. (삼성: 설정 → 일반 → 텍스트 음성 변환)'),
          h('li', {}, '\u2018기본 엔진\u2019(또는 \u2018선호하는 엔진\u2019)에서 엔진을 고르세요. 엔진 옆 톱니바퀴를 누르면 한국어 목소리를 고르거나 내려받을 수 있어요.'),
          h('li', {}, '그 화면의 \u2018듣기\u2019(재생)로 소리를 확인한 뒤, 이 앱으로 돌아와 \u2018들어 보기\u2019를 누르세요.')),
        h('p', { class: 'small-text' }, '휴대폰마다 메뉴 이름이 조금 다를 수 있어요.')),
      h('div', { class: 'actions' }, btn(doneLabel, onDone, { kind: 'primary', cls: 'big' })),
    ];
  }

  drawVoices();
  const guide = env.isIOS
    ? ['설정 → 손쉬운 사용 → 읽기 및 말하기(또는 음성 콘텐츠) → 음성 → 한국어로 들어가세요.', "이름 옆에 '향상된 음질'이나 '고품질'이 붙은 목소리를 내려받으세요.", '이 화면으로 돌아와 \u2018목소리 다시 찾기\u2019를 누르세요.']
    : ['휴대폰 설정에서 \u2018텍스트 음성 변환\u2019을 검색하세요. (일반 관리 → 언어 및 입력 안에 있기도 해요)', "기본 엔진을 'Google 음성 인식 및 합성'으로 고르고, 그 설정에서 \u2018음성 데이터 설치\u2019 → 한국어를 내려받으세요.", '이 화면으로 돌아와 \u2018목소리 다시 찾기\u2019를 누르세요.'];

  return [
    !env.tts ? note('이 브라우저에서는 소리를 낼 수 없어요. 안드로이드는 Chrome, 아이폰은 Safari로 열어 주세요.', 'warn') : null,
    h('h2', {}, '목소리'),
    list,
    h('div', { class: 'row' }, sampleBtn, btn('목소리 다시 찾기', () => drawVoices(true))),
    ...common,
    h('details', { class: 'card' }, h('summary', {}, '더 또렷한 목소리 설치하기'),
      h('p', {}, '앱은 휴대폰에 설치된 목소리를 그대로 써요. 기기의 기본 목소리가 어색하면 더 좋은 한국어 목소리를 설치해 보세요.'),
      h('ol', { class: 'steps' }, guide.map((g) => h('li', {}, g))),
      h('p', { class: 'small-text' }, '기기마다 메뉴 이름이 조금 다를 수 있어요.')),
    h('div', { class: 'actions' }, btn(doneLabel, onDone, { kind: 'primary', cls: 'big' })),
  ];
}

SCREENS['setup-voice'] = () => {
  const d = store.data();
  frame({
    title: '목소리와 빠르기',
    sub: '듣기 편한 목소리와 빠르기를 고르세요.',
    body: voicePanel({
      doneLabel: '다음',
      onDone: () => {
        if (d.backup.on && !S.setup.restoring) go('setup-code');
        else { S.setup.restoring = false; go('home'); }
      },
    }),
  });
};

SCREENS['setup-code'] = () => {
  const d = store.data();
  if (!d.backup.on || !d.backup.code) { go('home'); return; }
  const startBtn = btn('시작하기', () => { sync(); go(S.setup.afterCode || 'home'); }, { kind: 'primary', cls: 'big', disabled: true });
  const check = h('input', { type: 'checkbox', id: 'wrote', onchange: (e) => { startBtn.disabled = !e.target.checked; } });
  frame({
    title: '복구 코드를 적어 두세요',
    sub: '휴대폰을 바꾸거나 기록이 지워졌을 때 이 코드로 기록을 되살려요. 코드를 잃어버리면 운영자도 기록을 찾아 드릴 수 없어요.',
    body: [
      codeBox(d.backup.code),
      h('div', { class: 'row' }, btn('코드 복사하기', () => copyText(backup.formatCode(d.backup.code)))),
      h('ul', { class: 'tips' },
        h('li', {}, '종이에 적어 수첩이나 냉장고에 붙여 두세요.'),
        h('li', {}, '믿을 수 있는 가족에게 보내 두어도 좋아요.'),
        h('li', {}, '설정 → 기록 백업에서 언제든 다시 볼 수 있어요.')),
      h('label', { class: 'check', for: 'wrote' }, check, h('span', {}, '복구 코드를 적어 두었어요')),
      h('div', { class: 'actions' }, startBtn),
    ],
  });
};

SCREENS.restore = () => {
  const d = store.data();
  const onboarded = !!(d && d.consent);
  const configured = S.server && S.server.configured;
  const msg = h('p', { class: 'msg', role: 'alert' });
  const input = h('input', {
    type: 'text', id: 'code', class: 'code-input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    inputmode: 'text', maxlength: '24', placeholder: 'XXXX-XXXX-XXXX-XXXX', 'aria-describedby': 'code-help',
  });
  const go1 = btn('불러오기', () => fromCode(), { kind: 'primary', cls: 'big' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'file', onchange: (e) => fromFile(e.target.files[0]) });

  function finishRestore(synced, withBackup, code = '', n = 0) {
    const base = store.data() || store.blank();
    const merged = store.merge({ myWords: base.myWords, days: base.days }, synced);
    base.myWords = merged.myWords;
    base.days = merged.days;
    if (!base.consent) base.consent = { at: Date.now(), version: CONSENT_VERSION, backup: withBackup };
    if (withBackup) { base.consent.backup = true; base.backup = { ...base.backup, on: true, code, n, dirty: true, error: '', lastAt: Date.now() }; }
    store.set(base);
    store.askPersist();
    S.rev++;
    if (withBackup) sync();
    const days = Object.values(synced.days).filter(practiced).length;
    toast(`기록을 불러왔어요. (연습한 날 ${days}일)`);
    if (onboarded) go(withBackup ? 'settings-backup' : 'records');
    else { S.setup.restoring = true; go('setup-voice'); }
  }

  async function fromCode() {
    const code = backup.normalizeCode(input.value);
    if (!code) { msg.textContent = '복구 코드는 16자리예요. 다시 확인해 주세요.'; input.focus(); return; }
    go1.disabled = true;
    msg.textContent = '불러오는 중이에요…';
    try {
      const r = await backup.fetchRemote(code);
      if (!r) { msg.textContent = backup.errorText('not_found'); return; }
      if (d && d.backup.on && d.backup.code && d.backup.code !== code) {
        const ok = await modal({
          title: '복구 코드를 바꿀까요?',
          body: [h('p', {}, '지금 쓰는 백업 대신 입력한 코드의 백업을 쓰게 돼요. 두 기록은 하나로 합쳐지고, 지금 쓰는 백업 서버의 기록은 지워져요.')],
          actions: [{ label: '취소', value: false }, { label: '합치고 바꾸기', value: true, kind: 'primary' }],
        });
        if (!ok) { msg.textContent = ''; return; }
        try { await backup.deleteRemote(d.backup.code); } catch { /* 예전 백업을 못 지워도 진행 (400일 뒤 자동 삭제) */ }
      }
      finishRestore(store.sanitizeSynced(r.payload), true, code, r.n);
    } catch (e) {
      msg.textContent = backup.errorText(e.code);
    } finally {
      go1.disabled = false;
    }
  }

  async function fromFile(file) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('big');
      const obj = JSON.parse(await file.text());
      if (!obj || obj.app !== 'malhagi') throw new Error('format');
      finishRestore(store.sanitizeSynced(obj), false);
    } catch {
      msg.textContent = '이 파일은 말하기 짝꿍 기록 파일이 아니거나 열 수 없어요.';
    } finally {
      fileInput.value = '';
    }
  }

  frame({
    title: '쓰던 기록 불러오기',
    back: { onClick: () => go(onboarded ? 'settings-backup' : 'start') },
    body: [
      configured
        ? card(h('h2', {}, '복구 코드로 불러오기'),
          h('label', { for: 'code', class: 'label' }, '복구 코드 16자리'),
          input,
          h('p', { id: 'code-help', class: 'small-text' }, '대문자·소문자, 띄어쓰기와 줄표(-)는 상관없어요.'),
          h('div', { class: 'actions' }, go1),
          onboarded ? note('불러온 기록은 이 기기의 기록과 합쳐지고, 이 코드로 백업이 이어져요.') : null)
        : null,
      card(h('h2', {}, '기록 파일로 불러오기'),
        h('p', {}, `예전 기기의 설정 → ${configured ? '기록 백업' : '기록 저장·불러오기'} → ‘기록 파일 내려받기’로 저장한 파일을 고르세요.`),
        onboarded ? h('p', { class: 'small-text' }, '불러온 기록은 이 기기의 기록과 합쳐져요.') : null,
        fileInput,
        h('label', { for: 'file', class: 'btn btn-secondary' }, '파일 고르기')),
      msg,
    ],
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') fromCode(); });
};

SCREENS.home = () => {
  const d = store.data();
  const day = today();
  const key = store.dateKey();
  const yKey = store.addDays(key, -1);
  const yDay = d.days[yKey];

  const todayCard = (type) => {
    const list = day.plan[type];
    const heard = heardCount(day, list);
    const done = heard >= list.length;
    const name = type === 'word' ? '오늘의 낱말' : '오늘의 문장';
    const bar = h('div', { class: 'bar' }, h('div', { class: 'bar-fill' }));
    bar.firstChild.style.width = `${Math.round((heard / list.length) * 100)}%`;
    return card(
      h('div', { class: 'card-head' }, h('h2', {}, name), done ? h('span', { class: 'badge' }, '✓ 다 했어요') : null),
      h('p', {}, `${list.length}개 중 ${heard}개를 들었어요.`),
      bar,
      btn(heard === 0 ? '시작하기' : done ? '한 번 더 하기' : '이어서 하기', () => {
        const start = done ? 0 : Math.max(0, list.findIndex((it) => !(day.items[it.id]?.p > 0)));
        startPractice(list, { title: name, from: 'home', kind: `today-${type}`, start });
      }, { kind: done ? 'secondary' : 'primary', cls: 'big' }));
  };

  const yWords = yDay ? dayItems(yDay, 'word').length : 0;
  const ySent = yDay ? dayItems(yDay, 'sentence').length : 0;
  const allDone = heardCount(day, day.plan.word) >= day.plan.word.length && heardCount(day, day.plan.sentence) >= day.plan.sentence.length;

  frame({
    title: '오늘의 연습',
    sub: dateLabel(new Date()),
    nav: 'home',
    body: [
      d.backup.on && d.backup.error && d.backup.error !== 'offline' ? note(`백업: ${backup.errorText(d.backup.error)}`, 'warn') : null,
      todayCard('word'),
      todayCard('sentence'),
      h('h2', {}, '더 연습하기'),
      allDone ? h('p', {}, '오늘 목록을 다 했어요! 더 하고 싶으면 골라 보세요.') : null,
      h('div', { class: 'grid2' },
        btn('분야별 낱말', () => go('more/word'), { cls: 'big' }),
        btn('분야별 문장', () => go('more/sentence'), { cls: 'big' })),
      h('h2', {}, '지난 연습'),
      h('div', { class: 'stack' },
        yWords + ySent > 0
          ? btn(`어제 연습 다시 하기 (낱말 ${yWords} · 문장 ${ySent})`, () => go(`day/${yKey}`), { cls: 'big' })
          : null,
        btn('지난 연습 모두 보기', () => go('records'))),
    ],
  });
};

SCREENS.more = (type) => {
  if (type !== 'word' && type !== 'sentence') { go('home'); return; }
  const d = store.data();
  const mine = words.myItems(d.myWords, type);
  const name = type === 'word' ? '분야별 낱말' : '분야별 문장';
  frame({
    title: name,
    sub: '연습할 분야를 고르세요.',
    back: { label: '홈', onClick: () => go('home') },
    nav: 'home',
    body: h('div', { class: 'stack' },
      btn(`${words.MY_CATEGORY[type]} · ${mine.length}개`, () => {
        if (!mine.length) { go(`settings-words/${type}`); return; }
        startPractice(mine, { title: words.MY_CATEGORY[type], from: `more/${type}`, kind: 'mine' });
      }, { cls: 'big mine' }),
      words.categories(type).map((c) => btn(`${c.name} · ${c.items.length}개`, () => go(`cat/${type}/${c.id}`), { cls: 'big' }))),
  });
};

// 분야 하나: 10개씩 묶어서 고르기 (100개를 한 번에 하면 지치기 쉬움)
const SET_SIZE = 10;

function startSet(type, catId, start) {
  const c = words.categories(type).find((x) => x.id === catId);
  if (!c) { go(`more/${type}`); return; }
  const items = c.items.slice(start, start + SET_SIZE);
  const hasNext = start + SET_SIZE < c.items.length;
  startPractice(items, {
    title: `${c.name} ${start + 1}~${start + items.length}`,
    from: `cat/${type}/${catId}`,
    kind: 'category',
    next: hasNext ? { type, catId, start: start + SET_SIZE } : null,
  });
}

SCREENS.cat = (arg) => {
  const [type, catId] = arg.split('/');
  const c = (type === 'word' || type === 'sentence') && words.categories(type).find((x) => x.id === catId);
  if (!c) { go('home'); return; }
  const day = today();
  const sets = [];
  for (let i = 0; i < c.items.length; i += SET_SIZE) sets.push(c.items.slice(i, i + SET_SIZE));
  const firstLeft = sets.findIndex((set) => set.some((it) => !(day.items[it.id]?.p > 0)));
  frame({
    title: c.name,
    sub: `${c.items.length}개를 ${SET_SIZE}개씩 나눠 연습해요. 오늘 다 들은 묶음에는 ✓가 붙어요.`,
    back: { label: type === 'word' ? '분야별 낱말' : '분야별 문장', onClick: () => go(`more/${type}`) },
    nav: 'home',
    body: [
      firstLeft >= 0
        ? btn(firstLeft === 0 && sets[0].every((it) => !(day.items[it.id]?.p > 0)) ? '처음부터 시작하기' : `이어서 하기 (${firstLeft * SET_SIZE + 1}~${firstLeft * SET_SIZE + sets[firstLeft].length})`,
          () => startSet(type, catId, firstLeft * SET_SIZE), { kind: 'primary', cls: 'big' })
        : note('오늘 이 분야를 모두 들었어요! 다시 하고 싶은 묶음을 골라 보세요.'),
      h('div', { class: 'set-grid' }, sets.map((set, i) => {
        const heard = set.filter((it) => day.items[it.id]?.p > 0).length;
        const done = heard === set.length;
        const a = i * SET_SIZE + 1;
        const b = i * SET_SIZE + set.length;
        return h('button', {
          type: 'button', class: `set${done ? ' done' : heard ? ' part' : ''}`,
          'aria-label': `${a}번부터 ${b}번까지${done ? ', 오늘 다 들음' : heard ? `, ${heard}개 들음` : ''}`,
          onclick: () => startSet(type, catId, i * SET_SIZE),
        }, h('span', { class: 'set-range' }, `${a}~${b}`), h('span', { class: 'set-preview' }, `${set[0].t} …`),
        done ? h('span', { class: 'set-mark', 'aria-hidden': 'true' }, '✓') : heard ? h('span', { class: 'set-mark', 'aria-hidden': 'true' }, `${heard}/${set.length}`) : null);
      })),
    ],
  });
};

function startPractice(items, { title, from, kind, start = 0, next = null }) {
  if (!items.length) return;
  S.practice = { items: items.map(({ id, t, k, c }) => ({ id, t, k, c })), i: Math.min(start, items.length - 1), title, from, kind, next };
  go('practice');
}

SCREENS.practice = () => {
  const P = S.practice;
  const it = P.items[P.i];
  const rec = itemRecord(it);
  const count = h('p', { class: 'count', 'aria-live': 'polite' }, `들은 횟수 ${rec.p}번`);
  const target = h('p', { class: `target ${it.k}`, lang: 'ko' }, it.t);

  const play = (slow) => {
    const n = addPlay(it);
    count.textContent = `들은 횟수 ${n}번`;
    const rate = slow ? speech.slowRate(dev().rate) : dev().rate;
    speech.speak(it.t, { voice: dev().voice, rate });
  };
  const move = (delta) => {
    speech.stop();
    const next = P.i + delta;
    if (next >= P.items.length) {
      const day = today();
      S.lastDone = { title: P.title, n: P.items.length, plays: P.items.reduce((s, x) => s + (day.items[x.id]?.p || 0), 0), kind: P.kind, from: P.from, next: P.next };
      go('done');
      return;
    }
    P.i = Math.max(0, next);
    SCREENS.practice();
  };
  const last = P.i === P.items.length - 1;

  frame({
    back: { label: '그만하기', onClick: () => { speech.stop(); go(P.from || 'home'); } },
    cls: 'practice',
    body: [
      h('div', { class: 'progress' },
        h('span', { class: 'step' }, `${P.i + 1} / ${P.items.length}`),
        h('span', { class: 'tag' }, P.title)),
      h('div', { class: 'stage' }, target),
      count,
      !env.tts ? note('이 브라우저에서는 소리를 낼 수 없어요. 글자를 보고 소리 내어 읽어 보세요.', 'warn') : null,
      h('div', { class: 'play-row' },
        btn('다시 듣기', () => play(false), { kind: 'primary', cls: 'big', disabled: !env.tts }),
        btn('천천히 듣기', () => play(true), { cls: 'big', disabled: !env.tts })),
      h('div', { class: 'move-row' },
        btn('‹ 이전', () => move(-1), { disabled: P.i === 0 }),
        btn(last ? '마치기 ✓' : '다음 ›', () => move(1), { kind: last ? 'primary' : 'secondary' })),
    ],
  });
  document.title = `${it.t} · ${P.title}`;
  requestAnimationFrame(() => fitText(target));
  if (env.tts && dev().autoplay) setTimeout(() => { if (route().name === 'practice' && S.practice === P && P.items[P.i] === it) play(false); }, 300);
};

SCREENS.done = () => {
  const L = S.lastDone;
  const day = today();
  const sentenceLeft = heardCount(day, day.plan.sentence) < day.plan.sentence.length;
  const wordLeft = heardCount(day, day.plan.word) < day.plan.word.length;
  frame({
    title: '잘하셨어요!',
    sub: `${L.title} ${L.n}개를 모두 들었어요.`,
    nav: 'home',
    body: [
      h('div', { class: 'celebrate', 'aria-hidden': 'true' }, '🌱'),
      h('p', { class: 'center' }, `이번에 들은 횟수 모두 ${L.plays}번`),
      h('div', { class: 'stack' },
        L.kind === 'today-word' && sentenceLeft ? btn('오늘의 문장 하기', () => startPractice(day.plan.sentence, { title: '오늘의 문장', from: 'home', kind: 'today-sentence' }), { kind: 'primary', cls: 'big' }) : null,
        L.kind === 'today-sentence' && wordLeft ? btn('오늘의 낱말 하기', () => startPractice(day.plan.word, { title: '오늘의 낱말', from: 'home', kind: 'today-word' }), { kind: 'primary', cls: 'big' }) : null,
        L.next ? btn('다음 10개 하기', () => startSet(L.next.type, L.next.catId, L.next.start), { kind: 'primary', cls: 'big' }) : null,
        S.practice ? btn('같은 목록 한 번 더', () => startPractice(S.practice.items, { ...S.practice, start: 0 }), { cls: 'big' }) : null,
        L.kind === 'category' && L.from ? btn('묶음 고르기', () => go(L.from), { cls: 'big' }) : btn('분야별로 더 연습하기', () => go('more/word'), { cls: 'big' }),
        btn('처음 화면으로', () => go('home'))),
    ],
  });
};

SCREENS.records = () => {
  const d = store.data();
  const keys = Object.keys(d.days).filter((k) => practiced(d.days[k])).sort();
  const now = new Date();
  if (!S.calMonth) S.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const m = S.calMonth;
  const monthPrefix = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-`;
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const totalPlays = keys.reduce((s, k) => s + Object.values(d.days[k].items).reduce((a, it) => a + it.p, 0), 0);

  const cal = h('div', { class: 'calendar', role: 'group', 'aria-label': `${m.getFullYear()}년 ${m.getMonth() + 1}월` },
    WEEKDAYS.map((w) => h('span', { class: 'wd', 'aria-hidden': 'true' }, w)));
  for (let i = 0; i < m.getDay(); i++) cal.append(h('span', { class: 'cell empty' }));
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const todayKey = store.dateKey();
  for (let day = 1; day <= daysIn; day++) {
    const key = `${monthPrefix}${String(day).padStart(2, '0')}`;
    const rec = d.days[key];
    const has = practiced(rec);
    const plays = has ? Object.values(rec.items).reduce((a, it) => a + it.p, 0) : 0;
    const cls = `cell${has ? ' has' : ''}${key === todayKey ? ' today' : ''}`;
    cal.append(has
      ? h('button', { type: 'button', class: cls, onclick: () => go(`day/${key}`), 'aria-label': `${m.getMonth() + 1}월 ${day}일, 연습함, 들은 횟수 ${plays}번` }, String(day))
      : h('span', { class: cls, 'aria-label': `${m.getMonth() + 1}월 ${day}일` }, String(day)));
  }
  const shift = (n) => { S.calMonth = new Date(m.getFullYear(), m.getMonth() + n, 1); SCREENS.records(); };
  const isCurrent = m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth();

  const recent = keys.slice(-7).reverse();
  frame({
    title: '나의 기록',
    nav: 'records',
    body: [
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('strong', {}, `${keys.length}일`), h('span', {}, '연습한 날 모두')),
        h('div', { class: 'stat' }, h('strong', {}, `${keys.filter((k) => k.startsWith(thisMonth)).length}일`), h('span', {}, '이번 달')),
        h('div', { class: 'stat' }, h('strong', {}, `${totalPlays}번`), h('span', {}, '들은 횟수 모두'))),
      card(
        h('div', { class: 'cal-head' },
          btn('‹', () => shift(-1), { kind: 'ghost', 'aria-label': '지난달' }),
          h('h2', {}, `${m.getFullYear()}년 ${m.getMonth() + 1}월`),
          btn('›', () => shift(1), { kind: 'ghost', 'aria-label': '다음 달', disabled: isCurrent })),
        cal,
        h('p', { class: 'small-text' }, '색칠된 날짜를 누르면 그날 연습한 낱말과 문장을 다시 할 수 있어요.')),
      h('h2', {}, '최근 연습'),
      recent.length
        ? h('div', { class: 'stack' }, recent.map((k) => {
          const rec = d.days[k];
          return btn(`${dateLabel(store.parseKey(k))} · 낱말 ${dayItems(rec, 'word').length} · 문장 ${dayItems(rec, 'sentence').length}`, () => go(`day/${k}`));
        }))
        : h('p', {}, '아직 연습한 날이 없어요. 홈에서 오늘의 낱말부터 시작해 보세요.'),
    ],
  });
};

SCREENS.day = (key) => {
  const d = store.data();
  const rec = d.days[key];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) { go('records'); return; }
  const date = store.parseKey(key);
  const isToday = key === store.dateKey();
  const isYesterday = key === store.addDays(store.dateKey(), -1);
  const title = isToday ? '오늘 연습' : isYesterday ? '어제 연습' : dateLabel(date);
  const section = (type) => {
    const list = rec ? dayItems(rec, type) : [];
    if (!list.length) return null;
    const name = type === 'word' ? '낱말' : '문장';
    return card(
      h('div', { class: 'card-head' }, h('h2', {}, `${name} ${list.length}개`)),
      h('ul', { class: 'list' }, list.map((it) => h('li', {}, h('span', { class: 'li-text' }, it.t), h('span', { class: 'li-num' }, `${it.p}번`)))),
      btn(`이날 ${name} 다시 하기`, () => startPractice(list, { title: `${dateLabel(date, { weekday: false })} ${name}`, from: `day/${key}`, kind: 'past' }), { kind: 'primary', cls: 'big' }));
  };
  const w = section('word');
  const s = section('sentence');
  frame({
    title,
    sub: isToday || isYesterday ? dateLabel(date) : null,
    back: { label: '기록', onClick: () => go('records') },
    nav: 'records',
    body: [
      w, s,
      !w && !s ? h('p', {}, '이날은 연습 기록이 없어요.') : null,
      w && s ? btn('낱말과 문장 모두 다시 하기', () => startPractice([...dayItems(rec, 'word'), ...dayItems(rec, 'sentence')], { title: dateLabel(date, { weekday: false }), from: `day/${key}`, kind: 'past' }), { cls: 'big' }) : null,
    ],
  });
};

SCREENS.settings = () => {
  const d = store.data();
  const mineCount = Object.values(d.myWords).filter((w) => !w.del).length;
  const fontLabel = (FONT_SIZES.find((s) => s.value === getFontScale()) || FONT_SIZES[1]).label;
  const row = (label, value, onClick, cls = '') => h('button', { type: 'button', class: `row-item ${cls}`.trim(), onclick: () => onClick() },
    h('span', { class: 'row-label' }, label), value ? h('span', { class: 'row-value' }, value) : null, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  frame({
    title: '설정',
    nav: 'settings',
    body: [
      h('div', { class: 'rows' },
        row('글씨 크기', fontLabel, () => { openFontModal(); }),
        row('목소리와 빠르기', '', () => go('settings-voice')),
        row('나만의 낱말·문장', `${mineCount}개`, () => go('settings-words/word')),
        backupAvailable() || d.backup.on
          ? row('기록 백업', d.backup.on ? '켜짐' : '꺼짐', () => go('settings-backup'))
          : row('기록 저장·불러오기', '', () => go('settings-backup')),
        env.isApp ? null : row('홈 화면에 추가하기', '', () => homeScreenGuide(false)),
        env.isAndroid && !env.standalone && !env.isApp ? row('안드로이드 앱 설치하기', '', () => androidAppGuide()) : null),
      h('div', { class: 'rows' },
        h('a', { class: 'row-item', href: './privacy.html', target: '_blank', rel: 'noopener' }, h('span', { class: 'row-label' }, '개인정보 처리방침'), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
        row('모든 기록 지우기', '', () => deleteAll(), 'danger')),
      h('p', { class: 'small-text center' }, `말하기 짝꿍 v${VERSION}`),
    ],
  });
};

SCREENS['settings-voice'] = () => {
  frame({
    title: '목소리와 빠르기',
    back: { label: '설정', onClick: () => go('settings') },
    nav: 'settings',
    body: voicePanel({ doneLabel: '완료', onDone: () => { toast('저장했어요.'); go('settings'); } }),
  });
};

SCREENS['settings-words'] = (typeArg) => {
  const d = store.data();
  let type = typeArg === 'sentence' ? 'sentence' : 'word';
  const msg = h('p', { class: 'msg', role: 'alert' });
  const input = h('input', { type: 'text', id: 'new-word', class: 'text-input', autocomplete: 'off' });
  const typeChoices = h('div', { class: 'choices', role: 'group', 'aria-label': '종류' });
  const lists = h('div', {});

  const drawType = () => {
    typeChoices.replaceChildren(
      choice('낱말', type === 'word', () => { type = 'word'; history.replaceState(null, '', '#/settings-words/word'); drawType(); }),
      choice('문장', type === 'sentence', () => { type = 'sentence'; history.replaceState(null, '', '#/settings-words/sentence'); drawType(); }));
    input.maxLength = type === 'word' ? store.LIMITS.WORD_LEN : store.LIMITS.SENTENCE_LEN;
    input.placeholder = type === 'word' ? '예: 영희, 복지관, 보청기' : '예: 영희야 밥 먹었니?';
  };

  const drawLists = () => {
    lists.replaceChildren(...['word', 'sentence'].map((k) => {
      const items = words.myItems(d.myWords, k);
      const name = words.MY_CATEGORY[k];
      return card(
        h('div', { class: 'card-head' }, h('h2', {}, `${name} ${items.length}개`)),
        items.length
          ? h('ul', { class: 'list' }, items.map((it) => h('li', {},
            h('span', { class: 'li-text' }, it.t),
            btn('지우기', () => remove(it), { kind: 'ghost', cls: 'small', 'aria-label': `${it.t} 지우기` }))))
          : h('p', { class: 'small-text' }, '아직 없어요.'),
        items.length ? btn(`${name} 연습하기`, () => startPractice(items, { title: name, from: `settings-words/${k}`, kind: 'mine' }), { kind: 'primary' }) : null);
    }));
  };

  function add() {
    const t = input.value.trim().replace(/\s+/g, ' ');
    const max = type === 'word' ? store.LIMITS.WORD_LEN : store.LIMITS.SENTENCE_LEN;
    const active = Object.values(d.myWords).filter((w) => !w.del);
    if (!t) { msg.textContent = '넣을 낱말이나 문장을 써 주세요.'; input.focus(); return; }
    if (t.length > max) { msg.textContent = `${max}자까지 넣을 수 있어요.`; return; }
    if (active.length >= store.LIMITS.MY_WORDS) { msg.textContent = `나만의 낱말·문장은 ${store.LIMITS.MY_WORDS}개까지 넣을 수 있어요.`; return; }
    if (active.some((w) => w.t === t && w.k === type)) { msg.textContent = '이미 들어 있어요.'; return; }
    d.myWords[store.newId()] = { t, k: type, at: Date.now() };
    markDirty();
    input.value = '';
    msg.textContent = '';
    toast(`'${t}'을(를) 넣었어요.`);
    drawLists();
    input.focus();
  }

  async function remove(it) {
    const ok = await modal({
      title: '지울까요?',
      body: [h('p', {}, `'${it.t}'을(를) 나만의 목록에서 지워요. 이미 연습한 기록은 그대로 남아요.`)],
      actions: [{ label: '취소', value: false }, { label: '지우기', value: true, kind: 'danger' }],
    });
    if (!ok) return;
    d.myWords[it.id] = { t: '', k: it.k, at: Date.now(), del: true };
    markDirty();
    drawLists();
  }

  drawType();
  drawLists();
  frame({
    title: '나만의 낱말·문장',
    sub: '가족 이름, 자주 가는 곳, 자주 하는 말을 넣어 두면 연습할 수 있고, 오늘의 목록에도 가끔 나와요.',
    back: { label: '설정', onClick: () => go('settings') },
    nav: 'settings',
    body: [
      card(
        typeChoices,
        h('label', { for: 'new-word', class: 'label' }, '새로 넣기'),
        input,
        h('div', { class: 'actions' }, btn('넣기', add, { kind: 'primary', cls: 'big' })),
        msg),
      lists,
    ],
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
};

SCREENS['settings-backup'] = () => {
  const d = store.data();
  const configured = S.server && S.server.configured;
  const status = h('p', { class: 'msg', role: 'status' });
  const busy = (b, text = '') => { document.querySelectorAll('.backup-actions button').forEach((x) => { x.disabled = b; }); status.textContent = text; };

  async function syncNow() {
    busy(true, '백업하는 중이에요…');
    const r = await sync();
    if (r.ok) { SCREENS['settings-backup'](); toast('백업했어요.'); } else busy(false, backup.errorText(r.error));
  }

  async function turnOn() {
    const ok = await modal({
      title: '백업을 켤까요?',
      body: [h('p', {}, '연습 기록(건강과 관련된 정보일 수 있어요)을 이 휴대폰에서 암호화한 뒤 백업 서버에 보관해요. 암호를 푸는 열쇠는 복구 코드뿐이라 운영자도 내용을 볼 수 없어요.'),
        h('p', {}, h('a', { href: './privacy.html', target: '_blank', rel: 'noopener' }, '개인정보 처리방침 보기'))],
      actions: [{ label: '취소', value: false }, { label: '동의하고 켜기', value: true, kind: 'primary' }],
    });
    if (!ok) return;
    d.consent = { ...d.consent, backup: true, backupAt: Date.now(), version: CONSENT_VERSION };
    d.backup = { ...d.backup, on: true, code: backup.makeCode(), n: 0, dirty: true, error: '', lastAt: 0 };
    store.save();
    S.setup.afterCode = 'settings-backup';
    go('setup-code');
  }

  async function turnOff() {
    const ok = await modal({
      title: '백업을 끌까요?',
      body: [h('p', {}, '백업 서버에 있는 기록을 지워요. 이 기기의 기록은 그대로 남아요. 지금 복구 코드는 더 쓸 수 없게 돼요.')],
      actions: [{ label: '취소', value: false }, { label: '백업 끄기', value: true, kind: 'danger' }],
    });
    if (!ok) return;
    busy(true, '지우는 중이에요…');
    try {
      await backup.deleteRemote(d.backup.code);
    } catch (e) {
      busy(false, `${backup.errorText(e.code)} 서버의 기록을 지우지 못해 백업을 끄지 않았어요.`);
      return;
    }
    d.backup = { ...store.blank().backup };
    d.consent = { ...d.consent, backup: false };
    store.save();
    toast('백업을 껐어요.');
    SCREENS['settings-backup']();
  }

  async function rotate() {
    const ok = await modal({
      title: '새 복구 코드로 바꿀까요?',
      body: [h('p', {}, '복구 코드가 다른 사람에게 알려졌을 때 쓰세요. 새 코드로 다시 백업하고, 예전 코드의 백업은 지워요. 다른 기기에서 쓰고 있었다면 그 기기에서도 새 코드로 다시 불러와야 해요.')],
      actions: [{ label: '취소', value: false }, { label: '새 코드 받기', value: true, kind: 'primary' }],
    });
    if (!ok) return;
    busy(true, '새 코드로 백업하는 중이에요…');
    const oldCode = d.backup.code;
    const newCode = backup.makeCode();
    try {
      await sync(); // 다른 기기의 최신 기록을 먼저 합침
      const n = await backup.storeRemote(newCode, 0, payload(d));
      d.backup = { ...d.backup, code: newCode, n, lastAt: Date.now(), dirty: false, error: '' };
      store.save();
      try { await backup.deleteRemote(oldCode); } catch { /* 예전 백업은 400일 뒤 자동 삭제 */ }
    } catch (e) {
      busy(false, backup.errorText(e.code));
      return;
    }
    S.setup.afterCode = 'settings-backup';
    go('setup-code');
  }

  function exportFile() {
    const obj = { ...payload(d), exportedAt: new Date().toISOString(), version: VERSION };
    if (appBridge && appBridge.saveFile) {
      let r = 'error';
      try { r = appBridge.saveFile(`말하기짝꿍-기록-${store.dateKey()}.json`, JSON.stringify(obj)); } catch { r = 'error'; }
      toast(r === 'ok' ? '휴대폰의 다운로드 폴더에 기록 파일을 저장했어요.' : '기록 파일을 저장하지 못했어요.');
      return;
    }
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `말하기짝꿍-기록-${store.dateKey()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('기록 파일을 내려받았어요.');
  }

  const fileCards = [
    card(h('h2', {}, '기록 파일 내려받기'),
      h('p', {}, '휴대폰을 바꾸기 전이나 가끔 한 번씩 기록을 파일로 내려받아 두세요. 새 기기에서 ‘쓰던 기록 불러오기’로 그대로 옮길 수 있어요.'),
      h('p', { class: 'small-text' }, '이 파일에는 암호가 걸려 있지 않으니 잘 보관해 주세요.'),
      btn('기록 파일 내려받기', exportFile, { kind: 'primary' })),
    card(h('h2', {}, '다른 기기의 기록 불러오기'),
      h('p', {}, d.backup.on || configured ? '다른 기기에서 받은 복구 코드나 기록 파일로 기록을 불러와 이 기기의 기록과 합쳐요.' : '다른 기기에서 내려받은 기록 파일을 불러와 이 기기의 기록과 합쳐요.'),
      btn('불러오기', () => go('restore'))),
  ];

  if (!d.backup.on && !configured) {
    frame({
      title: '기록 저장·불러오기',
      back: { label: '설정', onClick: () => go('settings') },
      nav: 'settings',
      body: [
        note('연습 기록은 이 휴대폰 안에만 있어요. 휴대폰을 바꾸거나 브라우저 기록을 지우면 사라질 수 있어요.'),
        ...fileCards,
      ],
    });
    return;
  }

  frame({
    title: '기록 백업',
    back: { label: '설정', onClick: () => go('settings') },
    nav: 'settings',
    body: [
      d.backup.on
        ? card(h('h2', {}, '백업이 켜져 있어요'),
          h('p', {}, d.backup.error ? backup.errorText(d.backup.error) : lastBackupText(d)),
          h('div', { class: 'stack backup-actions' },
            btn('지금 백업하기', syncNow, { kind: 'primary' }),
            btn('복구 코드 보기', () => showCodeModal(d.backup.code)),
            btn('새 복구 코드로 바꾸기', rotate),
            btn('백업 끄기', turnOff, { kind: 'danger' })),
          status)
        : card(h('h2', {}, '백업이 꺼져 있어요'),
          h('p', {}, '기록은 이 기기에만 있어요. 휴대폰을 바꾸거나 브라우저 기록을 지우면 사라질 수 있어요.'),
          h('div', { class: 'stack backup-actions' }, btn('백업 켜기', turnOn, { kind: 'primary' })),
          status),
      ...fileCards,
    ],
  });
};

async function deleteAll() {
  const d = store.data();
  const ok = await modal({
    title: '모든 기록을 지울까요?',
    body: [h('p', {}, '이 기기의 연습 기록과 나만의 낱말·문장을 모두 지워요. 지운 기록은 되살릴 수 없어요.'),
      d.backup.on ? h('p', {}, '백업 서버에 있는 기록도 함께 지워요.') : null],
    actions: [{ label: '취소', value: false }, { label: '모두 지우기', value: true, kind: 'danger' }],
  });
  if (!ok) return;
  if (d.backup.on && d.backup.code) {
    try {
      await backup.deleteRemote(d.backup.code);
    } catch (e) {
      const go2 = await modal({
        title: '백업은 지우지 못했어요',
        body: [h('p', {}, backup.errorText(e.code)), h('p', {}, '이 기기의 기록만 먼저 지울까요? 서버의 백업은 마지막 사용 후 400일이 지나면 자동으로 지워져요.')],
        actions: [{ label: '취소', value: false }, { label: '이 기기만 지우기', value: true, kind: 'danger' }],
      });
      if (!go2) return;
    }
  }
  clearTimeout(markDirty.timer);
  store.wipe();
  store.wipeDevice();
  S.practice = null;
  S.lastDone = null;
  toast('모든 기록을 지웠어요.');
  go('start');
}

// ── 시작 (모든 화면을 정의한 뒤에 실행) ──

applyFontScale(getFontScale(), { save: false });
store.load();
// 앱 3.3.1: 기본값을 '휴대폰 기본 목소리'(Chrome과 같은 소리)로 한 번 되돌림
if (env.isApp && !store.device().voiceReset331) store.setDevice({ voice: '', voiceReset331: true });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 오프라인 기능만 빠짐 */ });
}

window.addEventListener('hashchange', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && store.data()?.backup.dirty) sync();
});
window.addEventListener('online', () => { if (store.data()?.backup.dirty) sync(); });
window.addEventListener('resize', () => refit());

render();
finishSplash();
backup.ping().then((s) => {
  S.server = s;
  const name = route().name;
  if (['start', 'setup-intro', 'restore', 'settings-backup'].includes(name)) render();
  const d = store.data();
  if (d && d.backup.on) sync().then((r) => { if (r && r.changed && ['home', 'records', 'day'].includes(route().name)) render(); });
});
