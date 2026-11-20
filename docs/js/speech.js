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

/**
 * 기기에 있는 한국어 목소리 목록. 기기 안에서 만드는 목소리(localService)를 앞에 둡니다.
 * (일부 PC 브라우저의 온라인 목소리는 글자를 브라우저 회사 서버로 보내 소리를 만듭니다.)
 */
export function getKoreanVoices() {
  if (!('speechSynthesis' in globalThis)) return Promise.resolve([]);
  if (voicesCache && voicesCache.length) return Promise.resolve(voicesCache);
  const pick = () => speechSynthesis.getVoices()
    .filter((v) => /^ko(-|_|$)/i.test(v.lang))
    .sort((a, b) => Number(b.localService !== false) - Number(a.localService !== false));
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      voicesCache = pick();
      resolve(voicesCache);
    };
    const now = pick();
    if (now.length) { voicesCache = now; resolve(now); return; }
    speechSynthesis.addEventListener?.('voiceschanged', finish, { once: true });
    setTimeout(finish, 1500);
  });
}

let speakSeq = 0;

/** 말하기. 끝나면 resolve. 이전 발화는 멈춥니다. */
export async function speak(text, { voiceName = '', rate = 1.0 } = {}) {
  if (!('speechSynthesis' in globalThis) || !text) return;
  const voices = await getKoreanVoices();
  const my = ++speakSeq;
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = rate;
    const v = voices.find((x) => x.name === voiceName) || voices[0];
    if (v) u.voice = v;
    const t = setTimeout(resolve, Math.max(4000, (text.length * 600) / rate)); // 일부 브라우저의 end 누락 대비
    u.onend = () => { clearTimeout(t); resolve(); };
    u.onerror = () => { clearTimeout(t); resolve(); };
    // Chrome에서 cancel 직후 speak가 무시되는 문제를 피하려고 한 박자 쉼
    setTimeout(() => { if (my === speakSeq) speechSynthesis.speak(u); else resolve(); }, 30);
  });
}

export function stopSpeaking() {
  speakSeq++;
  if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}
