// 말하기 짝꿍 – 화면과 흐름 (PRD v2.0)
// v2.0: 음성 인식 없이 '듣고 따라 말하기'를 반복하는 연습. 오늘의 낱말·문장 → 분야별 추가 연습 → 지난 연습 다시 하기.
import { CONFIG } from './config.js';
import { h, s, icon, button, toast, clear } from './ui.js';
import * as speech from './speech.js';
import * as sync from './sync.js';
import * as store from './store.js';
import { ApiError } from './api.js';
import { buildCatalog, todaySet, guessType, CUSTOM_ID } from './curriculum.js';
import { randomId, normalizeRecoveryCode, formatRecoveryCode, RECOVERY_LENGTH, hashPin, b64u, randomBytes } from './crypto.js';
import { FONT_SIZES, getFontScale, applyFontScale, fontSizeLabel, fitWord } from './font-size.js';

// 저장된 글씨 크기를 첫 화면 전에 적용
applyFontScale(getFontScale(), { save: false });

const $app = document.getElementById('app');

const state = {
  env: null,
  identity: null,
  settings: { ...sync.DEFAULT_SETTINGS },
  customWords: [],
  sessions: [],
  catalog: buildCatalog(null),
  guide: '',
  onboarding: { metricsConsent: false },
  installPrompt: null,  // Android 홈 화면 추가
  fitCurrent: null,     // 연습 낱말 크기 맞추기 (글씨 크기·화면 크기 변경 시)
  run: null,            // 진행 중인 연습 (그만두거나 끝나면 기록으로 저장)
};

window.addEventListener('fontscalechange', () => state.fitCurrent?.());
window.addEventListener('resize', () => state.fitCurrent?.());
document.fonts?.ready.then(() => state.fitCurrent?.());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LABEL = { word: '낱말', sentence: '문장' };
const REST_AFTER_MS = 15 * 60 * 1000; // 15분 연속 연습하면 쉬기 권유 (PRD F-06)

// ───────────── 공통 화면 틀 ─────────────

/** 기본 빠르기: 0.8~1.0 (v2.1부터. 더 느리면 음성 엔진이 소리를 늘어뜨려 발음이 뭉개짐) */
function baseRate() {
  const r = Number(state.settings.rate) || 1;
  return Math.min(1, Math.max(0.8, r));
}

function speakGuide() {
  return speech.speak(state.guide, { voiceName: state.settings.voiceName, rate: baseRate() });
}

function speakWord(text, rate = baseRate()) {
  return speech.speak(text, { voiceName: state.settings.voiceName, rate });
}

/** 천천히 듣기 빠르기: 설정한 빠르기의 70% (최소 0.5) */
function slowRate() {
  // 0.6보다 느리면 음성 엔진이 소리를 늘어뜨려 발음이 뭉개지는 경우가 많아 0.6에서 멈춤
  return Math.max(0.6, Math.round(baseRate() * 0.75 * 100) / 100);
}

// ── 전체화면 (PRD v2.0: 휴대폰에서 동작하지 않던 문제 수정) ──

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function fullscreenApi() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? !!req;
  return req && enabled !== false ? req : null;
}

/** 홈 화면 앱으로 열었으면 이미 주소창이 없으므로 버튼을 숨김 */
function showFullscreenButton() {
  return !state.env?.standalone;
}

async function toggleFullscreen() {
  const d = document;
  try {
    if (isFullscreen()) {
      const exit = d.exitFullscreen || d.webkitExitFullscreen;
      await exit?.call(d);
      return;
    }
    const req = fullscreenApi();
    if (!req) { openFullscreenHelp(); return; }
    // 옛 webkit 방식은 Promise를 돌려주지 않으므로 await로 감쌈 (전에는 여기서 오류가 나 버튼이 먹통이었음)
    await req.call(d.documentElement, { navigationUI: 'hide' });
    // 일부 휴대폰 브라우저는 오류 없이 무시함 → 잠시 뒤 확인해서 안내
    setTimeout(() => { if (!isFullscreen()) openFullscreenHelp(); }, 700);
  } catch {
    openFullscreenHelp();
  }
}

function updateFullscreenButtons() {
  const label = isFullscreen() ? '전체화면 끝' : '전체화면';
  document.querySelectorAll('.fs-btn span').forEach((sp) => { sp.textContent = label; });
}
document.addEventListener('fullscreenchange', updateFullscreenButtons);
document.addEventListener('webkitfullscreenchange', updateFullscreenButtons);

/** 전체화면을 쓸 수 없을 때: 홈 화면에 추가하면 주소창 없이 열린다고 안내 */
function openFullscreenHelp() {
  const env = state.env;
  const steps = env.isIOS
    ? ['Safari 아래쪽(아이패드는 위쪽)의 공유 버튼(네모에 위쪽 화살표)을 눌러요.', '"홈 화면에 추가"를 눌러요.', '오른쪽 위 "추가"를 눌러요.', '홈 화면의 말하기 짝꿍 아이콘으로 열면 주소창 없이 화면 전체로 보여요.']
    : ['브라우저 메뉴(⋮ 또는 ≡)를 눌러요.', '"홈 화면에 추가" 또는 "앱 설치"를 눌러요.', '홈 화면의 말하기 짝꿍 아이콘으로 열면 주소창 없이 화면 전체로 보여요.'];
  const text = env.isIOS
    ? '아이폰·아이패드 Safari는 전체화면 버튼을 지원하지 않아요. 대신 홈 화면에 추가하면 앱처럼 화면 전체로 쓸 수 있어요.'
    : '이 브라우저에서는 전체화면이 되지 않아요. 홈 화면에 추가하면 앱처럼 화면 전체로 쓸 수 있어요.';
  const extra = !env.isIOS && state.installPrompt
    ? button('지금 홈 화면에 추가', async () => {
      state.installPrompt.prompt();
      try { await state.installPrompt.userChoice; } catch { /* 무시 */ }
      state.installPrompt = null;
      close();
    })
    : null;
  const { close } = openSheet('전체화면으로 보기', [
    h('p', { text }),
    h('ol', { class: 'steps' }, steps.map((t) => h('li', { text: t }))),
    extra,
  ]);
  speech.speak(text, { voiceName: state.settings.voiceName, rate: baseRate() });
}

/** 아래에서 올라오는 창 (화면을 다시 그리지 않으므로 연습 중에도 안전) */
function openSheet(titleText, children, onClose) {
  document.querySelector('.overlay')?.remove();
  const opener = document.activeElement;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    opener?.focus?.({ preventScroll: true });
    onClose?.();
  };
  const title = h('h2', { tabindex: '-1', id: 'sheet-title', text: titleText });
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
      title, children, button('닫기', () => close())));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  title.focus();
  return { close };
}

/**
 * 한 화면 = 위쪽 막대(안내 듣기·글씨 크기·전체화면·추가 버튼) + 본문 + 아래쪽 큰 버튼.
 */
function screen({ guide = '', title = '', body = [], actions = [], top = [], className = '' }) {
  state.guide = guide || title;
  state.fitCurrent = null;
  speech.stopSpeaking();
  document.querySelector('.overlay')?.remove();
  clear($app);
  const topbar = h('div', { class: 'topbar' },
    guide ? button('안내 듣기', speakGuide, { kind: 'tool', iconName: 'info' }) : h('span'),
    h('div', { class: 'topbar-right' },
      button('글씨 크기', () => openFontSizePanel(), { kind: 'tool', iconName: 'text' }),
      top,
      showFullscreenButton() ? button(isFullscreen() ? '전체화면 끝' : '전체화면', toggleFullscreen, { kind: 'tool fs-btn', iconName: 'expand' }) : null));
  const heading = title ? h('h1', { tabindex: '-1', text: title }) : null;
  const main = h('main', { class: `screen ${className}` }, heading, body);
  const footer = actions.length ? h('div', { class: 'actions' }, actions) : null;
  $app.append(topbar, main, footer || '');
  (heading || main).focus?.({ preventScroll: true });
  window.scrollTo(0, 0);
  return main;
}

function card(...children) { return h('div', { class: 'card' }, children); }
function para(text, cls = '') { return h('p', { class: cls, text }); }

function loading(text) {
  return screen({ guide: text, title: text, body: [h('div', { class: 'spinner', 'aria-hidden': 'true' })] });
}

function errorText(e) {
  const code = e instanceof ApiError ? e.code : 'unknown';
  if (code === 'network') return '인터넷 연결을 확인해 주세요.';
  if (code === 'try_later') return '사람이 많아요. 잠시 후 다시 해 주세요.';
  return '요청을 처리하지 못했어요. 잠시 후 다시 해 주세요.';
}

/** 예/아니오 묻기 */
function ask({ title, text, yes, no, danger = false }) {
  return new Promise((resolve) => {
    screen({
      guide: `${title} ${text || ''}`,
      title,
      body: text ? [para(text, 'lead')] : [],
      actions: [
        button(yes, () => resolve(true), { kind: danger ? 'danger' : 'primary' }),
        button(no, () => resolve(false), { kind: 'secondary' }),
      ],
    });
  });
}

// ───────────── 글씨 크기 (PRD v1.4) ─────────────

function sizeChoices(onPick) {
  const wrap = h('div', { class: 'size-options', role: 'radiogroup', 'aria-label': '글씨 크기' });
  const render = () => {
    clear(wrap);
    const cur = getFontScale();
    FONT_SIZES.forEach((opt) => {
      const selected = opt.value === cur;
      wrap.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(selected), class: `choice${selected ? ' selected' : ''}`,
        onclick: () => { applyFontScale(opt.value); render(); onPick?.(opt.value); },
      },
      h('span', {}, selected ? icon('check') : null, ` ${opt.label}`),
      h('span', { class: 'aa', style: { fontSize: `${opt.value * 1.2}rem` }, text: '가나다', 'aria-hidden': 'true' })));
    });
  };
  render();
  return wrap;
}

function sizeSample() {
  return h('div', { class: 'size-sample' }, h('p', { text: '말하기 연습을 시작해요.' }), h('p', { class: 'small', text: '이 글씨가 편하게 읽히는 크기를 골라 주세요.' }));
}

/** 어느 화면에서나 여는 글씨 크기 창. 화면을 다시 그리지 않으므로 연습 중에도 안전합니다. */
function openFontSizePanel(onClose) {
  if (document.querySelector('.overlay')) return;
  const opener = document.activeElement;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    opener?.focus?.({ preventScroll: true });
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const title = h('h2', { tabindex: '-1', id: 'size-title', text: '글씨 크기' });
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'size-title' },
      title, sizeSample(), sizeChoices(), button('닫기', close)));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  title.focus();
  speech.speak('읽기 편한 글씨 크기를 골라 주세요.', { voiceName: state.settings.voiceName, rate: baseRate() });
}

/** 처음 설정의 첫 단계: 동의 화면을 읽기 전에 글씨 크기부터 고름 */
function screenFontSize(next) {
  screen({
    guide: '읽기 편한 글씨 크기를 골라 주세요. 누르면 바로 바뀌어요. 나중에 위쪽 글씨 크기 버튼으로 언제든 바꿀 수 있어요.',
    title: '글씨 크기 고르기',
    body: [para('누르면 바로 바뀌어요. 나중에 위쪽 "글씨 크기" 버튼으로 언제든 바꿀 수 있어요.', 'lead'), sizeChoices()],
    actions: [button('다음', next), button('뒤로', screenWelcome, { kind: 'secondary' })],
  });
}

// ───────────── 시작 ─────────────

async function boot() {
  state.env = speech.detectEnv();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installPrompt = e; });
  window.addEventListener('online', () => backgroundSync());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { speech.stopSpeaking(); saveRun(); }
  });
  window.addEventListener('pagehide', () => saveRun());

  if (!speech.isSupported(state.env)) return screenUnsupported();

  await reloadLocal();
  sync.fetchCurriculum().then((items) => { state.catalog = buildCatalog(items); });

  const pin = await store.kvGet('pin');
  if (pin) return screenPin(route);
  return route();
}

async function reloadLocal() {
  state.identity = await sync.loadIdentity();
  state.settings = await sync.loadSettings();
  state.customWords = await sync.loadCustomWords();
  state.sessions = await sync.loadSessions();
  const cached = await store.kvGet('curriculum');
  if (cached) state.catalog = buildCatalog(cached);
}

async function route() {
  if (!state.identity) return screenWelcome();
  backgroundSync();
  return screenHome();
}

async function backgroundSync() {
  if (!state.identity) return;
  const r = await sync.backgroundSync(state.identity);
  if (r.ok) {
    await reloadLocal();
    if (r.failed) toast('일부 기록을 불러오지 못했어요.');
  } else if (r.error === 'request_failed') {
    // 인증만 따로 확인해서, 이 기기의 연결이 해제된 경우에만 안내
    if ((await sync.checkAuth(state.identity)) === 'revoked') screenDisconnected();
  }
}

// ───────────── 지원 안 함 ─────────────

function screenUnsupported() {
  const env = state.env;
  const title = '이 화면에서는 연습이 어려워요';
  let text = 'Chrome 또는 Safari로 열어 주세요.';
  const steps = [];
  if (env.inApp) {
    text = '카카오톡 같은 앱 안의 화면에서는 기록이 지워지거나 소리가 나지 않을 수 있어요. Chrome 또는 Safari로 열어 주세요.';
    steps.push('화면 오른쪽 위나 아래의 메뉴(⋮ 또는 공유) 버튼을 눌러요.', '"다른 브라우저로 열기" 또는 "Safari로 열기"를 눌러요.');
  } else if (!env.secure) {
    text = '보안 연결(https) 주소로 열어 주세요.';
  } else if (!env.tts) {
    text = '이 브라우저는 소리 내어 읽어 주는 기능이 없어요. Chrome(안드로이드·PC) 또는 Safari(아이폰·아이패드)로 열어 주세요.';
  }
  screen({
    guide: `${title}. ${text}`,
    title,
    body: [
      para(text, 'lead'),
      steps.length ? h('ol', { class: 'steps' }, steps.map((t) => h('li', { text: t }))) : null,
    ],
    actions: [button('주소 복사하기', async () => {
      try { await navigator.clipboard.writeText(location.href); toast('주소를 복사했어요.'); } catch { toast(location.href); }
    })],
  });
}

// ───────────── 처음 화면 ─────────────

function disclaimer() {
  return h('p', { class: 'note', text: '말하기 짝꿍은 연습을 돕는 도구이며, 언어재활사의 치료를 대신하지 않아요. 연습 방법은 담당 선생님과 상의해 주세요.' });
}

function screenWelcome() {
  screen({
    guide: '말하기 짝꿍이에요. 듣고 따라 말하며 매일 조금씩 연습해요. 처음이면 처음이에요 버튼을, 복구 코드가 있으면 아래 버튼을 눌러 주세요.',
    title: '말하기 짝꿍',
    body: [
      para('듣고 따라 말하며, 매일 조금씩 연습해요.', 'lead'),
      disclaimer(),
      h('a', { href: './privacy.html', class: 'link', text: '개인정보 처리방침' }),
    ],
    actions: [
      button('처음이에요', () => screenFontSize(screenConsent)),
      button('복구 코드가 있어요', screenRecoverInput, { kind: 'secondary' }),
    ],
  });
}

function screenConsent() {
  const req = h('input', { type: 'checkbox', id: 'c-req' });
  const opt = h('input', { type: 'checkbox', id: 'c-opt' });
  const next = button('동의하고 다음', () => {
    state.onboarding.metricsConsent = opt.checked;
    screenVoice();
  }, { disabled: true });
  req.addEventListener('change', () => { next.disabled = !req.checked; });

  const points = [
    ['연습을 돕는 도구예요', '치료를 대신하지 않아요.'],
    ['기록은 나만 볼 수 있어요', '연습 기록은 이 기기에서 잠가서(암호화) 보관해요. 운영자도 내용을 볼 수 없어요.'],
    ['마이크를 쓰지 않아요', '목소리를 녹음하거나 보내지 않아요. 들려주는 소리만 나와요.'],
    ['복구 코드를 꼭 보관해요', '복구 코드를 잃고 이 기기 기록도 지워지면, 누구도 기록을 되찾을 수 없어요.'],
  ];
  screen({
    guide: points.map((p) => p.join('. ')).join('. ') + '. 동의하면 아래 첫 번째 칸을 눌러 주세요.',
    title: '시작하기 전에',
    body: [
      h('ul', { class: 'points' }, points.map(([t, d]) => h('li', {}, h('strong', { text: t }), h('span', { text: d })))),
      h('label', { class: 'check', for: 'c-opt' }, opt, h('span', {}, h('b', { text: '[선택] ' }), '서비스 개선을 위해 날짜별 연습 횟수만 보내는 것에 동의해요. 낱말과 문장은 보내지 않아요.')),
      h('p', { class: 'small' }, '만 14세 이상 성인을 위한 서비스예요. ', h('a', { href: './privacy.html', class: 'link', text: '개인정보 처리방침 보기' })),
    ],
    actions: [
      h('label', { class: 'check', for: 'c-req' }, req, h('span', {}, h('b', { text: '[필수] ' }), '연습 기록(건강 관련 정보)을 처리하는 것에 동의해요.')),
      h('div', { class: 'row' }, button('뒤로', () => screenFontSize(screenConsent), { kind: 'secondary' }), next),
    ],
  });
}

/** 더 좋은 한국어 목소리를 기기에 설치하는 방법 (기기마다 다름) */
function voiceInstallSteps() {
  const env = state.env;
  if (env.isIOS) {
    return ['아이폰 "설정" → "손쉬운 사용" → "읽기 및 말하기" → "음성"을 눌러요.', '"한국어"를 누르고 목소리를 골라 "향상된 음질" 또는 "프리미엄"을 내려받아요.', '이 화면으로 돌아와 "목소리 다시 찾기"를 눌러요.'];
  }
  if (env.isAndroid) {
    return ['휴대폰 "설정"에서 "텍스트 음성 변환"(TTS)을 검색해 들어가요.', '기본 엔진을 "Google 음성 인식 및 합성"으로 고르고, 옆의 톱니(설정) → "음성 데이터 설치" → "한국어"를 눌러요.', '마음에 드는 목소리를 골라 내려받은 뒤, 이 화면으로 돌아와 "목소리 다시 찾기"를 눌러요.'];
  }
  return ['컴퓨터 설정에서 "음성"(Windows: 시간 및 언어 → 음성)을 열어요.', '"음성 추가"에서 한국어를 설치해요.', '브라우저를 다시 열고 "목소리 다시 찾기"를 눌러요.'];
}

async function screenVoice({ fromSettings = false, refresh = false } = {}) {
  if (refresh) loading('목소리를 찾고 있어요');
  const voices = await speech.getKoreanVoices({ refresh });
  const settings = state.settings;
  if (voices.length && !voices.some((v) => v.name === settings.voiceName)) settings.voiceName = voices[0].name;

  const done = async () => {
    await sync.saveSettings(state.identity, settings);
    if (fromSettings) { flushQuiet(); return screenSettings(); }
    return screenCreateKeys();
  };
  const SAMPLE = '사과, 할머니, 물 좀 주세요';

  const voiceList = h('div', { class: 'choices col', role: 'radiogroup', 'aria-label': '목소리' });
  const renderVoices = () => {
    clear(voiceList);
    voices.forEach((v, i) => {
      const selected = v.name === settings.voiceName;
      voiceList.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(selected), class: `choice${selected ? ' selected' : ''}`,
        onclick: async () => { settings.voiceName = v.name; renderVoices(); await speakWord(SAMPLE); },
      }, h('span', {}, selected ? icon('check') : null, ` 목소리 ${i + 1}`), h('small', { text: speech.voiceLabel(v) })));
    });
  };
  renderVoices();

  const rates = [[1.0, '보통'], [0.9, '조금 천천히'], [0.8, '천천히']];
  const rateList = h('div', { class: 'choices' });
  const renderRates = () => {
    clear(rateList);
    rates.forEach(([r, label]) => {
      const selected = Math.abs(baseRate() - r) < 0.001;
      rateList.append(h('button', {
        type: 'button', class: `choice${selected ? ' selected' : ''}`, 'aria-pressed': String(selected),
        onclick: async () => { settings.rate = r; renderRates(); await speakWord(SAMPLE, r); },
      }, selected ? icon('check') : null, h('span', { text: label })));
    });
  };
  renderRates();

  const tips = h('details', { class: 'tips' },
    h('summary', { text: voices.length ? '발음이 어색하면: 더 좋은 목소리 설치하기' : '한국어 목소리 설치하기' }),
    h('ol', { class: 'steps' }, voiceInstallSteps().map((t) => h('li', { text: t }))));
  if (!voices.length) tips.open = true;

  screen({
    guide: voices.length
      ? '듣기 편한 목소리와 빠르기를 골라 주세요. 버튼을 누르면 미리 들을 수 있어요. 발음이 어색하면 아래 안내대로 더 좋은 목소리를 설치해 보세요.'
      : '이 기기에서 한국어 목소리를 찾지 못했어요. 아래 안내대로 한국어 목소리를 설치해 주세요.',
    title: '목소리 고르기',
    body: [
      h('h2', { text: '목소리' }),
      voices.length
        ? [para(voices.length === 1 ? '이 기기에서 쓸 수 있는 한국어 목소리는 1개예요.' : `한국어 목소리 ${voices.length}개 중에서 골라요. 누르면 들어 볼 수 있어요.`, 'small'), voiceList]
        : para('이 기기에서 한국어 목소리를 찾지 못했어요.', 'warn'),
      h('div', { class: 'row' },
        button('들어 보기', () => speakWord(SAMPLE), { kind: 'secondary', iconName: 'speaker', disabled: !voices.length }),
        button('목소리 다시 찾기', () => screenVoice({ fromSettings, refresh: true }), { kind: 'secondary', iconName: 'replay' })),
      tips,
      h('h2', { text: '빠르기' }), rateList,
      para("연습할 때 '천천히 듣기'를 누르면 이보다 조금 더 천천히 들려줘요.", 'small'),
    ],
    actions: [button(fromSettings ? '저장' : '다음', done)],
  });
}

async function screenCreateKeys() {
  loading('준비하고 있어요');
  try {
    const { identity, recoveryCode } = await sync.createIdentity({ metricsConsent: state.onboarding.metricsConsent });
    state.identity = identity;
    state.settings.metricsConsent = state.onboarding.metricsConsent;
    state.settings.consentVersion = CONFIG.CONSENT_VERSION;
    await sync.saveSettings(identity, state.settings);
    store.requestPersist();
    flushQuiet();
    screenRecoveryCode(recoveryCode, () => screenInstall(screenHome));
  } catch (e) {
    screen({
      guide: errorText(e),
      title: '시작하지 못했어요',
      body: [para(errorText(e), 'lead')],
      actions: [button('다시 시도', screenCreateKeys)],
    });
  }
}

// ───────────── 복구 코드 ─────────────

function qrSvg(text) {
  if (typeof globalThis.qrcode !== 'function') return null;
  const qr = globalThis.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 4; // 여백
  const size = n + q * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q},${r + q}h1v1h-1z`;
  return s('svg', { viewBox: `0 0 ${size} ${size}`, class: 'qr', role: 'img', 'aria-label': '복구 코드 QR' },
    s('rect', { width: size, height: size, fill: '#fff' }), s('path', { d, fill: '#000' }));
}

function screenRecoveryCode(code, next) {
  const groups = formatRecoveryCode(code).split('-');
  screen({
    guide: '복구 코드예요. 보호자 휴대폰으로 이 화면의 사진을 찍어 두세요. 이 코드를 잃고 기기 기록도 지워지면, 누구도 기록을 되찾을 수 없어요.',
    title: '복구 코드를 보관해 주세요',
    body: [
      para('보호자 휴대폰으로 이 화면 사진을 찍어 두세요. 다른 기기에서 이어서 연습할 때 필요해요.', 'lead'),
      h('div', { class: 'code', 'aria-label': `복구 코드 ${groups.join(' ')}` }, groups.map((g) => h('span', { text: g }))),
      qrSvg(code),
      h('p', { class: 'warn', text: '이 코드를 잃고 기기 기록도 지워지면, 운영자를 포함해 누구도 기록을 되찾을 수 없어요. 다른 사람에게 보여 주지 마세요.' }),
    ],
    actions: [button('사진 찍었어요', next)],
  });
}

function screenRecoverInput() {
  const boxes = [0, 1, 2, 3].map((i) => h('input', {
    type: 'text', inputmode: 'text', maxlength: '4', autocapitalize: 'characters', autocomplete: 'off',
    spellcheck: 'false', class: 'code-box', 'aria-label': `복구 코드 ${i + 1}번째 묶음`,
  }));
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      const raw = b.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (raw.length > 4) { // 붙여넣기: 나머지 칸에 나눠 넣기
        const all = raw.slice(0, RECOVERY_LENGTH - i * 4);
        for (let k = i; k < 4; k++) boxes[k].value = all.slice((k - i) * 4, (k - i + 1) * 4);
        boxes[Math.min(3, i + Math.ceil(all.length / 4) - 1)].focus();
        return;
      }
      b.value = raw;
      if (raw.length === 4 && i < 3) boxes[i + 1].focus();
    });
  });
  const msg = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
  const fill = (code) => { const c = code.replace(/[^0-9A-Z]/gi, '').toUpperCase(); boxes.forEach((b, k) => { b.value = c.slice(k * 4, k * 4 + 4); }); };

  const actions = [
    button('연결하기', async () => {
      const code = normalizeRecoveryCode(boxes.map((b) => b.value).join(''));
      if (!code) { msg.textContent = '코드가 맞지 않아요. 한 글자씩 다시 볼까요?'; return; }
      loading('기록을 불러오고 있어요');
      try {
        state.identity = await sync.recoverIdentity(code);
        await reloadLocal();
        toast('연결되었어요.');
        route();
      } catch (e) {
        screenRecoverInput();
        const m = document.querySelector('.feedback');
        if (m) m.textContent = e instanceof ApiError && e.code === 'request_failed' ? '코드가 맞지 않아요. 한 글자씩 다시 볼까요?' : errorText(e);
      }
    }),
  ];
  if ('BarcodeDetector' in globalThis) actions.push(button('QR 코드 찍기', () => screenScanQr(fill), { kind: 'secondary' }));
  actions.push(button('뒤로', screenWelcome, { kind: 'secondary' }));

  screen({
    guide: '복구 코드 열여섯 글자를 네 글자씩 넣어 주세요.',
    title: '복구 코드 넣기',
    body: [para('네 글자씩 나눠서 넣어 주세요.', 'lead'), h('div', { class: 'code-inputs' }, boxes), msg],
    actions,
  });
}

async function screenScanQr(fill) {
  const video = h('video', { playsinline: true, muted: true, class: 'scan' });
  let stream = null;
  let stop = false;
  const back = () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  screen({
    guide: '복구 코드 QR을 카메라에 비춰 주세요.',
    title: 'QR 코드 찍기',
    body: [video],
    actions: [button('그만하기', () => { back(); screenRecoverInput(); }, { kind: 'secondary' })],
  });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    await video.play();
    const det = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
    while (!stop) {
      const codes = await det.detect(video).catch(() => []);
      const hit = codes.map((c) => normalizeRecoveryCode(c.rawValue)).find(Boolean);
      if (hit) { back(); screenRecoverInput(); fill(hit); return; }
      await sleep(300);
    }
  } catch {
    back();
    screenRecoverInput();
    toast('카메라를 쓸 수 없어요. 글자로 넣어 주세요.');
  }
}

function screenDisconnected() {
  screen({
    guide: '이 기기는 연결이 해제되었어요. 복구 코드로 다시 연결해 주세요.',
    title: '이 기기는 연결이 해제되었어요',
    body: [para('복구 코드로 다시 연결해 주세요. 이 기기에 있는 연습 기록은 다시 연결한 뒤 함께 보관돼요.', 'lead')],
    actions: [
      button('복구 코드 넣기', async () => {
        await store.kvDel('identity');
        state.identity = null;
        screenRecoverInput();
      }),
      button('나중에', screenHome, { kind: 'secondary' }),
    ],
  });
}

// ───────────── 홈 화면 추가 ─────────────

function screenInstall(next = screenHome) {
  const env = state.env;
  const body = [];
  const actions = [];
  if (env.standalone) return next();
  if (env.isIOS) {
    body.push(
      para('홈 화면에 추가하면 주소창 없이 화면 전체로 보이고, 기록도 더 안전하게 보관돼요.', 'lead'),
      h('ol', { class: 'steps' },
        h('li', { text: 'Safari 아래쪽(아이패드는 위쪽)의 공유 버튼(네모에 위쪽 화살표)을 눌러요.' }),
        h('li', { text: '"홈 화면에 추가"를 눌러요.' }),
        h('li', { text: '오른쪽 위 "추가"를 눌러요.' }),
        h('li', { text: '다음부터는 홈 화면의 말하기 짝꿍 아이콘으로 열어요.' })));
  } else {
    body.push(para('홈 화면에 추가하면 앱처럼 바로 열리고 화면 전체로 보여요.', 'lead'));
    if (state.installPrompt) {
      actions.push(button('홈 화면에 추가', async () => {
        state.installPrompt.prompt();
        try { await state.installPrompt.userChoice; } catch { /* 무시 */ }
        state.installPrompt = null;
        next();
      }));
    } else {
      body.push(h('ol', { class: 'steps' },
        h('li', { text: '브라우저 메뉴(⋮ 또는 ≡)를 눌러요.' }),
        h('li', { text: '"홈 화면에 추가" 또는 "앱 설치"를 눌러요.' })));
    }
  }
  actions.push(button(actions.length ? '건너뛰기' : '다음', () => next(), { kind: actions.length ? 'secondary' : 'primary' }));
  screen({ guide: body.map((n) => n.textContent).join(' '), title: '홈 화면에 추가하기', body, actions });
}

// ───────────── 연습 (PRD v2.0 F-04, F-05) ─────────────

/** 띄어쓰기 단위로 묶어(.wg) 낱말 중간에서 줄이 바뀌지 않게 함 */
function wordEl(text) {
  const el = h('div', { class: 'word', lang: 'ko' });
  let group = null;
  Array.from(text).forEach((c) => {
    if (c === ' ') { group = null; el.append(' '); return; }
    if (!group) { group = h('span', { class: 'wg' }); el.append(group); }
    group.append(c);
  });
  return el;
}

function logOf(run, it) {
  if (!run.log.has(it.text)) run.log.set(it.text, { text: it.text, type: it.type, category: it.category || '', plays: 0, slow: 0 });
  return run.log.get(it.text);
}

/**
 * 연습 시작.
 * @param {{source:'today'|'category'|'review', type:'word'|'sentence'|'mixed', title:string, items:Array, start?:number, back?:Function}} opts
 */
function startRun({ source, type, title, items, start = 0, back }) {
  if (!items.length) return;
  if (state.run) saveRun({ keep: false });
  state.run = { id: randomId(), source, type, title, items, back, startedAt: Date.now(), log: new Map(), completed: false, restNudged: false, index: start };
  showRunItem(start);
}

/**
 * 연습 기록 저장. 같은 id로 덮어쓰므로 여러 번 불러도 기록은 하나.
 * keep: true면 연습을 계속함(앱이 잠깐 가려질 때 중간 저장).
 */
async function saveRun({ keep = true, completed = false } = {}) {
  const run = state.run;
  if (!run || !state.identity) return null;
  if (!keep) state.run = null;
  if (completed) run.completed = true;
  // 화면에 나온 낱말·문장은 모두 기록 (빨리 넘겨서 못 들은 것도 '연습한 것'으로 다시 하기에 나오도록)
  const items = [...run.log.values()];
  if (!items.length) return null;
  const session = {
    id: run.id, startedAt: run.startedAt, endedAt: Date.now(), source: run.source, type: run.type,
    title: run.title, total: run.items.length, completed: run.completed, items: items.map((x) => ({ ...x })),
  };
  state.sessions = state.sessions.filter((x) => x.id !== session.id).concat(session);
  await sync.saveSession(state.identity, session);
  flushQuiet();
  return session;
}

function showRunItem(i) {
  const run = state.run;
  if (!run) return screenHome();
  const it = run.items[i];
  const rec = logOf(run, it);
  run.index = i;
  const word = wordEl(it.text);
  const count = h('p', { class: 'plays', 'aria-live': 'polite' });
  const upd = () => { const n = rec.plays + rec.slow; count.textContent = n ? `들은 횟수 ${n}번` : ' '; };
  const play = async (slow) => {
    if (state.run !== run) return;
    if (slow) rec.slow++; else rec.plays++;
    upd();
    word.classList.add('speaking');
    await speakWord(it.text, slow ? slowRate() : baseRate());
    word.classList.remove('speaking');
    if (!run.restNudged && Date.now() - run.startedAt > REST_AFTER_MS) {
      run.restNudged = true;
      toast('15분 넘게 연습했어요. 잠깐 쉬었다 해도 좋아요.');
    }
  };
  const last = i === run.items.length - 1;
  screen({
    guide: `${it.text}. 듣고 소리 내어 따라 말해 보세요. 다시 듣기를 누르면 또 들을 수 있어요.`,
    body: [
      h('p', { class: 'progress', text: `${i + 1} / ${run.items.length} · ${run.title}` }),
      h('div', { class: 'stage-word' }, word),
      count,
      h('p', { class: 'small center', text: '듣고 소리 내어 따라 말해 보세요.' }),
    ],
    top: [button('그만하기', () => endRun(false), { kind: 'tool', iconName: 'stop' })],
    className: 'practice',
    actions: [
      h('div', { class: 'row' },
        button('다시 듣기', () => play(false), { kind: 'primary', iconName: 'replay' }),
        button('천천히 듣기', () => play(true), { kind: 'primary', iconName: 'slow' })),
      h('div', { class: 'row' },
        button('이전', () => showRunItem(i - 1), { kind: 'secondary', iconName: 'prev', disabled: i === 0 }),
        button(last ? '끝' : '다음', () => (last ? endRun(true) : showRunItem(i + 1)), { kind: 'secondary', iconName: last ? 'check' : 'next', iconRight: true })),
    ],
  });
  state.fitCurrent = () => fitWord(word);
  requestAnimationFrame(() => state.fitCurrent?.());
  upd();
  // 화면이 열리면 한 번 들려줌
  sleep(250).then(() => { if (state.run === run && run.index === i && !document.hidden) play(false); });
}

async function endRun(completed) {
  const run = state.run;
  if (!run) return screenHome();
  const session = await saveRun({ keep: false, completed });
  if (!completed) return run.back ? run.back() : screenHome();
  return screenRunEnd(run, session);
}

function screenRunEnd(run, session) {
  const n = session ? session.items.length : 0;
  const plays = session ? session.items.reduce((a, x) => a + x.plays + x.slow, 0) : 0;
  const what = run.type === 'mixed' ? '낱말·문장' : LABEL[run.type];
  const body = [para(`${what} ${n}개를 연습했어요. 모두 ${plays}번 들었어요.`, 'lead')];
  const actions = [];
  if (run.source === 'today') {
    const other = run.type === 'word' ? 'sentence' : 'word';
    body.push(para('더 연습하고 싶으면 분야를 골라 보세요.'));
    if (!todayDone(other)) actions.push(button(`오늘의 ${LABEL[other]} 하기`, () => startToday(other)));
    actions.push(h('div', { class: 'row' },
      button('분야별 낱말', () => screenCategories('word'), { kind: 'secondary' }),
      button('분야별 문장', () => screenCategories('sentence'), { kind: 'secondary' })));
  } else {
    actions.push(button('처음부터 다시', () => startRun({ ...run, start: 0 })));
    if (run.back) actions.push(button('목록으로', () => run.back(), { kind: 'secondary' }));
  }
  actions.push(button('처음 화면으로', screenHome, { kind: 'secondary' }));
  screen({ guide: `다 했어요! ${body.map((x) => x.textContent).join(' ')}`, title: '다 했어요!', body, actions });
}

// ───────────── 오늘의 낱말·문장 (PRD v2.0 F-03) ─────────────

function todayItems(type) {
  return todaySet(type, sync.dateKey(), state.catalog, type === 'word' ? state.customWords : []);
}

function todayDone(type) {
  const today = sync.dateKey();
  return state.sessions.some((x) => x.source === 'today' && x.type === type && x.completed && sync.dateKey(x.startedAt) === today);
}

function startToday(type) {
  startRun({ source: 'today', type, title: `오늘의 ${LABEL[type]}`, items: todayItems(type), back: screenHome });
}

// ───────────── 홈 ─────────────

function practiceDays() {
  return new Set(state.sessions.map((x) => sync.dateKey(x.startedAt)));
}

function itemType(it, session) {
  return it.type || (session.type === 'word' || session.type === 'sentence' ? session.type : guessType(it.text));
}

/** 그날 연습한 낱말·문장 (처음 연습한 순서, 중복 없이) */
function dayItems(key) {
  const map = new Map();
  state.sessions
    .filter((x) => sync.dateKey(x.startedAt) === key)
    .sort((a, b) => a.startedAt - b.startedAt)
    .forEach((x) => x.items.forEach((it) => {
      if (!map.has(it.text)) map.set(it.text, { text: it.text, type: itemType(it, x), category: it.category || '' });
    }));
  return [...map.values()];
}

function dayLabel(key) {
  const today = sync.dateKey();
  if (key === today) return '오늘';
  if (key === sync.dateKey(Date.now() - 86400000)) return '어제';
  if (key === sync.dateKey(Date.now() - 2 * 86400000)) return '그제';
  const d = new Date(`${key}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
}

function todayCard(type) {
  const done = todayDone(type);
  const n = todayItems(type).length;
  return h('button', { type: 'button', class: `today${done ? ' done' : ''}`, onclick: () => startToday(type) },
    h('strong', { text: `오늘의 ${LABEL[type]}` }),
    h('span', { text: done ? `✓ 다 했어요 · 다시 하기` : `${n}개` }));
}

async function screenHome() {
  const days = practiceDays().size;
  const yKey = sync.dateKey(Date.now() - 86400000);
  const yItems = dayItems(yKey);
  const outbox = await store.count('outbox');
  const notes = [];
  if (outbox > 0 && !navigator.onLine) notes.push(para('인터넷에 연결되면 기록을 안전하게 보관할게요.', 'note'));
  if (outbox > CONFIG.OUTBOX_MAX) notes.push(para('보내지 못한 기록이 많아요. 인터넷에 연결해 주세요.', 'warn'));
  if (!state.env.standalone && (state.env.isIOS || state.env.isAndroid)) {
    notes.push(h('p', { class: 'note' }, '홈 화면에 추가하면 앱처럼 화면 전체로 쓸 수 있어요. ', h('button', { type: 'button', class: 'linkbtn', text: '방법 보기', onclick: () => screenInstall(screenHome) })));
  }

  const past = [];
  if (yItems.length) past.push(button(`어제 연습 다시 하기 (${yItems.length}개)`, () => screenReviewDay(yKey), { kind: 'secondary', iconName: 'replay' }));
  if (days > (practiceDays().has(sync.dateKey()) ? 1 : 0)) past.push(button('지난 연습 모두 보기', screenReviewDays, { kind: 'secondary' }));

  screen({
    guide: `${days ? `지금까지 ${days}일 연습했어요. ` : ''}오늘의 낱말이나 오늘의 문장을 눌러 시작해요. 다 하고 나면 분야를 골라 더 연습할 수 있어요.`,
    title: days ? `지금까지 ${days}일 연습했어요` : '반가워요',
    body: [
      h('h2', { text: '오늘의 연습' }),
      h('div', { class: 'today-row' }, todayCard('word'), todayCard('sentence')),
      h('h2', { text: '더 연습하기' }),
      h('div', { class: 'row' },
        button('분야별 낱말', () => screenCategories('word'), { kind: 'secondary' }),
        button('분야별 문장', () => screenCategories('sentence'), { kind: 'secondary' })),
      past.length ? [h('h2', { text: '지난 연습' }), h('div', { class: 'stack' }, past)] : null,
      notes,
    ],
    actions: [h('div', { class: 'row' },
      button('나의 기록', screenRecords, { kind: 'secondary' }),
      button('설정', screenSettings, { kind: 'secondary' }))],
  });
}

// ───────────── 분야별 연습 ─────────────

function categoriesOf(type) {
  const list = [];
  if (type === 'word') list.push({ id: CUSTOM_ID, name: '나만의 낱말', items: state.customWords, custom: true });
  return list.concat(state.catalog[type]);
}

function screenCategories(type) {
  screen({
    guide: `연습할 ${LABEL[type]} 분야를 골라 주세요.`,
    title: type === 'word' ? '낱말 분야 고르기' : '문장 상황 고르기',
    body: [h('div', { class: 'cat-grid' }, categoriesOf(type).map((c) => h('button', {
      type: 'button', class: `cat${c.custom ? ' custom' : ''}`, onclick: () => screenItemList(type, c.id),
    },
    h('strong', { text: c.name }),
    h('small', { text: c.custom && !c.items.length ? '가족 이름 등을 직접 넣어요' : `${c.items.length}개 · ${c.items.slice(0, 3).join(', ')}` }))))],
    actions: [button('처음 화면으로', screenHome, { kind: 'secondary' })],
  });
}

function screenItemList(type, catId) {
  const cat = categoriesOf(type).find((c) => c.id === catId);
  if (!cat) return screenCategories(type);
  const items = cat.items.map((t) => ({ text: t, type, category: cat.name }));
  const back = () => screenItemList(type, catId);
  const start = (i) => startRun({ source: 'category', type, title: cat.name, items, start: i, back });
  screen({
    guide: `${cat.name}. ${LABEL[type]}을 누르면 그것부터 연습해요. 처음부터 연습하기를 누르면 차례대로 연습해요.`,
    title: cat.name,
    body: [
      para(`${LABEL[type]}을 누르면 그것부터 연습해요.`, 'small'),
      cat.custom ? button('나만의 낱말 넣기·빼기', () => screenCustomWords(back), { kind: 'secondary' }) : null,
      items.length
        ? h('div', { class: `item-grid${type === 'sentence' ? ' sentences' : ''}` }, items.map((it, i) => h('button', { type: 'button', class: 'item', onclick: () => start(i), text: it.text })))
        : para('아직 넣은 낱말이 없어요. 위 버튼으로 가족 이름, 자주 가는 곳 등을 넣어 보세요.', 'note'),
    ],
    actions: [
      button('처음부터 연습하기', () => start(0), { disabled: !items.length, iconName: 'replay' }),
      button('분야 다시 고르기', () => screenCategories(type), { kind: 'secondary' }),
    ],
  });
}

// ───────────── 지난 연습 다시 하기 (PRD v2.0 F-03) ─────────────

function screenReviewDays() {
  const keys = [...practiceDays()].sort().reverse().slice(0, 90);
  screen({
    guide: '다시 연습하고 싶은 날을 골라 주세요.',
    title: '지난 연습',
    body: [keys.length
      ? h('div', { class: 'stack' }, keys.map((k) => {
        const its = dayItems(k);
        const w = its.filter((x) => x.type === 'word').length;
        const s2 = its.filter((x) => x.type === 'sentence').length;
        return h('button', { type: 'button', class: 'cat', onclick: () => screenReviewDay(k) },
          h('strong', { text: dayLabel(k) }),
          h('small', { text: [w ? `낱말 ${w}개` : '', s2 ? `문장 ${s2}개` : ''].filter(Boolean).join(' · ') }));
      }))
      : para('아직 연습한 날이 없어요.', 'note')],
    actions: [button('처음 화면으로', screenHome, { kind: 'secondary' })],
  });
}

function screenReviewDay(key) {
  const its = dayItems(key);
  const words = its.filter((x) => x.type === 'word');
  const sentences = its.filter((x) => x.type === 'sentence');
  const label = dayLabel(key);
  const back = () => screenReviewDay(key);
  const run = (type, list) => startRun({ source: 'review', type, title: `${label} ${type === 'mixed' ? '연습' : LABEL[type]}`, items: list, back });
  const actions = [];
  if (words.length) actions.push(button(`${label} 낱말 다시 하기 (${words.length}개)`, () => run('word', words), { iconName: 'replay' }));
  if (sentences.length) actions.push(button(`${label} 문장 다시 하기 (${sentences.length}개)`, () => run('sentence', sentences), { iconName: 'replay' }));
  if (words.length && sentences.length) actions.push(button('모두 다시 하기', () => run('mixed', its), { kind: 'secondary' }));
  actions.push(button('다른 날 고르기', screenReviewDays, { kind: 'secondary' }));
  screen({
    guide: `${label} 연습한 것을 다시 해 볼까요?`,
    title: `${label} 연습`,
    body: [
      words.length ? [h('h2', { text: '낱말' }), h('div', { class: 'chips' }, words.map((x) => h('span', { class: 'chip', text: x.text })))] : null,
      sentences.length ? [h('h2', { text: '문장' }), h('div', { class: 'chips' }, sentences.map((x) => h('span', { class: 'chip', text: x.text })))] : null,
      its.length ? null : para('이날 연습한 기록이 없어요.', 'note'),
    ],
    actions,
  });
}

// ───────────── 나의 기록 (PRD v2.0 F-07) ─────────────

function playsByDay(days) {
  const sums = new Map();
  state.sessions.forEach((x) => {
    const k = sync.dateKey(x.startedAt);
    sums.set(k, (sums.get(k) || 0) + x.items.reduce((a, it) => a + sync.playsOf(it), 0));
  });
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = sync.dateKey(Date.now() - i * 86400000);
    out.push({ k, v: sums.get(k) || 0 });
  }
  return out;
}

function barChart(points) {
  const W = 360; const H = 190; const L = 30; const R = 8; const T = 14; const B = 30;
  const max = Math.max(5, ...points.map((p) => p.v));
  const n = points.length;
  const bw = (W - L - R) / n;
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const label = (k) => { const d = new Date(`${k}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}`; };
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': '날짜별 들은 횟수' },
    s('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'grid' }),
    s('text', { x: L - 6, y: y(max) + 5, 'text-anchor': 'end', class: 'axis' }, String(max)),
    s('text', { x: L - 6, y: y(0) + 5, 'text-anchor': 'end', class: 'axis' }, '0'),
    points.map((p, i) => [
      p.v ? s('rect', { x: L + i * bw + bw * 0.18, y: y(p.v), width: bw * 0.64, height: y(0) - y(p.v), rx: 3, class: 'bar' }) : null,
      (n <= 7 || i % Math.ceil(n / 7) === 0 || i === n - 1) ? s('text', { x: L + i * bw + bw / 2, y: H - 10, 'text-anchor': 'middle', class: 'axis' }, label(p.k)) : null,
    ]));
}

function calendar() {
  const now = new Date();
  const y = now.getFullYear(); const m = now.getMonth();
  const first = new Date(y, m, 1).getDay();
  const last = new Date(y, m + 1, 0).getDate();
  const days = practiceDays();
  const cells = ['일', '월', '화', '수', '목', '금', '토'].map((d) => h('div', { class: 'cal-head', text: d }));
  for (let i = 0; i < first; i++) cells.push(h('div'));
  for (let d = 1; d <= last; d++) {
    const k = sync.dateKey(new Date(y, m, d).getTime());
    const on = days.has(k);
    cells.push(on
      ? h('button', { type: 'button', class: 'cal-day on', 'aria-label': `${m + 1}월 ${d}일 연습함, 다시 하기`, onclick: () => screenReviewDay(k) }, h('span', { text: String(d) }))
      : h('div', { class: 'cal-day', 'aria-label': `${m + 1}월 ${d}일` }, h('span', { text: String(d) })));
  }
  return h('div', {}, h('p', { class: 'cal-title', text: `${y}년 ${m + 1}월` }), h('div', { class: 'cal' }, cells));
}

function topItems(limit = 10) {
  const sums = new Map();
  state.sessions.forEach((x) => x.items.forEach((it) => sums.set(it.text, (sums.get(it.text) || 0) + sync.playsOf(it))));
  return [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function screenRecords(range = 7) {
  const days = practiceDays().size;
  const series = playsByDay(range);
  const total = series.reduce((a, p) => a + p.v, 0);
  const activeDays = series.filter((p) => p.v > 0).length;
  const top = topItems();
  const summary = total ? `최근 ${range}일 동안 ${activeDays}일 연습했고, 모두 ${total}번 들었어요.` : `최근 ${range}일 동안 연습한 기록이 없어요.`;
  screen({
    guide: `${days ? `지금까지 ${days}일 연습했어요. ` : ''}${summary}`,
    title: '나의 기록',
    body: [
      h('section', {}, h('h2', { text: '연습 달력' }), para(days ? `지금까지 ${days}일 연습했어요. 도장이 찍힌 날을 누르면 그날 연습을 다시 할 수 있어요.` : '연습한 날에 도장이 찍혀요.'), calendar()),
      h('section', {},
        h('h2', { text: '들은 횟수' }),
        para(summary),
        h('div', { class: 'row' },
          button('7일', () => screenRecords(7), { kind: range === 7 ? 'primary' : 'secondary' }),
          button('30일', () => screenRecords(30), { kind: range === 30 ? 'primary' : 'secondary' })),
        barChart(series)),
      h('section', {},
        h('h2', { text: '많이 연습한 낱말·문장' }),
        top.length
          ? h('ul', { class: 'wordlist' }, top.map(([t, n]) => h('li', {}, h('span', { text: `${t} · ${n}번` }), button('듣기', () => speakWord(t), { kind: 'ghost', iconName: 'speaker' }))))
          : para('연습하면 여기에 모여요.')),
    ],
    actions: [
      button('지난 연습 다시 하기', screenReviewDays, { kind: 'secondary', iconName: 'replay' }),
      button('처음 화면으로', screenHome, { kind: 'secondary' }),
    ],
  });
}

// ───────────── 설정 ─────────────

function flushQuiet() {
  if (!state.identity || !navigator.onLine) return;
  sync.flush(state.identity).catch(() => {});
}

function settingRow(label, desc, btn) {
  return h('div', { class: 'setting' }, h('div', {}, h('strong', { text: label }), desc ? h('span', { class: 'small', text: desc }) : null), btn);
}

async function screenSettings() {
  const st = state.settings;
  const pin = await store.kvGet('pin');
  screen({
    guide: '설정이에요. 바꾸고 싶은 항목의 버튼을 눌러 주세요.',
    title: '설정',
    body: [
      settingRow('글씨 크기', fontSizeLabel(getFontScale()), button('바꾸기', () => openFontSizePanel(screenSettings), { kind: 'secondary' })),
      settingRow('목소리와 빠르기', null, button('바꾸기', () => screenVoice({ fromSettings: true }), { kind: 'secondary' })),
      settingRow('나만의 낱말', `${state.customWords.length}개`, button('바꾸기', () => screenCustomWords(screenSettings), { kind: 'secondary' })),
      settingRow('이용 횟수 통계 보내기', st.metricsConsent ? '켜짐' : '꺼짐', button(st.metricsConsent ? '끄기' : '켜기', async () => {
        try { await sync.setMetricsConsent(state.identity, !st.metricsConsent); state.settings = await sync.loadSettings(); toast('바꿨어요.'); } catch (e) { toast(errorText(e)); }
        screenSettings();
      }, { kind: 'secondary' })),
      settingRow('연결된 기기', null, button('보기', screenDevices, { kind: 'secondary' })),
      settingRow('복구 코드 새로 만들기', '이전 코드는 쓸 수 없게 돼요', button('만들기', screenRekey, { kind: 'secondary' })),
      settingRow('화면 잠금', pin ? '켜짐 (가족과 기기를 같이 쓸 때)' : '꺼짐 (가족과 기기를 같이 쓸 때)', button(pin ? '끄기' : '켜기', async () => {
        if (pin) { await store.kvDel('pin'); toast('화면 잠금을 껐어요.'); screenSettings(); } else screenPinSetup();
      }, { kind: 'secondary' })),
      settingRow('내 기록 모두 지우기', '기기와 서버의 기록을 모두 지워요', button('지우기', screenDeleteAll, { kind: 'danger' })),
      disclaimer(),
      h('a', { href: './privacy.html', class: 'link', text: '개인정보 처리방침' }),
      para('마이크를 쓰지 않으며 목소리를 녹음하지 않아요.', 'small'),
    ],
    actions: [button('처음 화면으로', screenHome, { kind: 'secondary' })],
  });
}

function screenCustomWords(back = screenSettings) {
  const input = h('input', { type: 'text', maxlength: String(CONFIG.CUSTOM_WORD_MAX_LEN), placeholder: '예: 영희, 시장, 안경', 'aria-label': '추가할 낱말', autocomplete: 'off' });
  const msg = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
  const list = h('ul', { class: 'wordlist' });
  const render = () => {
    clear(list);
    state.customWords.forEach((w) => list.append(h('li', {}, h('span', { text: w }),
      button('빼기', async () => { state.customWords = state.customWords.filter((x) => x !== w); await sync.saveCustomWords(state.identity, state.customWords); flushQuiet(); render(); }, { kind: 'ghost' }))));
  };
  const add = async () => {
    const w = input.value.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!w) return;
    if (!/^[가-힣0-9 ]+$/.test(w)) { msg.textContent = '한글로 넣어 주세요.'; return; }
    if (state.customWords.includes(w)) { msg.textContent = '이미 있는 낱말이에요.'; return; }
    if (state.customWords.length >= CONFIG.MAX_CUSTOM_WORDS) { msg.textContent = `낱말은 ${CONFIG.MAX_CUSTOM_WORDS}개까지 넣을 수 있어요.`; return; }
    // 저장을 기다리기 전에 입력칸을 비워, 그 사이 입력한 다음 낱말이 지워지지 않게 함
    input.value = '';
    state.customWords = [...state.customWords, w];
    msg.textContent = `"${w}"를 넣었어요.`;
    render();
    await sync.saveCustomWords(state.identity, state.customWords);
    flushQuiet();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  render();
  screen({
    guide: '가족 이름, 자주 가는 곳, 필요한 물건처럼 자주 쓰는 낱말을 넣어 주세요. 오늘의 낱말에도 섞여 나와요.',
    title: '나만의 낱말',
    body: [
      para('가족 이름, 자주 가는 곳, 필요한 물건을 넣어 주세요. 오늘의 낱말에도 섞여 나와요. 잠가서 보관하니 운영자는 볼 수 없어요.', 'lead'),
      h('div', { class: 'row' }, input, button('넣기', add)), msg, list,
    ],
    actions: [button('뒤로', () => back(), { kind: 'secondary' })],
  });
}

async function screenDevices() {
  loading('기기 목록을 불러오고 있어요');
  let devices;
  try { devices = await sync.listDevices(state.identity); } catch (e) {
    return screen({ guide: errorText(e), title: '연결된 기기', body: [para(errorText(e), 'lead')], actions: [button('뒤로', screenSettings, { kind: 'secondary' })] });
  }
  const others = devices.filter((d) => !d.current).length;
  screen({
    guide: `연결된 기기가 ${devices.length}대 있어요.`,
    title: '연결된 기기',
    body: [h('ul', { class: 'devices' }, devices.map((d) => h('li', {},
      h('strong', { text: d.current ? '이 기기' : '다른 기기' }),
      h('span', { class: 'small', text: `연결한 날 ${d.createdDate} · 마지막 사용 ${d.lastSeenDate}` }))))],
    actions: [
      others ? button('다른 기기 모두 연결 끊기', async () => {
        const ok = await ask({ title: '다른 기기의 연결을 끊을까요?', text: '끊은 기기는 복구 코드로 다시 연결해야 해요.', yes: '연결 끊기', no: '취소', danger: true });
        if (!ok) return screenDevices();
        try { await sync.revokeOthers(state.identity); toast('연결을 끊었어요.'); } catch (e) { toast(errorText(e)); }
        screenDevices();
      }, { kind: 'danger' }) : null,
      button('뒤로', screenSettings, { kind: 'secondary' }),
    ].filter(Boolean),
  });
}

async function screenRekey() {
  const ok = await ask({
    title: '복구 코드를 새로 만들까요?',
    text: '이전 복구 코드는 쓸 수 없게 되고, 다른 기기의 연결도 끊겨요. 인터넷 연결이 필요해요.',
    yes: '새로 만들기', no: '취소',
  });
  if (!ok) return screenSettings();
  loading('새 복구 코드를 만들고 있어요');
  try {
    const { identity, recoveryCode } = await sync.rekey(state.identity);
    state.identity = identity;
    screenRecoveryCode(recoveryCode, screenSettings);
  } catch (e) {
    screen({ guide: errorText(e), title: '만들지 못했어요', body: [para(errorText(e), 'lead')], actions: [button('뒤로', screenSettings, { kind: 'secondary' })] });
  }
}

async function screenDeleteAll() {
  const ok = await ask({ title: '내 기록을 모두 지울까요?', text: '이 기기와 서버의 연습 기록, 나만의 낱말, 설정이 모두 지워지고 되돌릴 수 없어요.', yes: '모두 지우기', no: '취소', danger: true });
  if (!ok) return screenSettings();
  loading('지우고 있어요');
  try {
    await sync.deleteEverything(state.identity);
  } catch (e) {
    return screen({ guide: errorText(e), title: '지우지 못했어요', body: [para(`${errorText(e)} 서버의 기록을 지우려면 인터넷 연결이 필요해요.`, 'lead')], actions: [button('뒤로', screenSettings, { kind: 'secondary' })] });
  }
  state.identity = null;
  state.settings = { ...sync.DEFAULT_SETTINGS };
  state.customWords = [];
  state.sessions = [];
  toast('모두 지웠어요.');
  screenWelcome();
}

// ───────────── 화면 잠금 (공용 기기, 선택) ─────────────

function keypad(onDigit, onBack) {
  return h('div', { class: 'keypad' },
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←'].map((k) => k === ''
      ? h('span')
      : h('button', { type: 'button', class: 'key', 'aria-label': k === '←' ? '지우기' : k, text: k, onclick: () => (k === '←' ? onBack() : onDigit(k)) })));
}

function pinScreen({ title, guide, onComplete, extra = [] }) {
  let value = '';
  const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
  const msg = h('p', { class: 'feedback', role: 'status' });
  const render = () => { clear(dots); for (let i = 0; i < 4; i++) dots.append(h('span', { class: i < value.length ? 'on' : '' })); };
  render();
  screen({
    guide, title,
    body: [dots, msg, keypad(async (d) => {
      if (value.length >= 4) return;
      value += d; render();
      if (value.length === 4) { const v = value; value = ''; await onComplete(v, msg); render(); }
    }, () => { value = value.slice(0, -1); render(); })],
    actions: extra,
  });
}

function screenPinSetup() {
  pinScreen({
    title: '숫자 4개를 정해 주세요',
    guide: '화면 잠금에 쓸 숫자 네 개를 눌러 주세요.',
    onComplete: (first) => pinScreen({
      title: '한 번 더 눌러 주세요',
      guide: '같은 숫자 네 개를 한 번 더 눌러 주세요.',
      onComplete: async (second, msg) => {
        if (first !== second) { msg.textContent = '숫자가 달라요. 처음부터 다시 해요.'; await sleep(1200); return screenPinSetup(); }
        const salt = b64u(randomBytes(16));
        await store.kvSet('pin', { salt, hash: await hashPin(first, salt), fails: 0 });
        toast('화면 잠금을 켰어요.');
        screenSettings();
      },
    }),
    extra: [button('취소', screenSettings, { kind: 'secondary' })],
  });
}

function screenPin(next) {
  pinScreen({
    title: '숫자 4개를 눌러 주세요',
    guide: '화면 잠금 숫자 네 개를 눌러 주세요.',
    onComplete: async (v, msg) => {
      const pin = await store.kvGet('pin');
      if (pin.until && Date.now() < pin.until) { msg.textContent = '잠시 후 다시 해 주세요.'; return; }
      if (await hashPin(v, pin.salt) === pin.hash) { pin.fails = 0; await store.kvSet('pin', pin); return next(); }
      pin.fails = (pin.fails || 0) + 1;
      if (pin.fails >= 5) { pin.until = Date.now() + 30000; pin.fails = 0; }
      await store.kvSet('pin', pin);
      msg.textContent = '숫자가 맞지 않아요.';
    },
    extra: [button('숫자를 잊었어요', async () => {
      const ok = await ask({ title: '복구 코드로 다시 연결할까요?', text: '이 기기의 기록을 지우고 복구 코드로 다시 연결해요. 아직 보내지 못한 기록은 사라질 수 있어요.', yes: '다시 연결', no: '취소' });
      if (!ok) return screenPin(next);
      await store.clearAll();
      await reloadLocal();
      screenRecoverInput();
    }, { kind: 'secondary' })],
  });
}

boot();
