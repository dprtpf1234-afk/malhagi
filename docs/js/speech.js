// 음성 합성(TTS) (PRD v2.0 F-02)
// v2.0부터 음성 인식·마이크를 쓰지 않습니다. 기기에 있는 한국어 목소리로 들려주기만 합니다.

// ── 환경 ──

export function detectEnv() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  const isAndroid = /Android/i.test(ua);
  const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua);
  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches
    || globalThis.matchMedia?.('(display-mode: fullscreen)').matches
    || navigator.standalone === true;
  return {
    tts: 'speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis,
    secure: globalThis.isSecureContext === true,
    crypto: !!(globalThis.crypto && globalThis.crypto.subtle),
    idb: 'indexedDB' in globalThis,
    inApp,
    isIOS,
    isIPhone,
    isAndroid,
    standalone,
    online: navigator.onLine,
  };
}

export function isSupported(env) {
  return env.tts && env.secure && env.crypto && !env.inApp;
}

// ── TTS ──

let voicesCache = null;

const isKorean = (v) => /^ko([-_]|$)/i.test(v.lang || '') || /한국|korean/i.test(v.name || '');
// 고품질 목소리(향상된·프리미엄·신경망)를 앞에, 기기 안에서 만드는 목소리를 그다음에
const quality = (v) => (/premium|enhanced|neural|natural|향상|고품질|프리미엄/i.test(v.name) ? 2 : 0) + (v.localService !== false ? 1 : 0);

function readVoices() {
  return speechSynthesis.getVoices().filter(isKorean).sort((a, b) => quality(b) - quality(a));
}

/**
 * 기기에 있는 한국어 목소리 목록.
 * 휴대폰은 목록을 늦게(1~3초) 알려 주는 경우가 많아, 바로 비어 있으면 최대 4초까지 다시 확인합니다.
 * @param {{refresh?: boolean}} opts refresh: true면 저장해 둔 목록을 버리고 다시 찾음
 */
export function getKoreanVoices({ refresh = false } = {}) {
  if (!('speechSynthesis' in globalThis)) return Promise.resolve([]);
  if (!refresh && voicesCache && voicesCache.length) return Promise.resolve(voicesCache);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      voicesCache = readVoices();
      resolve(voicesCache);
    };
    const now = readVoices();
    if (now.length) { voicesCache = now; resolve(now); return; }
    speechSynthesis.addEventListener?.('voiceschanged', () => { if (readVoices().length) finish(); });
    let waited = 0;
    const timer = setInterval(() => {
      waited += 250;
      if (readVoices().length || waited >= 4000) finish();
    }, 250);
  });
}

/** 화면에 보여 줄 목소리 이름 (브라우저가 붙인 꼬리표 정리) */
export function voiceLabel(v) {
  return String(v.name || '').replace(/\s*\((Korean|한국어)[^)]*\)\s*/gi, ' ').trim() || '기본 목소리';
}

/**
 * 읽기 좋게 다듬기: 끝에 마침표가 없으면 붙여, 낱말 하나도 끝을 또렷하게 내려 읽게 함
 * (끝에 문장부호가 없으면 일부 음성 엔진이 끝음절을 짧게 끊거나 올려 읽음).
 */
export function forSpeech(text) {
  const t = String(text || '').trim();
  return /[.?!…]$/.test(t) ? t : `${t}.`;
}

let speakSeq = 0;

/** 말하기. 끝나면 resolve. 이전 발화는 멈춥니다. */
export async function speak(text, { voiceName = '', rate = 1.0 } = {}) {
  if (!('speechSynthesis' in globalThis) || !text) return;
  const voices = await getKoreanVoices();
  const my = ++speakSeq;
  const busy = speechSynthesis.speaking || speechSynthesis.pending;
  if (busy) speechSynthesis.cancel();
  try { speechSynthesis.resume(); } catch { /* 일부 Safari에서 멈춤 상태로 남는 문제 대비 */ }
  // 멈춘 직후 바로 말하면 휴대폰(특히 Android)에서 앞소리가 잘리는 경우가 있어 잠깐 쉼
  await new Promise((r) => setTimeout(r, busy ? 150 : 30));
  if (my !== speakSeq) return;
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(forSpeech(text));
    u.lang = 'ko-KR';
    u.rate = rate;
    const v = voices.find((x) => x.name === voiceName) || voices[0];
    if (v) { u.voice = v; u.lang = String(v.lang || 'ko-KR').replace('_', '-'); }
    const t = setTimeout(resolve, Math.max(4000, (text.length * 700) / rate)); // 일부 브라우저의 end 누락 대비
    u.onend = () => { clearTimeout(t); resolve(); };
    u.onerror = () => { clearTimeout(t); resolve(); };
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  speakSeq++;
  if ('speechSynthesis' in globalThis && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}
