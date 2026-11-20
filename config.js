// 음성 인식(STT)·합성(TTS)·음량 측정 (PRD F-02, F-04, 6.1)

import { CONFIG } from './config.js';

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

// ── 환경 ──

export function detectEnv() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua);
  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  return {
    stt: !!SR,
    tts: 'speechSynthesis' in globalThis,
    secure: globalThis.isSecureContext === true,
    crypto: !!(globalThis.crypto && globalThis.crypto.subtle),
    idb: 'indexedDB' in globalThis,
    mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    inApp,
    isIOS,
    isIPhone,
    standalone,
    fullscreen: !isIPhone && !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen),
    online: navigator.onLine,
  };
}

export function isSupported(env) {
  // iPhone·iPad의 '홈 화면 앱'에서는 Safari 음성 인식이 동작하지 않음(WebKit 미지원) → Safari로 열도록 안내
  if (env.isIOS && env.standalone) return false;
  return env.stt && env.tts && env.secure && env.crypto && env.mic && !env.inApp;
}

// ── TTS ──

let voicesCache = null;

/** 기기에 있는 한국어 목소리 목록 (비동기로 로드되므로 잠깐 기다림) */
export function getKoreanVoices() {
  if (!('speechSynthesis' in globalThis)) return Promise.resolve([]);
  if (voicesCache && voicesCache.length) return Promise.resolve(voicesCache);
  return new Promise((resolve) => {
    const pick = () => speechSynthesis.getVoices().filter((v) => /^ko(-|_|$)/i.test(v.lang));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      voicesCache = pick();
      resolve(voicesCache);
    };
    const now = pick();
    if (now.length) { voicesCache = now; resolve(now); return; }
    speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1500);
  });
}

/** 말하기. 끝나면 resolve. 이전 발화는 멈춥니다. */
export async function speak(text, { voiceName = '', rate = 1.0 } = {}) {
  if (!('speechSynthesis' in globalThis) || !text) return;
  const voices = await getKoreanVoices();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = rate;
    const v = voices.find((x) => x.name === voiceName) || voices[0];
    if (v) u.voice = v;
    const t = setTimeout(resolve, Math.max(4000, text.length * 600 / rate)); // 일부 브라우저의 end 누락 대비
    u.onend = () => { clearTimeout(t); resolve(); };
    u.onerror = () => { clearTimeout(t); resolve(); };
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}

// ── 마이크 ──

/** @returns {'granted'|'denied'|'nodevice'} */
export async function requestMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch (e) {
    if (e && (e.name === 'NotFoundError' || e.name === 'NotReadableError' || e.name === 'OverconstrainedError')) return 'nodevice';
    return 'denied';
  }
}

/** 마이크 음량을 ms 동안 재고, onLevel(rms)로 실시간 전달. 평균·최대 RMS 반환. */
export async function withLevelMeter(fn) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  const ctx = new Ctx();
  try { await ctx.resume(); } catch { /* 무시 */ }
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const read = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  };
  try {
    return await fn(read);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    try { await ctx.close(); } catch { /* 무시 */ }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 주변 소음 측정 (녹음 직전) */
export async function measureAmbient(ms = CONFIG.AMBIENT_SAMPLE_MS) {
  return withLevelMeter(async (read) => {
    const vals = [];
    const end = Date.now() + ms;
    while (Date.now() < end) { vals.push(read()); await sleep(50); }
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)] || 0; // 중앙값
  });
}

/**
 * 단계 1 발성 판정: 주변보다 충분히 큰 소리가 PHONATION_MS 이상 이어지면 통과.
 * @returns {{passed:boolean, longestMs:number, silent:boolean}}
 */
export async function phonationTest({ onLevel, signal } = {}) {
  return withLevelMeter(async (read) => {
    const ambient = [];
    for (let i = 0; i < 8; i++) { ambient.push(read()); await sleep(50); }
    ambient.sort((a, b) => a - b);
    const base = ambient[4] || 0;
    const threshold = Math.max(base * 3, 0.02);
    let runStart = 0;
    let longest = 0;
    let anySound = false;
    const deadline = Date.now() + CONFIG.SILENCE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) break;
      const lv = read();
      onLevel?.(Math.min(1, lv / (threshold * 3)));
      const now = Date.now();
      if (lv >= threshold) {
        anySound = true;
        if (!runStart) runStart = now;
        longest = Math.max(longest, now - runStart);
        if (longest >= CONFIG.PHONATION_MS) break;
      } else if (runStart && now - runStart > 0) {
        runStart = 0; // 끊기면 다시
      }
      await sleep(40);
    }
    onLevel?.(0);
    return { passed: longest >= CONFIG.PHONATION_MS, longestMs: longest, silent: !anySound };
  });
}

// ── STT ──

let onDeviceState = null; // null(미확인) | true | false

/** 기기 내 한국어 인식을 쓸 수 있는지 확인 (PRD v1.2 F-04). 가능하면 설치도 시도. */
export async function prepareOnDevice({ install = false } = {}) {
  if (!SR || typeof SR.available !== 'function') { onDeviceState = false; return false; }
  try {
    const opts = { langs: ['ko-KR'], processLocally: true };
    let status = await SR.available(opts);
    if ((status === 'downloadable' || status === 'downloading') && install && typeof SR.install === 'function') {
      await SR.install(opts);
      status = await SR.available(opts);
    }
    onDeviceState = status === 'available';
  } catch {
    onDeviceState = false;
  }
  return onDeviceState;
}

export function usesOnDevice() { return onDeviceState === true; }

/**
 * 한 번 듣기. 말이 멈추면 자동으로 끝납니다.
 * @returns {Promise<{alternatives:string[], error?:string}>}
 *   error: 'no-speech' | 'not-allowed' | 'audio-capture' | 'network' | 'aborted' | ...
 */
export function recognizeOnce({ onSpeechStart, signal } = {}) {
  return new Promise((resolve) => {
    if (!SR) { resolve({ alternatives: [], error: 'unsupported' }); return; }
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    if (onDeviceState === true) { try { rec.processLocally = true; } catch { /* 무시 */ } }

    let alternatives = [];
    let error = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      if (!alternatives.length && !error) error = 'no-speech';
      resolve(alternatives.length ? { alternatives } : { alternatives, error });
    };
    const onAbort = () => { error = 'aborted'; try { rec.abort(); } catch { /* 무시 */ } finish(); };
    const timer = setTimeout(() => { try { rec.stop(); } catch { /* 무시 */ } setTimeout(finish, 1200); }, CONFIG.SILENCE_TIMEOUT_MS);

    rec.onspeechstart = () => onSpeechStart?.();
    rec.onsoundstart = () => onSpeechStart?.();
    rec.onresult = (ev) => {
      const list = [];
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        for (let k = 0; k < r.length; k++) if (r[k].transcript) list.push(r[k].transcript.trim());
      }
      if (list.length) alternatives = list;
    };
    rec.onerror = (ev) => { error = ev.error || 'unknown'; };
    rec.onend = finish;
    signal?.addEventListener?.('abort', onAbort);
    try { rec.start(); } catch { error = 'start-failed'; finish(); }
  });
}
