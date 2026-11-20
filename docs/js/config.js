// 말하기 짝꿍 설정값. 배포 전에 GAS_URL만 바꾸면 됩니다.
// (v1.x에서 쓰던 config.js를 그대로 두어도 v2.0이 동작합니다. 아래 값들은 예전 파일에도 모두 있습니다.)
export const CONFIG = Object.freeze({
  // GAS 웹앱 배포 URL (…/exec). index.html의 CSP connect-src에도 같은 도메인이 허용되어 있어야 합니다.
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz2-77a7NNQlVV_p1_E5vTlb4Kezw7N6q80aPFAwECMaWYqSRpGyZTnv9ORsRj3JMyw/exec',

  // 복구 코드 → 열쇠 유도 (PBKDF2-SHA256). 바꾸면 기존 복구 코드가 모두 무효가 됩니다.
  PBKDF2_ITERATIONS: 600000,
  KDF_SALT: 'malhagi-jjakkung/recovery/v1',

  // 나만의 낱말
  MAX_CUSTOM_WORDS: 30,
  CUSTOM_WORD_MAX_LEN: 20,

  // 오프라인 대기열
  OUTBOX_MAX: 500,
  PUSH_BATCH: 50,

  CONSENT_VERSION: '2026-11-v2',
});
