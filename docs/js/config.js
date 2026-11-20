// 말하기 짝꿍 설정값. 배포 전에 GAS_URL만 바꾸면 됩니다.
export const CONFIG = Object.freeze({
  // GAS 웹앱 배포 URL (…/exec). index.html의 CSP connect-src에도 같은 도메인이 허용되어 있어야 합니다.
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz2-77a7NNQlVV_p1_E5vTlb4Kezw7N6q80aPFAwECMaWYqSRpGyZTnv9ORsRj3JMyw/exec',

  // 복구 코드 → 열쇠 유도 (PBKDF2-SHA256). 바꾸면 기존 복구 코드가 모두 무효가 됩니다.
  PBKDF2_ITERATIONS: 600000,
  KDF_SALT: 'malhagi-jjakkung/recovery/v1',

  // 판정 구간 (PRD F-04, 파일럿에서 조정)
  PASS_THRESHOLD: 0.9,
  PARTIAL_THRESHOLD: 0.6,
  MAX_ATTEMPTS: 3,

  // 세션 (PRD F-06)
  SESSION_SIZE: 10,
  MAX_CUSTOM_PER_SESSION: 5,
  MAX_REASK_PER_SESSION: 3,
  MAX_CUSTOM_WORDS: 30,
  CUSTOM_WORD_MAX_LEN: 20,
  DAILY_SESSION_NUDGE: 3,
  CONSECUTIVE_SKIP_SUGGEST: 3,

  // 녹음
  SILENCE_TIMEOUT_MS: 8000,
  PHONATION_MS: 2000,
  AMBIENT_CHECK: true,       // 녹음 직전 주변 소음 확인 (실기기에서 문제가 있으면 false)
  AMBIENT_SAMPLE_MS: 700,
  NOISE_RMS: 0.06,

  // 단계 조정 (PRD F-03)
  STAGE_WINDOW: 20,
  STAGE_UP_RATE: 0.8,
  STAGE_DOWN_RATE: 0.4,

  // 오프라인 큐
  OUTBOX_MAX: 500,
  PUSH_BATCH: 50,

  // 조음 그림(web/hints/<자모>.svg 40장)을 넣은 뒤 true로 바꾸세요.
  HINT_IMAGES: false,

  CONSENT_VERSION: '2026-11-v1',
});
