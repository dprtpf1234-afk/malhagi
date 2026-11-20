// 낱말·문장 단어장 (PRD v2.0 F-03)
// ※ 아래 목록은 개발용 초안입니다. 출시 전 언어재활사 검수를 거쳐 주세요.
//   운영 중에는 GAS 데이터 시트의 'curriculum' 탭에 넣으면 이 목록 대신 사용됩니다
//   (열: item_id, type(word/sentence), category, text, reviewed_by, active).

export const WORD_CATEGORIES = [
  { id: 'family', name: '가족·사람', items: ['엄마', '아빠', '할머니', '할아버지', '아들', '딸', '남편', '아내', '형', '누나', '오빠', '언니', '동생', '손자', '손녀', '친구', '이웃', '선생님'] },
  { id: 'food', name: '음식·음료', items: ['밥', '물', '국', '김치', '빵', '우유', '사과', '바나나', '귤', '계란', '고기', '생선', '두부', '반찬', '죽', '라면', '커피', '녹차', '주스', '과자'] },
  { id: 'home', name: '집·생활용품', items: ['의자', '침대', '이불', '베개', '휴지', '수건', '칫솔', '치약', '비누', '컵', '숟가락', '젓가락', '그릇', '안경', '시계', '열쇠', '리모컨', '텔레비전', '휴대폰', '냉장고'] },
  { id: 'body', name: '몸', items: ['머리', '얼굴', '눈', '코', '입', '귀', '이', '혀', '목', '어깨', '팔', '손', '손가락', '가슴', '배', '허리', '다리', '무릎', '발'] },
  { id: 'health', name: '병원·건강', items: ['병원', '약국', '약', '의사', '간호사', '주사', '진료', '처방전', '체온', '혈압', '감기', '기침', '두통', '휠체어', '지팡이', '보청기', '물리치료', '재활'] },
  { id: 'place', name: '장소', items: ['집', '방', '거실', '부엌', '화장실', '시장', '마트', '은행', '우체국', '공원', '식당', '미용실', '교회', '성당', '절', '경로당', '복지관', '주민센터'] },
  { id: 'transport', name: '교통·이동', items: ['버스', '지하철', '택시', '기차', '자동차', '자전거', '정류장', '지하철역', '엘리베이터', '계단', '신호등', '횡단보도', '주차장', '표', '왼쪽', '오른쪽', '앞', '뒤'] },
  { id: 'clothes', name: '옷·몸단장', items: ['옷', '바지', '치마', '셔츠', '양말', '신발', '모자', '장갑', '목도리', '잠옷', '단추', '지퍼', '가방', '빗', '거울', '로션'] },
  { id: 'time', name: '시간·날씨', items: ['아침', '점심', '저녁', '밤', '오늘', '내일', '어제', '주말', '봄', '여름', '가을', '겨울', '비', '눈', '바람', '햇빛', '구름', '우산'] },
  { id: 'number', name: '숫자·돈', items: ['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '일', '이', '삼', '사', '오', '백', '천', '만', '원', '돈'] },
  { id: 'nature', name: '동물·자연', items: ['강아지', '고양이', '새', '물고기', '닭', '소', '꽃', '나무', '풀', '산', '바다', '강', '하늘', '해', '달', '별'] },
  { id: 'activity', name: '하는 일', items: ['먹다', '마시다', '자다', '씻다', '걷다', '앉다', '서다', '보다', '듣다', '말하다', '읽다', '쓰다', '웃다', '울다', '가다', '오다', '주다', '받다'] },
];

export const SENTENCE_CATEGORIES = [
  { id: 'greeting', name: '인사', items: ['안녕하세요', '안녕히 가세요', '안녕히 주무세요', '잘 잤어요?', '고맙습니다', '미안합니다', '괜찮아요', '반가워요', '또 만나요', '수고하셨습니다'] },
  { id: 'help', name: '도움 요청', items: ['도와주세요', '물 좀 주세요', '화장실 가고 싶어요', '잠깐만요', '천천히 말해 주세요', '다시 말해 주세요', '일으켜 주세요', '불 좀 켜 주세요', '창문 좀 열어 주세요', '휴대폰 좀 주세요'] },
  { id: 'meal', name: '식사', items: ['배고파요', '배불러요', '맛있어요', '밥 주세요', '물 마시고 싶어요', '조금 더 주세요', '그만 먹을래요', '너무 뜨거워요', '너무 차가워요', '잘 먹었습니다'] },
  { id: 'condition', name: '몸 상태·병원', items: ['아파요', '머리가 아파요', '배가 아파요', '열이 나요', '어지러워요', '약 먹을 시간이에요', '많이 좋아졌어요', '숨쉬기 힘들어요', '잠이 안 와요', '병원에 가고 싶어요'] },
  { id: 'feeling', name: '마음 표현', items: ['기분이 좋아요', '슬퍼요', '걱정돼요', '행복해요', '심심해요', '피곤해요', '졸려요', '답답해요', '사랑해요', '보고 싶어요'] },
  { id: 'family', name: '가족과 대화', items: ['어디 가요?', '언제 와요?', '같이 가요', '전화해 주세요', '오늘 뭐 했어요?', '밥 먹었어요?', '조심히 다녀와요', '일찍 와요', '잘 지냈어요?', '고생 많았어요'] },
  { id: 'outing', name: '외출·장보기', items: ['이거 얼마예요?', '이거 주세요', '카드로 할게요', '영수증 주세요', '화장실이 어디예요?', '정류장이 어디예요?', '여기서 내려 주세요', '집에 가고 싶어요', '산책하러 가요', '천천히 걸어요'] },
  { id: 'daily', name: '시간·날씨', items: ['오늘 날씨가 좋아요', '비가 와요', '추워요', '더워요', '지금 몇 시예요?', '오늘이 무슨 요일이에요?', '좋은 아침이에요', '내일 만나요', '주말에 봐요', '눈이 와요'] },
];

export const CUSTOM_ID = 'custom';
export const TODAY_WORDS = 10;
export const TODAY_SENTENCES = 5;

/** 서버 단어장(있으면)으로 분야 목록 만들기. 형식이 맞는 항목이 없으면 기본 목록. */
export function buildCatalog(serverItems) {
  const valid = (serverItems || []).filter((x) => x && (x.type === 'word' || x.type === 'sentence') && x.category && x.text);
  const fromServer = (type) => {
    const map = new Map();
    valid.filter((x) => x.type === type).forEach((x) => {
      if (!map.has(x.category)) map.set(x.category, { id: `s-${map.size}`, name: x.category, items: [] });
      const cat = map.get(x.category);
      if (!cat.items.includes(x.text)) cat.items.push(x.text);
    });
    return [...map.values()];
  };
  const words = fromServer('word');
  const sentences = fromServer('sentence');
  return {
    word: words.length ? words : WORD_CATEGORIES,
    sentence: sentences.length ? sentences : SENTENCE_CATEGORIES,
  };
}

// 날짜로 정해지는 섞기: 같은 날에는 어느 기기에서 열어도 같은 '오늘의 낱말·문장'
function seeded(seedText) {
  let h = 2166136261;
  for (const ch of seedText) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 오늘의 낱말·문장 (PRD v2.0 F-03).
 * 낱말: 여러 분야에서 고루 뽑고, 나만의 낱말이 있으면 최대 3개를 넣음.
 * 문장: 여러 상황에서 고루 뽑음.
 * @returns {{text:string, type:'word'|'sentence', category:string}[]}
 */
export function todaySet(type, dateKey, catalog, customWords = []) {
  const rand = seeded(`${type}|${dateKey}`);
  const cats = catalog[type];
  const size = type === 'word' ? TODAY_WORDS : TODAY_SENTENCES;
  const out = [];
  const used = new Set();
  if (type === 'word') {
    seededShuffle(customWords, rand).slice(0, 3).forEach((t) => { used.add(t); out.push({ text: t, type, category: '나만의 낱말' }); });
  }
  // 분야를 돌아가며 하나씩 뽑아 고루 섞음
  const pools = seededShuffle(cats, rand).map((c) => ({ name: c.name, items: seededShuffle(c.items, rand) }));
  let guard = 0;
  while (out.length < size && guard++ < 500) {
    let added = false;
    for (const p of pools) {
      if (out.length >= size) break;
      const t = p.items.find((x) => !used.has(x));
      if (t) { used.add(t); out.push({ text: t, type, category: p.name }); added = true; }
    }
    if (!added) break;
  }
  return out;
}

/** 문장인지 낱말인지 (예전 기록처럼 type이 없을 때 추정) */
export function guessType(text) {
  return /\s|[?!.]$|요$|니다$/.test(text) && text.length > 2 ? 'sentence' : 'word';
}
