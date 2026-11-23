// 들려주기 (휴대폰에 있는 한국어 목소리 사용, 마이크는 쓰지 않음)

export function detectEnv() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    tts: 'speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis,
    crypto: !!(globalThis.crypto && globalThis.crypto.subtle) && globalThis.isSecureContext === true,
    isIOS,
    isIPhone: /iPhone|iPod/.test(ua),
    isAndroid: /Android/i.test(ua),
    isSamsung: /SamsungBrowser/i.test(ua),
    inApp: /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua),
    standalone: !!(globalThis.matchMedia?.('(display-mode: standalone)').matches
      || globalThis.matchMedia?.('(display-mode: fullscreen)').matches
      || navigator.standalone === true),
  };
}

export const RATES = Object.freeze([
  { value: 1, label: '보통' },
  { value: 0.9, label: '조금 천천히' },
  { value: 0.8, label: '천천히' },
]);

/** '천천히 듣기' 빠르기. 0.6보다 느리면 음성 엔진이 소리를 늘어뜨려 발음이 뭉개집니다. */
export const slowRate = (rate) => Math.max(0.6, Math.round((rate - 0.25) * 100) / 100);

let voicesCache = null;

const isKorean = (v) => /^ko([-_]|$)/i.test(v.lang || '') || /한국|korean/i.test(v.name || '');
// 고품질(향상된·프리미엄·신경망) 목소리를 앞에, 기기 안에서 만드는 목소리를 그다음에
const quality = (v) => (/premium|enhanced|neural|natural|향상|고품질|프리미엄/i.test(v.name) ? 2 : 0) + (v.localService !== false ? 1 : 0);

function readVoices() {
  try {
    return speechSynthesis.getVoices().filter(isKorean).sort((a, b) => quality(b) - quality(a));
  } catch {
    return [];
  }
}

/**
 * 한국어 목소리 목록. 휴대폰은 목록을 늦게(1~3초) 알려 주는 일이 많아 최대 4초까지 다시 확인합니다.
 */
export function getVoices({ refresh = false } = {}) {
  if (!('speechSynthesis' in globalThis)) return Promise.resolve([]);
  if (!refresh && voicesCache && voicesCache.length) return Promise.resolve(voicesCache);
  return new Promise((resolve) => {
    const now = readVoices();
    if (now.length) { voicesCache = now; resolve(now); return; }
    let done = false;
    let waited = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      voicesCache = readVoices();
      resolve(voicesCache);
    };
    try { speechSynthesis.addEventListener('voiceschanged', () => { if (readVoices().length) finish(); }); } catch { /* 무시 */ }
    const timer = setInterval(() => {
      waited += 250;
      if (readVoices().length || waited >= 4000) finish();
    }, 250);
  });
}

/** 화면에 보여 줄 목소리 이름 */
export function voiceLabel(v) {
  // 예: 'Yuna (Korean (South Korea))' → 'Yuna', 'Google 한국의' → 그대로
  return String(v.name || '').replace(/\s*\((?:Korean|한국어).*$/i, '').replace(/\s+/g, ' ').trim() || '기본 목소리';
}

/** 끝에 문장부호가 없으면 마침표를 붙여, 낱말 하나도 끝을 또렷하게 내려 읽게 합니다. */
export function forSpeech(text) {
  const t = String(text || '').trim();
  return /[.?!…]$/.test(t) ? t : `${t}.`;
}

let seq = 0;

/** 들려주기. 끝나면 resolve. 앞의 소리는 멈춥니다. */
export async function speak(text, { voice = '', rate = 1 } = {}) {
  if (!('speechSynthesis' in globalThis) || !text) return;
  const voices = await getVoices();
  const my = ++seq;
  const busy = speechSynthesis.speaking || speechSynthesis.pending;
  if (busy) speechSynthesis.cancel();
  try { speechSynthesis.resume(); } catch { /* 일부 Safari에서 멈춤 상태로 남는 문제 대비 */ }
  // 멈춘 직후 바로 말하면 휴대폰(특히 Android)에서 앞소리가 잘리는 일이 있어 잠깐 쉼
  await new Promise((r) => setTimeout(r, busy ? 150 : 30));
  if (my !== seq) return;
  await new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(forSpeech(text));
    u.lang = 'ko-KR';
    u.rate = rate;
    const v = voices.find((x) => x.voiceURI === voice || x.name === voice) || voices[0];
    if (v) { u.voice = v; u.lang = String(v.lang || 'ko-KR').replace('_', '-'); }
    const t = setTimeout(resolve, Math.max(4000, (text.length * 700) / rate)); // end 신호가 안 오는 브라우저 대비
    u.onend = () => { clearTimeout(t); resolve(); };
    u.onerror = () => { clearTimeout(t); resolve(); };
    speechSynthesis.speak(u);
  });
}

export function stop() {
  seq++;
  try {
    if ('speechSynthesis' in globalThis && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
  } catch { /* 무시 */ }
}
