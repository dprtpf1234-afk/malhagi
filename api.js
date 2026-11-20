// 한글 자모 분해와 인식 일치율 계산 (PRD F-04)
// 일치율 = 1 − (자모 편집거리 ÷ 목표 자모 수). 발음 정확도가 아니라 '인식기가 알아들은 정도'입니다.

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const KEEP = /[0-9A-Za-z가-힣]/;

/** 공백·문장부호를 뺀 글자 배열과, 각 글자의 원문 위치. */
export function normalizeWithMap(text) {
  const chars = [];
  const map = [];
  const src = Array.from(String(text || '').normalize('NFC'));
  src.forEach((ch, i) => {
    if (KEEP.test(ch)) {
      chars.push(ch.toLowerCase());
      map.push(i);
    }
  });
  return { chars, map, length: src.length };
}

/** 글자 하나 → 자모 배열. 한글 음절이 아니면 그 글자 자체. */
export function decomposeSyllable(ch) {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return [ch];
  const cho = Math.floor(code / 588);
  const jung = Math.floor((code % 588) / 28);
  const jong = code % 28;
  return jong ? [CHO[cho], JUNG[jung], JONG[jong]] : [CHO[cho], JUNG[jung]];
}

/** 문장 → [{j: 자모, s: 정규화된 글자 위치, role: 'cho'|'jung'|'jong'|'other'}] */
export function toUnits(chars) {
  const units = [];
  chars.forEach((ch, s) => {
    const parts = decomposeSyllable(ch);
    if (parts.length === 1) units.push({ j: parts[0], s, role: 'other' });
    else parts.forEach((j, k) => units.push({ j, s, role: ['cho', 'jung', 'jong'][k] }));
  });
  return units;
}

/**
 * 목표(target)와 인식 결과(hyp)를 자모 단위로 비교합니다.
 * @returns {{rate:number, distance:number, wrong:number[], firstWrong:{jamo:string, role:string}|null}}
 *   wrong: 어긋난 글자의 '원문(target) 기준' 위치 목록
 */
export function compare(target, hyp) {
  const t = normalizeWithMap(target);
  const h = normalizeWithMap(hyp);
  const tu = toUnits(t.chars);
  const hu = toUnits(h.chars);
  const n = tu.length;
  const m = hu.length;
  if (n === 0) return { rate: 0, distance: m, wrong: [], firstWrong: null };

  // 편집거리 DP
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let k = 0; k <= m; k++) dp[0][k] = k;
  for (let i = 1; i <= n; i++) {
    for (let k = 1; k <= m; k++) {
      const cost = tu[i - 1].j === hu[k - 1].j ? 0 : 1;
      dp[i][k] = Math.min(dp[i - 1][k] + 1, dp[i][k - 1] + 1, dp[i - 1][k - 1] + cost);
    }
  }

  // 역추적: 어긋난 목표 자모 표시
  const wrongUnit = new Array(n).fill(false);
  let i = n;
  let k = m;
  while (i > 0 || k > 0) {
    if (i > 0 && k > 0 && dp[i][k] === dp[i - 1][k - 1] + (tu[i - 1].j === hu[k - 1].j ? 0 : 1)) {
      if (tu[i - 1].j !== hu[k - 1].j) wrongUnit[i - 1] = true;
      i--; k--;
    } else if (i > 0 && dp[i][k] === dp[i - 1][k] + 1) {
      wrongUnit[i - 1] = true; // 빠진 자모
      i--;
    } else {
      // 끼어든 자모: 바로 앞(없으면 첫) 목표 자모에 표시
      wrongUnit[Math.max(0, i - 1)] = true;
      k--;
    }
  }

  const distance = dp[n][m];
  const rate = Math.max(0, 1 - distance / n);
  const wrongSyl = new Set();
  let firstWrong = null;
  tu.forEach((u, idx) => {
    if (!wrongUnit[idx]) return;
    wrongSyl.add(t.map[u.s]);
    if (!firstWrong) firstWrong = { jamo: u.j, role: u.role };
  });
  return { rate, distance, wrong: [...wrongSyl].sort((a, b) => a - b), firstWrong };
}

/**
 * 인식 후보 여러 개와 허용 표기(accept) 중 가장 잘 맞는 조합을 고릅니다.
 * 표시 위치(wrong)는 항상 원래 목표 문장(target) 기준입니다.
 */
export function bestMatch(target, alternatives, accept = []) {
  let best = { rate: 0, distance: Infinity, wrong: [], firstWrong: null, transcript: '' };
  const alts = (alternatives || []).filter((a) => typeof a === 'string' && a.trim());
  for (const alt of alts) {
    const main = compare(target, alt);
    if (main.rate > best.rate || (main.rate === best.rate && best.transcript === '')) {
      best = { ...main, transcript: alt };
    }
    for (const acc of accept) {
      const r = compare(acc, alt);
      if (r.rate > best.rate) {
        // 허용 표기로 더 잘 맞으면 점수만 반영하고, 표시 위치는 목표 기준으로 다시 계산
        const onTarget = compare(target, alt);
        best = { ...onTarget, rate: r.rate, transcript: alt, wrong: r.rate >= 0.999 ? [] : onTarget.wrong };
      }
    }
  }
  return best;
}

/** 겹받침 → 첫 자음 (힌트 그림 찾기용) */
const JONG_FIRST = { 'ㄳ': 'ㄱ', 'ㄵ': 'ㄴ', 'ㄶ': 'ㄴ', 'ㄺ': 'ㄹ', 'ㄻ': 'ㄹ', 'ㄼ': 'ㄹ', 'ㄽ': 'ㄹ', 'ㄾ': 'ㄹ', 'ㄿ': 'ㄹ', 'ㅀ': 'ㄹ', 'ㅄ': 'ㅂ' };
export function baseJamo(j) { return JONG_FIRST[j] || j; }
