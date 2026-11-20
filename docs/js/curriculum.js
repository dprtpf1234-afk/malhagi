// 기본 단어장 (PRD F-03)
// ※ 아래 목록은 개발용 샘플입니다. 출시 전 언어재활사 검수를 거친 목록으로 바꾸세요.
//   운영 중에는 GAS 시트 'curriculum'에 넣으면 이 목록 대신 사용됩니다.
// mode 'phonation' = 단계 1(음량·지속시간 판정), 그 외는 음성 인식 판정.
// accept = 인식기가 다르게 적어도 맞는 것으로 볼 표기 (숫자 표기 등)

export const STAGES = [
  { stage: 1, name: '소리 내기', desc: '모음을 길게 소리 내요' },
  { stage: 2, name: '한 글자', desc: '자주 쓰는 한 글자 말' },
  { stage: 3, name: '두 글자 낱말', desc: '두 글자 낱말' },
  { stage: 4, name: '긴 낱말', desc: '세 글자 이상 낱말' },
  { stage: 5, name: '짧은 표현', desc: '짧은 말과 인사' },
  { stage: 6, name: '문장', desc: '짧은 문장' },
];

const RAW = {
  1: ['아', '이', '우', '오', '에'],
  2: ['물', '밥', '네', '집', '차', '손', '발', '눈', '코', '옷', '약', '빵'],
  3: ['엄마', '아빠', '사과', '우유', '의자', '가방', '시계', '안경', '모자', '바지', '치약', '수건'],
  4: ['화장실', '텔레비전', '냉장고', '할머니', '할아버지', '휴대폰', '자동차', '컴퓨터', '비빔밥', '선풍기', '신호등', '엘리베이터'],
  5: ['물 주세요', '집에 가요', '배고파요', '고마워요', '괜찮아요', '도와주세요', '안녕하세요', '사랑해요', '잠깐만요', '아파요', '잘 잤어요', '화장실 가고 싶어요'],
  6: ['오늘 날씨가 좋아요', '밥을 먹었어요', '텔레비전을 켜 주세요', '산책하러 가고 싶어요', '물 한 잔 주세요', '병원에 가야 해요', '내일 다시 만나요', '약을 먹을 시간이에요', '창문을 열어 주세요', '가족과 함께 있어요'],
};

const ACCEPT = {
  '물 한 잔 주세요': ['물 1잔 주세요'],
  '휴대폰': ['핸드폰'],
  '텔레비전': ['티비', 'TV'],
};

export const BUILTIN = Object.entries(RAW).flatMap(([stage, words]) =>
  words.map((text, i) => ({ id: `b${stage}-${i + 1}`, stage: Number(stage), text, accept: ACCEPT[text] || [] })));

/** 진단용 5문항: 단계 1~5에서 하나씩 */
export const DIAGNOSIS = [
  { id: 'd1', stage: 1, text: '아' },
  { id: 'd2', stage: 2, text: '물' },
  { id: 'd3', stage: 3, text: '사과' },
  { id: 'd4', stage: 4, text: '화장실' },
  { id: 'd5', stage: 5, text: '물 주세요' },
];

export function modeOf(item) { return item.stage === 1 ? 'phonation' : 'speech'; }

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 세션 문항 만들기 (PRD F-03, F-05):
 * 나만의 단어(최대 5) → 재출제 단어(최대 3, 세션 중간) → 현재 단계 단어(최근에 통과한 것은 뒤로)
 */
export function buildSession({ items, stage, customWords, reaskQueue, recentPassed, size, maxCustom, maxReask }) {
  const out = [];
  const used = new Set();
  const push = (it) => { if (!used.has(it.text) && out.length < size) { used.add(it.text); out.push(it); } };

  shuffle(customWords).slice(0, maxCustom).forEach((w) => push({ id: `c-${w}`, stage: Math.max(2, stage), text: w, accept: [], custom: true }));

  const pool = items.filter((it) => it.stage === stage);
  const fresh = shuffle(pool.filter((it) => !recentPassed.has(it.text)));
  const seen = shuffle(pool.filter((it) => recentPassed.has(it.text)));
  const regular = [...fresh, ...seen];

  const reask = reaskQueue.slice(0, maxReask);
  const half = Math.max(out.length, Math.floor(size / 2));
  for (const it of regular) {
    if (out.length >= half) break;
    push(it);
  }
  reask.forEach((it) => push({ ...it, reask: true }));
  for (const it of regular) push(it);
  // 단어가 모자라면 이웃 단계에서 채움
  if (out.length < size) shuffle(items.filter((it) => Math.abs(it.stage - stage) === 1)).forEach(push);
  return out;
}
