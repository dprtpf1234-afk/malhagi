// 말하기 짝꿍 – 화면과 흐름 (PRD v1.4)
import { CONFIG } from './config.js';
import { h, s, icon, button, toast, clear } from './ui.js';
import * as speech from './speech.js';
import * as sync from './sync.js';
import * as store from './store.js';
import { ApiError } from './api.js';
import { bestMatch } from './hangul.js';
import { hintFor } from './hints.js';
import { BUILTIN, DIAGNOSIS, STAGES, buildSession, modeOf } from './curriculum.js';
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
  items: BUILTIN,
  guide: '',
  onboarding: { metricsConsent: false },
  abort: null,          // 진행 중인 녹음 중단용
  installPrompt: null,  // Android 홈 화면 추가
  fitCurrent: null,     // 연습 낱말 크기 맞추기 (글씨 크기·화면 크기 변경 시)
};

window.addEventListener('fontscalechange', () => state.fitCurrent?.());
window.addEventListener('resize', () => state.fitCurrent?.());
document.fonts?.ready.then(() => state.fitCurrent?.());

const PRAISE = ['잘했어요!', '좋아요!', '정확하게 들렸어요!', '훌륭해요!', '아주 잘했어요!'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────── 공통 화면 틀 ─────────────

function speakGuide() {
  return speech.speak(state.guide, { voiceName: state.settings.voiceName, rate: state.settings.rate });
}

function speakWord(text, rate = state.settings.rate) {
  return speech.speak(text, { voiceName: state.settings.voiceName, rate });
}

function toggleFullscreen() {
  const d = document;
  const el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch?.(() => {});
}

/**
 * 한 화면 = 위쪽 막대(다시 듣기·전체화면·추가 버튼) + 본문 + 아래쪽 큰 버튼.
 */
function screen({ guide = '', title = '', body = [], actions = [], top = [], className = '', fullscreenButton = true }) {
  state.guide = guide || title;
  state.fitCurrent = null;
  speech.stopSpeaking();
  clear($app);
  const topbar = h('div', { class: 'topbar' },
    guide ? button('다시 듣기', speakGuide, { kind: 'tool', iconName: 'speaker' }) : h('span'),
    h('div', { class: 'topbar-right' },
      button('글씨 크기', () => openFontSizePanel(), { kind: 'tool', iconName: 'text' }),
      top,
      fullscreenButton && state.env?.fullscreen ? button('전체화면', toggleFullscreen, { kind: 'tool', iconName: 'expand' }) : null));
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
  speech.speak('읽기 편한 글씨 크기를 골라 주세요.', { voiceName: state.settings.voiceName, rate: state.settings.rate });
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
    if (document.hidden) { speech.stopSpeaking(); state.abort?.abort(); }
  });

  if (!speech.isSupported(state.env)) return screenUnsupported();

  await reloadLocal();
  sync.fetchCurriculum().then((items) => { if (items) state.items = items; });

  const pin = await store.kvGet('pin');
  if (pin) return screenPin(route);
  return route();
}

async function reloadLocal() {
  state.identity = await sync.loadIdentity();
  state.settings = await sync.loadSettings();
  state.customWords = await sync.loadCustomWords();
  state.sessions = await sync.loadSessions();
}

async function route() {
  if (!state.identity) return screenWelcome();
  speech.prepareOnDevice(); // 기기 내 인식 가능 여부 확인 (설치는 하지 않음)
  backgroundSync();
  if (state.settings.stage == null) return screenDiagnosisIntro();
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
  let title = '이 화면에서는 말하기 연습이 어려워요';
  let text = 'Chrome 또는 Safari로 열어 주세요.';
  const steps = [];
  if (env.isIOS && env.standalone) {
    text = '아이폰·아이패드의 홈 화면 아이콘으로 열면 음성 인식이 동작하지 않아요. Safari에서 주소를 열어 주세요. 기록은 그대로 이어져요.';
    steps.push('아래 "주소 복사하기"를 눌러요.', 'Safari를 열고 주소창에 붙여 넣어요.', '홈 화면의 말하기 짝꿍 아이콘은 지워도 괜찮아요.');
  } else if (env.inApp) {
    text = '카카오톡 같은 앱 안의 화면에서는 마이크가 잘 동작하지 않아요. Chrome 또는 Safari로 열어 주세요.';
    steps.push('화면 오른쪽 위나 아래의 메뉴(⋮ 또는 공유) 버튼을 눌러요.', '"다른 브라우저로 열기" 또는 "Safari로 열기"를 눌러요.');
  } else if (!env.secure) {
    text = '보안 연결(https) 주소로 열어 주세요.';
  } else if (!env.stt) {
    text = '이 브라우저는 음성 인식을 지원하지 않아요. Chrome(안드로이드·PC) 또는 Safari(아이폰·아이패드)로 열어 주세요.';
  } else if (!env.mic) {
    text = '마이크를 쓸 수 없는 환경이에요. 마이크가 있는 기기에서 열어 주세요.';
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
    guide: '말하기 짝꿍이에요. 매일 조금씩 소리 내어 연습해요. 처음이면 처음이에요 버튼을, 복구 코드가 있으면 아래 버튼을 눌러 주세요.',
    title: '말하기 짝꿍',
    body: [
      para('매일 조금씩, 소리 내어 연습해요.', 'lead'),
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
    screenMic();
  }, { disabled: true });
  req.addEventListener('change', () => { next.disabled = !req.checked; });

  const points = [
    ['연습을 돕는 도구예요', '치료를 대신하지 않아요.'],
    ['기록은 나만 볼 수 있어요', '연습 기록은 이 기기에서 잠가서(암호화) 보관해요. 운영자도 내용을 볼 수 없어요.'],
    ['목소리는 저장하지 않아요', '다만 글자로 바꾸기 위해 Google이나 Apple 서버로 잠깐 보내질 수 있어요.'],
    ['복구 코드를 꼭 보관해요', '복구 코드를 잃고 이 기기 기록도 지워지면, 누구도 기록을 되찾을 수 없어요.'],
  ];
  screen({
    guide: points.map((p) => p.join('. ')).join('. ') + '. 동의하면 첫 번째 칸을 눌러 주세요.',
    title: '시작하기 전에',
    body: [
      h('ul', { class: 'points' }, points.map(([t, d]) => h('li', {}, h('strong', { text: t }), h('span', { text: d })))),
      h('label', { class: 'check', for: 'c-opt' }, opt, h('span', {}, h('b', { text: '[선택] ' }), '서비스 개선을 위해 날짜별 연습 횟수만 보내는 것에 동의해요. 낱말과 결과는 보내지 않아요.')),
      h('p', { class: 'small' }, '만 14세 이상 성인을 위한 서비스예요. ', h('a', { href: './privacy.html', class: 'link', text: '개인정보 처리방침 보기' })),
    ],
    actions: [
      h('label', { class: 'check', for: 'c-req' }, req, h('span', {}, h('b', { text: '[필수] ' }), '연습 기록(건강 관련 정보)을 처리하는 것에 동의해요.')),
      h('div', { class: 'row' }, button('뒤로', () => screenFontSize(screenConsent), { kind: 'secondary' }), next),
    ],
  });
}

function screenMic(after = screenVoice) {
  screen({
    guide: '말하기 연습을 하려면 마이크가 필요해요. 아래 버튼을 누른 뒤, 허용을 눌러 주세요.',
    title: '마이크가 필요해요',
    body: [para('아래 버튼을 누른 뒤, 화면에 나오는 창에서 "허용"을 눌러 주세요.', 'lead')],
    actions: [button('마이크 허용하기', async () => {
      const r = await speech.requestMic();
      if (r === 'granted') {
        // 기기 내 음성 인식이 가능하면 언어 팩 설치 시도 (최대 5초만 기다림)
        await Promise.race([speech.prepareOnDevice({ install: true }), sleep(5000)]);
        return after();
      }
      return screenMicHelp(r, after);
    }, { iconName: 'mic' })],
  });
}

function screenMicHelp(reason, after) {
  const env = state.env;
  const steps = reason === 'nodevice'
    ? ['이어폰 마이크나 기기 마이크가 연결되어 있는지 확인해요.', '다른 앱이 마이크를 쓰고 있으면 닫아요.']
    : env.isIOS
      ? ['아이폰 "설정" 앱을 열어요.', '아래로 내려 "Safari"를 눌러요.', '"마이크"를 눌러 "허용"으로 바꿔요.', '이 화면으로 돌아와 다시 시도해요.']
      : ['주소창 왼쪽의 자물쇠(또는 설정) 표시를 눌러요.', '"권한" 또는 "마이크"를 눌러 "허용"으로 바꿔요.', '이 화면으로 돌아와 다시 시도해요.'];
  const title = reason === 'nodevice' ? '마이크를 찾을 수 없어요' : '내 목소리를 듣기 위해 마이크 권한이 필요해요';
  screen({
    guide: `${title}. ${steps.join(' ')}`,
    title,
    body: [h('ol', { class: 'steps' }, steps.map((t) => h('li', { text: t })))],
    actions: [button('다시 시도', () => screenMic(after))],
  });
}

async function screenVoice({ fromSettings = false } = {}) {
  const voices = await speech.getKoreanVoices();
  const settings = state.settings;
  if (voices.length && !voices.some((v) => v.name === settings.voiceName)) settings.voiceName = voices[0].name;

  const done = async () => {
    await sync.saveSettings(state.identity, settings);
    if (fromSettings) { flushQuiet(); return screenSettings(); }
    return screenCreateKeys();
  };

  const voiceList = h('div', { class: 'choices' });
  const renderVoices = () => {
    clear(voiceList);
    voices.forEach((v, i) => {
      const selected = v.name === settings.voiceName;
      voiceList.append(h('button', {
        type: 'button', class: `choice${selected ? ' selected' : ''}`, 'aria-pressed': String(selected),
        onclick: async () => { settings.voiceName = v.name; renderVoices(); await speakWord('안녕하세요'); },
      }, selected ? icon('check') : null, h('span', { text: `목소리 ${i + 1}` })));
    });
  };
  renderVoices();

  const rates = [[1.0, '보통'], [0.85, '조금 천천히'], [0.7, '천천히']];
  const rateList = h('div', { class: 'choices' });
  const renderRates = () => {
    clear(rateList);
    rates.forEach(([r, label]) => {
      const selected = settings.rate === r;
      rateList.append(h('button', {
        type: 'button', class: `choice${selected ? ' selected' : ''}`, 'aria-pressed': String(selected),
        onclick: async () => { settings.rate = r; renderRates(); await speakWord('안녕하세요', r); },
      }, selected ? icon('check') : null, h('span', { text: label })));
    });
  };
  renderRates();

  screen({
    guide: '듣기 편한 목소리와 빠르기를 골라 주세요. 버튼을 누르면 미리 들을 수 있어요.',
    title: '목소리 고르기',
    body: [
      voices.length === 0
        ? para('기기에 한국어 목소리가 없어요. 기기 설정의 "음성 출력(TTS)"에서 한국어를 추가하면 들을 수 있어요. 목소리 없이도 연습할 수 있어요.', 'lead')
        : voices.length > 1 ? [h('h2', { text: '목소리' }), voiceList] : null,
      h('h2', { text: '빠르기' }), rateList,
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
    screenRecoveryCode(recoveryCode, screenInstall);
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

// ───────────── 홈 화면 추가 / 전체화면 ─────────────

function screenInstall(next = screenDiagnosisIntro) {
  const env = state.env;
  const body = [];
  const actions = [];
  if (env.isIOS) {
    // 아이폰 홈 화면 앱에서는 음성 인식이 동작하지 않으므로 Safari 즐겨찾기로 안내
    body.push(
      para('Safari 즐겨찾기에 넣어 두면 다음에 쉽게 열 수 있어요. 홈 화면 아이콘으로는 음성 인식이 동작하지 않으니 Safari에서 열어 주세요.', 'lead'),
      h('ol', { class: 'steps' },
        h('li', { text: 'Safari 아래쪽(아이패드는 위쪽)의 공유 버튼(네모에 위쪽 화살표)을 눌러요.' }),
        h('li', { text: '"즐겨찾기에 추가"를 눌러요.' }),
        h('li', { text: '오른쪽 위 "저장"을 눌러요.' })),
      para('일주일 넘게 쓰지 않으면 Safari가 이 기기의 기록을 지울 수 있어요. 그래도 복구 코드로 다시 연결하면 기록이 돌아와요.', 'note'));
  } else {
    body.push(para('홈 화면에 추가하면 앱처럼 바로 열 수 있어요.', 'lead'));
    if (state.installPrompt) {
      actions.push(button('홈 화면에 추가', async () => {
        state.installPrompt.prompt();
        try { await state.installPrompt.userChoice; } catch { /* 무시 */ }
        state.installPrompt = null;
        next();
      }));
    }
    if (env.fullscreen) actions.push(button('전체화면으로 보기', toggleFullscreen, { kind: 'secondary', iconName: 'expand' }));
  }
  actions.push(button(actions.length ? '건너뛰기' : '다음', next, { kind: actions.length ? 'secondary' : 'primary' }));
  screen({ guide: body.map((n) => n.textContent).join(' '), title: env.isIOS ? '쉽게 다시 여는 방법' : '홈 화면에 추가하기', body, actions });
}

// ───────────── 연습 한 문항 ─────────────

/**
 * 한 문항 연습 (PRD F-04, F-05).
 * @returns {Promise<{final:'pass'|'skip'|'listen'|'quit', attempts:Array, bestRate:number}>}
 */
function practiceItem(item, { index, total, diagnosis = false }) {
  return new Promise((resolve) => {
    const mode = modeOf(item);
    const maxAttempts = diagnosis ? 2 : CONFIG.MAX_ATTEMPTS;
    const attempts = [];
    let counted = 0;
    let bestRate = 0;
    let hintShown = false;
    let finished = false;

    const finish = (final) => {
      if (finished) return;
      finished = true;
      state.fitCurrent = null;
      state.abort?.abort();
      speech.stopSpeaking();
      resolve({ final, attempts, bestRate });
    };

    const displayText = mode === 'phonation' ? `${item.text}–` : item.text;
    // 띄어쓰기 단위로 묶어(.wg) 낱말 중간에서 줄이 바뀌지 않게 하고, 글자마다(.ch) 오답 표시
    const word = h('div', { class: 'word', lang: 'ko' });
    const charEls = []; // 원문 글자 위치 → 글자 요소 (띄어쓰기는 null)
    let group = null;
    Array.from(displayText).forEach((c) => {
      if (c === ' ') { group = null; word.append(' '); charEls.push(null); return; }
      if (!group) { group = h('span', { class: 'wg' }); word.append(group); }
      const el = h('span', { class: 'ch', text: c });
      group.append(el);
      charEls.push(el);
    });
    const markWrong = (positions) => {
      charEls.forEach((el, i) => {
        if (!el) return;
        el.classList.remove('hl-a', 'hl-b');
        const k = positions.indexOf(i);
        if (k >= 0) el.classList.add(k % 2 ? 'hl-b' : 'hl-a');
      });
    };
    const feedback = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
    const gaugeFill = h('div', { class: 'gauge-fill' });
    const gauge = h('div', { class: 'gauge hidden', role: 'img', 'aria-label': '' }, gaugeFill);
    const hintBox = h('div', { class: 'hint hidden' });
    const ring = h('div', { class: 'ring', 'aria-hidden': 'true' });

    const micBtn = button('말하기', () => listen(), { kind: 'mic', iconName: 'mic' });
    const replayBtn = button('낱말 듣기', () => speakWord(item.text), { kind: 'secondary', iconName: 'speaker' });
    const nextBtn = (label = '다음') => button(label, () => finish(pendingFinal), {});
    let pendingFinal = 'pass';
    const actionsEl = h('div', { class: 'actions' });
    const setActions = (...btns) => { clear(actionsEl); actionsEl.append(...btns); };
    const setBusy = (busy) => { micBtn.disabled = busy; replayBtn.disabled = busy; };

    const guideText = mode === 'phonation'
      ? `"${item.text}" 소리를 길게 내 보세요. 말하기 버튼을 누르고 ${item.text}— 하고 소리 내요.`
      : `"${item.text}". 말하기 버튼을 누르고 따라 말해 보세요.`;

    screen({
      guide: guideText,
      body: [
        h('p', { class: 'progress', text: diagnosis ? `${index + 1} / ${total}` : `${index + 1} / ${total}${item.custom ? ' · 나만의 낱말' : ''}` }),
        h('div', { class: 'stage-word' }, ring, word),
        gauge, feedback, hintBox,
      ],
      top: [button('그만하기', () => finish('quit'), { kind: 'tool', iconName: 'stop' })],
      className: 'practice',
      fullscreenButton: false,
    });
    $app.append(actionsEl);
    setActions(micBtn, replayBtn);
    state.fitCurrent = () => fitWord(word);
    requestAnimationFrame(() => state.fitCurrent?.());
    sleep(300).then(() => { if (!finished) speakWord(item.text); });

    const showHint = (firstWrong) => {
      if (hintShown || diagnosis) return;
      hintShown = true;
      clear(hintBox);
      if (mode === 'phonation') {
        hintBox.append(h('p', { text: '숨을 크게 들이쉬고, 입을 벌린 채 소리를 길게 이어 보세요.' }));
      } else {
        const hint = firstWrong ? hintFor(firstWrong.jamo, firstWrong.role) : null;
        if (hint) {
          let img = null;
          if (CONFIG.HINT_IMAGES) {
            img = h('img', { src: `./hints/${encodeURIComponent(hint.jamo)}.svg`, alt: '', class: 'hint-img' });
            img.addEventListener('error', () => img.remove());
          }
          hintBox.append(...[h('div', { class: 'hint-jamo', text: hint.jamo }), img, h('p', { text: hint.text })].filter(Boolean));
        } else {
          hintBox.append(h('p', { text: '천천히 들어 보고 한 글자씩 따라 해 봐요.' }));
        }
      }
      hintBox.classList.remove('hidden');
      speakWord(item.text, 0.7); // 천천히 듣기
    };

    const giveUp = async () => {
      setBusy(true);
      pendingFinal = 'skip';
      feedback.textContent = diagnosis ? '좋아요. 다음 낱말로 가요.' : '이 낱말은 다음에 다시 만나요. 잘하고 있어요!';
      if (!diagnosis) await speakWord(item.text);
      setActions(nextBtn());
    };

    const onResult = async (rate, wrong, firstWrong, transcript) => {
      counted++;
      bestRate = Math.max(bestRate, rate);
      const pass = diagnosis ? rate >= CONFIG.PARTIAL_THRESHOLD : rate >= CONFIG.PASS_THRESHOLD;
      const partial = !pass && rate >= CONFIG.PARTIAL_THRESHOLD;
      attempts.push({ transcript: String(transcript || '').slice(0, 60), rate: Math.round(rate * 100) / 100, result: pass ? 'pass' : partial ? 'partial' : 'retry', hint: hintShown });

      if (pass) {
        markWrong([]);
        gauge.classList.add('hidden');
        feedback.textContent = pick(PRAISE);
        pendingFinal = 'pass';
        setActions(nextBtn());
        return;
      }
      markWrong(wrong);
      if (partial) {
        feedback.textContent = '거의 다 왔어요!';
        gauge.classList.remove('hidden');
        gauge.setAttribute('aria-label', `알아들은 정도 ${Math.round(rate * 100)}퍼센트`);
        requestAnimationFrame(() => { gaugeFill.style.width = `${Math.round(rate * 100)}%`; });
      } else {
        feedback.textContent = '괜찮아요. 천천히 다시 해 봐요.';
      }
      if (counted >= maxAttempts) return giveUp();
      showHint(firstWrong);
      setBusy(false);
    };

    async function listen() {
      setBusy(true);
      speech.stopSpeaking();
      state.abort = new AbortController();
      const signal = state.abort.signal;
      try {
        if (mode === 'phonation') {
          feedback.textContent = `"${item.text}—" 하고 길게 소리 내 보세요.`;
          ring.classList.add('on');
          const r = await speech.phonationTest({ signal, onLevel: (lv) => ring.style.setProperty('--lv', lv.toFixed(2)) });
          ring.classList.remove('on');
          if (signal.aborted) { setBusy(false); return; }
          if (r.silent) { feedback.textContent = '다시 한번 소리 내 볼까요?'; setBusy(false); return; }
          return onResult(r.passed ? 1 : Math.min(0.99, r.longestMs / CONFIG.PHONATION_MS), [], null, `${r.longestMs}ms`);
        }

        // 주변 소음 확인 (시도 횟수에 넣지 않음)
        let ambient = 0;
        if (CONFIG.AMBIENT_CHECK) {
          feedback.textContent = '잠깐만요…';
          // 측정에 실패하면(일부 기기에서 마이크 전환 문제) 소음 확인만 건너뜀
          try { ambient = await speech.measureAmbient(); } catch { ambient = 0; }
        }
        if (signal.aborted) { setBusy(false); return; }
        if (ambient > CONFIG.NOISE_RMS) {
          const goOn = await new Promise((res) => {
            feedback.textContent = '주변이 조금 시끄러운 것 같아요. 조용한 곳에서 해 볼까요?';
            setActions(button('그래도 할게요', () => res(true)), button('나중에 할게요', () => res(false), { kind: 'secondary' }));
          });
          setActions(micBtn, replayBtn);
          if (!goOn) return finish('quit');
        }

        feedback.textContent = '듣고 있어요. 말해 보세요.';
        ring.classList.add('on');
        const r = await speech.recognizeOnce({ signal, onSpeechStart: () => ring.classList.add('speaking') });
        ring.classList.remove('on', 'speaking');
        if (signal.aborted) { setBusy(false); return; }

        if (r.error) return handleError(r.error);
        const m = bestMatch(item.text, r.alternatives, item.accept || []);
        return onResult(m.rate, m.wrong, m.firstWrong, m.transcript);
      } catch {
        ring.classList.remove('on', 'speaking');
        feedback.textContent = '마이크를 쓸 수 없어요. 마이크 연결과 권한을 확인해 주세요.';
        setBusy(false);
      }
    }

    function handleError(code) {
      if (code === 'no-speech' || code === 'aborted' || code === 'start-failed') {
        feedback.textContent = '다시 한번 말해 볼까요?'; // 시도 횟수에 넣지 않음
        setBusy(false);
        return;
      }
      if (code === 'not-allowed') {
        feedback.textContent = '마이크 권한이 꺼져 있어요.';
        return setActions(button('마이크 다시 켜기', () => screenMicHelp('denied', () => finish('quit'))), button('그만하기', () => finish('quit'), { kind: 'secondary' }));
      }
      if (code === 'service-not-allowed') {
        feedback.textContent = state.env.isIOS
          ? '아이폰 "설정 → 일반 → 키보드"에서 "받아쓰기"를 켜야 말하기 연습을 할 수 있어요.'
          : '이 기기에서 음성 인식을 쓸 수 없어요.';
        setBusy(false);
        return;
      }
      if (code === 'audio-capture') {
        feedback.textContent = '마이크를 찾을 수 없어요. 이어폰 마이크를 확인해 주세요.';
        setBusy(false);
        return;
      }
      if (code === 'network' || code === 'language-not-supported' || code === 'unsupported') {
        // 듣고 따라 말하기 모드: 판정하지 않음 (PRD 7장)
        feedback.textContent = '지금은 인터넷 연결이 없어 듣고 따라 말하기로 연습해요. 들어 보고 따라 말해 보세요.';
        pendingFinal = 'listen';
        speakWord(item.text);
        return setActions(nextBtn('따라 말했어요'), replayBtn);
      }
      feedback.textContent = '다시 한번 말해 볼까요?';
      setBusy(false);
    }
  });
}

// ───────────── 진단 ─────────────

function screenDiagnosisIntro() {
  screen({
    guide: '지금 말하기에 맞는 연습을 골라 드릴게요. 낱말 다섯 개를 따라 말해 보세요.',
    title: '연습 고르기',
    body: [para('지금 말하기에 맞는 연습을 골라 드릴게요. 낱말 5개를 따라 말해 보세요.', 'lead'), disclaimer()],
    actions: [button('시작하기', runDiagnosis)],
  });
}

async function runDiagnosis() {
  let assigned = null;
  let anyRecognized = false;
  for (let i = 0; i < DIAGNOSIS.length; i++) {
    const it = DIAGNOSIS[i];
    const r = await practiceItem(it, { index: i, total: DIAGNOSIS.length, diagnosis: true });
    if (r.final === 'quit') return screenHomeOr(() => screenDiagnosisIntro());
    if (r.bestRate > 0) anyRecognized = true;
    if (r.final !== 'pass' && r.final !== 'listen') { assigned = Math.max(1, it.stage - 1); break; }
  }
  if (assigned === null) assigned = anyRecognized ? 6 : 1;
  state.settings.stage = assigned;
  await sync.saveSettings(state.identity, state.settings);
  flushQuiet();
  const st = STAGES[assigned - 1];
  screen({
    guide: `오늘은 ${st.name}부터 연습해요. 연습 단계는 설정에서 언제든 바꿀 수 있어요.`,
    title: `오늘은 "${st.name}"부터 연습해요`,
    body: [para(st.desc, 'lead'), para('연습 단계는 설정에서 언제든 바꿀 수 있어요.')],
    actions: [button('연습 시작', runSession), button('처음 화면으로', screenHome, { kind: 'secondary' })],
  });
}

function screenHomeOr(fallback) {
  return state.settings.stage == null ? fallback() : screenHome();
}

// ───────────── 세션 ─────────────

function recentPassedTexts() {
  const set = new Set();
  state.sessions.slice(-5).forEach((ss) => ss.items.forEach((it) => { if (it.final === 'pass') set.add(it.text); }));
  return set;
}

function sessionsToday() {
  const today = sync.dateKey();
  return state.sessions.filter((ss) => sync.dateKey(ss.startedAt) === today).length;
}

async function runSession() {
  const settings = state.settings;
  const stage = settings.stage || 1;
  const items = buildSession({
    items: state.items,
    stage,
    customWords: stage >= 2 ? state.customWords : [],
    reaskQueue: (settings.reaskQueue || []).filter((q) => (q.stage === 1) === (stage === 1)),
    recentPassed: recentPassedTexts(),
    size: CONFIG.SESSION_SIZE,
    maxCustom: CONFIG.MAX_CUSTOM_PER_SESSION,
    maxReask: CONFIG.MAX_REASK_PER_SESSION,
  });

  const session = { id: randomId(), startedAt: Date.now(), endedAt: 0, stage, onDevice: speech.usesOnDevice(), items: [] };
  let skipRun = 0;
  let easierAsked = false;
  let stageChanged = null;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = await practiceItem(it, { index: i, total: items.length });
    if (r.final === 'quit') break;
    session.items.push({ id: it.id, text: it.text, stage: it.stage, custom: !!it.custom, reask: !!it.reask, final: r.final, bestRate: Math.round(r.bestRate * 100) / 100, attempts: r.attempts });
    skipRun = r.final === 'skip' ? skipRun + 1 : 0;
    if (skipRun >= CONFIG.CONSECUTIVE_SKIP_SUGGEST && stage > 1 && !easierAsked) {
      easierAsked = true;
      const yes = await ask({ title: '조금 쉬운 연습으로 바꿔 볼까요?', text: `"${STAGES[stage - 2].name}" 연습으로 바꿀 수 있어요.`, yes: '좋아요', no: '이대로 할래요' });
      if (yes) { stageChanged = stage - 1; break; }
    }
  }

  session.endedAt = Date.now();
  if (stageChanged) settings.stage = stageChanged;

  if (session.items.length) {
    // 재출제 큐 갱신: 통과한 낱말은 빼고, 넘어간 낱말은 넣음
    const passed = new Set(session.items.filter((x) => x.final === 'pass').map((x) => x.text));
    const skipped = session.items.filter((x) => x.final === 'skip');
    const q = (settings.reaskQueue || []).filter((x) => !passed.has(x.text));
    for (const x of skipped) if (!q.some((y) => y.text === x.text)) q.push({ id: x.id, stage: x.stage, text: x.text, accept: items.find((y) => y.id === x.id)?.accept || [], custom: x.custom });
    settings.reaskQueue = q.slice(-20);

    await sync.saveSession(state.identity, session);
    state.sessions.push(session);
  }
  await sync.saveSettings(state.identity, settings);
  flushQuiet();

  if (!session.items.length) return screenHome();
  return screenSessionEnd(session);
}

function stageSuggestion() {
  const st = state.settings;
  if ((st.suggestAfter || 0) > state.sessions.length) return null;
  const recent = state.sessions.flatMap((x) => x.items).filter((x) => x.stage === st.stage && !x.custom && x.final !== 'listen').slice(-CONFIG.STAGE_WINDOW);
  if (recent.length < CONFIG.STAGE_WINDOW) return null;
  const rate = recent.filter((x) => x.final === 'pass').length / recent.length;
  if (rate >= CONFIG.STAGE_UP_RATE && st.stage < 6) return st.stage + 1;
  if (rate <= CONFIG.STAGE_DOWN_RATE && st.stage > 1) return st.stage - 1;
  return null;
}

function screenSessionEnd(session) {
  const done = session.items.length;
  const passed = session.items.filter((x) => x.final === 'pass').length;
  const today = sessionsToday();
  const body = [
    para(`낱말 ${done}개를 연습했어요.`, 'lead'),
    passed ? para(`그중 ${passed}개를 또렷하게 말했어요.`) : para('소리 내어 연습한 것만으로도 큰 걸음이에요.'),
  ];
  if (today >= CONFIG.DAILY_SESSION_NUDGE) body.push(para('오늘 정말 많이 했어요. 쉬었다가 내일 해요.', 'note'));

  const next = stageSuggestion();
  const actions = [];
  if (next) {
    const up = next > state.settings.stage;
    body.push(card(
      h('p', { text: up ? `요즘 아주 잘하고 있어요. "${STAGES[next - 1].name}" 연습을 해 볼까요?` : `"${STAGES[next - 1].name}" 연습을 하면 더 편할 수 있어요. 바꿔 볼까요?` }),
      h('div', { class: 'row' },
        button('좋아요', async () => { state.settings.stage = next; state.settings.suggestAfter = state.sessions.length + 5; await sync.saveSettings(state.identity, state.settings); flushQuiet(); toast('연습 단계를 바꿨어요.'); screenHome(); }),
        button('이대로 할래요', async () => { state.settings.suggestAfter = state.sessions.length + 5; await sync.saveSettings(state.identity, state.settings); screenHome(); }, { kind: 'secondary' }))));
  }
  actions.push(button('한 번 더 할까요?', runSession), button('오늘은 여기까지', screenHome, { kind: 'secondary' }));
  screen({ guide: `오늘도 해냈어요! ${body.map((n) => n.textContent).join(' ')}`, title: '오늘도 해냈어요!', body, actions });
}

// ───────────── 홈 ─────────────

function practiceDays() {
  return new Set(state.sessions.map((x) => sync.dateKey(x.startedAt)));
}

async function screenHome() {
  const days = practiceDays().size;
  const st = STAGES[(state.settings.stage || 1) - 1];
  const outbox = await store.count('outbox');
  const notes = [];
  if (outbox > 0 && !navigator.onLine) notes.push(para('인터넷에 연결되면 기록을 안전하게 보관할게요.', 'note'));
  if (outbox > CONFIG.OUTBOX_MAX) notes.push(para('보내지 못한 기록이 많아요. 인터넷에 연결해 주세요.', 'warn'));
  if (state.env.isIOS) notes.push(h('p', { class: 'note' }, 'Safari 즐겨찾기에 넣어 두면 쉽게 열 수 있어요. ', h('button', { type: 'button', class: 'linkbtn', text: '방법 보기', onclick: () => screenInstall(screenHome) })));
  if (sessionsToday() >= CONFIG.DAILY_SESSION_NUDGE) notes.push(para('오늘 정말 많이 했어요. 쉬었다가 내일 해요.', 'note'));

  screen({
    guide: `${days ? `지금까지 ${days}일 연습했어요. ` : ''}오늘의 연습 버튼을 눌러 시작해요.`,
    title: days ? `지금까지 ${days}일 연습했어요` : '반가워요',
    body: [para(`지금 연습: ${st.name}`, 'lead'), notes],
    actions: [
      button('오늘의 연습', runSession, { kind: 'hero' }),
      h('div', { class: 'row' },
        button('나의 기록', screenDashboard, { kind: 'secondary' }),
        button('설정', screenSettings, { kind: 'secondary' })),
    ],
  });
}

// ───────────── 나의 기록 (PRD F-07) ─────────────

function dailyRates(days) {
  const out = [];
  const byDay = new Map();
  state.sessions.forEach((x) => x.items.forEach((it) => {
    if (it.final === 'listen' || it.stage === 1) return;
    const k = sync.dateKey(x.startedAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(it.bestRate || 0);
  }));
  for (let i = days - 1; i >= 0; i--) {
    const k = sync.dateKey(Date.now() - i * 86400000);
    const v = byDay.get(k);
    out.push({ k, v: v ? v.reduce((a, b) => a + b, 0) / v.length : null });
  }
  return out;
}

function lineChart(points) {
  const W = 360; const H = 200; const L = 34; const R = 12; const T = 14; const B = 30;
  const n = points.length;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - v) * (H - T - B);
  const grid = [0, 0.5, 1].map((v) => [
    s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }),
    s('text', { x: L - 6, y: y(v) + 5, 'text-anchor': 'end', class: 'axis' }, `${v * 100}`),
  ]);
  const pts = points.map((p, i) => ({ ...p, i })).filter((p) => p.v !== null);
  const path = pts.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const labels = [0, Math.floor((n - 1) / 2), n - 1].map((i, j) => s('text', { x: x(i), y: H - 10, 'text-anchor': ['start', 'middle', 'end'][j], class: 'axis' }, points[i].k.slice(5).replace('-', '/')));
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': '날짜별 알아들은 정도' },
    grid, labels,
    pts.length > 1 ? s('path', { d: path, class: 'line' }) : null,
    pts.map((p) => s('circle', { cx: x(p.i), cy: y(p.v), r: 4.5, class: 'dot' })));
}

function avg(arr) { const v = arr.filter((p) => p.v !== null).map((p) => p.v); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

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
    cells.push(h('div', { class: `cal-day${on ? ' on' : ''}`, 'aria-label': `${m + 1}월 ${d}일${on ? ' 연습함' : ''}` }, h('span', { text: String(d) })));
  }
  return h('div', {}, h('p', { class: 'cal-title', text: `${y}년 ${m + 1}월` }), h('div', { class: 'cal' }, cells));
}

function regainedWords() {
  const skippedAt = new Map();
  const out = [];
  state.sessions.forEach((x) => x.items.forEach((it) => {
    if (it.final === 'skip' && !skippedAt.has(it.text)) skippedAt.set(it.text, x.startedAt);
    if (it.final === 'pass' && skippedAt.has(it.text) && skippedAt.get(it.text) < x.startedAt && !out.includes(it.text)) out.push(it.text);
  }));
  return out.reverse();
}

function screenDashboard(range = 7) {
  const days = practiceDays().size;
  const series = dailyRates(range);
  const lastWeek = avg(dailyRates(7));
  const prevWeek = avg(dailyRates(14).slice(0, 7));
  let trend = '연습한 날이 쌓이면 변화를 보여 드릴게요.';
  if (lastWeek !== null && prevWeek !== null) {
    trend = lastWeek > prevWeek + 0.03 ? '지난주보다 더 잘 알아들었어요.' : '꾸준히 연습하고 있어요.';
  } else if (lastWeek !== null) trend = '이번 주에도 연습했어요.';
  const words = regainedWords();

  const body = [
    h('section', {}, h('h2', { text: '연습 달력' }), para(days ? `지금까지 ${days}일 연습했어요.` : '연습한 날에 도장이 찍혀요.'), calendar()),
    h('section', {},
      h('h2', { text: '알아들은 정도' }),
      para(trend),
      h('div', { class: 'row' },
        button('7일', () => screenDashboard(7), { kind: range === 7 ? 'primary' : 'secondary' }),
        button('30일', () => screenDashboard(30), { kind: range === 30 ? 'primary' : 'secondary' })),
      lineChart(series),
      para('세로축: 음성 인식기가 알아들은 정도(0~100). 발음 점수가 아니에요.', 'small')),
    h('section', {},
      h('h2', { text: '다시 성공한 낱말' }),
      words.length
        ? h('ul', { class: 'wordlist' }, words.map((w) => h('li', {}, h('span', { text: w }), button('듣기', () => speakWord(w), { kind: 'ghost', iconName: 'speaker' }))))
        : para('예전에 어려웠던 낱말을 다시 성공하면 여기에 모여요.')),
  ];
  screen({
    guide: `${days ? `지금까지 ${days}일 연습했어요. ` : ''}${trend}${words.length ? ` 다시 성공한 낱말이 ${words.length}개 있어요.` : ''}`,
    title: '나의 기록',
    body,
    actions: [button('처음 화면으로', screenHome, { kind: 'secondary' })],
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
      settingRow('연습 단계', STAGES[(st.stage || 1) - 1].name, button('바꾸기', screenStagePicker, { kind: 'secondary' })),
      settingRow('나만의 낱말', `${state.customWords.length}개`, button('바꾸기', screenCustomWords, { kind: 'secondary' })),
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
      para(speech.usesOnDevice() ? '음성은 이 기기 안에서 글자로 바꾸고 있어요.' : '음성은 글자로 바꾸기 위해 브라우저 회사 서버로 잠깐 보내져요. 저장하지는 않아요.', 'small'),
    ],
    actions: [button('처음 화면으로', screenHome, { kind: 'secondary' })],
  });
}

function screenStagePicker() {
  screen({
    guide: '연습 단계를 골라 주세요.',
    title: '연습 단계',
    body: [h('div', { class: 'choices col' }, STAGES.map((st) => h('button', {
      type: 'button', class: `choice${state.settings.stage === st.stage ? ' selected' : ''}`,
      onclick: async () => { state.settings.stage = st.stage; await sync.saveSettings(state.identity, state.settings); flushQuiet(); screenSettings(); },
    }, h('span', { text: `${st.stage}. ${st.name}` }), h('small', { text: st.desc }))))],
    actions: [button('뒤로', screenSettings, { kind: 'secondary' })],
  });
}

function screenCustomWords() {
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
    guide: '가족 이름, 자주 가는 곳, 필요한 물건처럼 자주 쓰는 낱말을 넣어 주세요. 넣은 낱말은 연습에 먼저 나와요.',
    title: '나만의 낱말',
    body: [
      para('가족 이름, 자주 가는 곳, 필요한 물건을 넣어 주세요. 연습에 먼저 나와요. 잠가서 보관하니 운영자는 볼 수 없어요.', 'lead'),
      h('div', { class: 'row' }, input, button('넣기', add)), msg, list,
    ],
    actions: [button('뒤로', screenSettings, { kind: 'secondary' })],
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
