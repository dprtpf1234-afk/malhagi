// 글씨 크기 (PRD v1.4 F-02, 5.2)
// 화면의 모든 크기는 rem 기준이라 html의 --font-scale 하나로 전체가 함께 커집니다.
// 기기마다 화면 크기가 달라 이 값은 기기에만 저장하고 다른 기기와 맞추지 않습니다(개인정보 아님).

export const FONT_SIZES = Object.freeze([
  { value: 0.9, label: '작게' },
  { value: 1, label: '보통' },
  { value: 1.15, label: '크게' },
  { value: 1.3, label: '아주 크게' },
  { value: 1.5, label: '가장 크게' },
]);

const KEY = 'malhagi.fontScale';

export function getFontScale() {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (FONT_SIZES.some((s) => s.value === v)) return v;
  } catch { /* 저장소를 쓸 수 없는 환경 */ }
  return 1;
}

export function applyFontScale(value, { save = true } = {}) {
  document.documentElement.style.setProperty('--font-scale', String(value));
  // 큰 글씨에서는 아래쪽 버튼을 화면에 고정하지 않음(본문을 가리지 않게)
  document.documentElement.toggleAttribute('data-large-text', value >= 1.3);
  if (save) { try { localStorage.setItem(KEY, String(value)); } catch { /* 무시 */ } }
  window.dispatchEvent(new CustomEvent('fontscalechange', { detail: value }));
}

export function fontSizeLabel(value) {
  return (FONT_SIZES.find((s) => s.value === value) || FONT_SIZES[1]).label;
}

/**
 * 연습 낱말이 화면 폭보다 길면(긴 낱말 + 큰 글씨) 넘치지 않을 때까지 줄입니다.
 * 낱말 중간에서 줄을 바꾸지 않기 위해서입니다. 28px까지 줄여도 넘치는 아주 긴 낱말만
 * 마지막 수단으로 줄을 바꿉니다.
 */
export function fitWord(el, { minPx = 28 } = {}) {
  if (!el || !el.isConnected) return;
  el.style.fontSize = '';
  el.classList.remove('wrap-anyway');
  let size = parseFloat(getComputedStyle(el).fontSize);
  const overflows = () => el.scrollWidth > el.clientWidth + 1;
  let guard = 80;
  while (overflows() && size > minPx && guard-- > 0) {
    size = Math.max(minPx, size - 2);
    el.style.fontSize = `${size}px`;
  }
  if (overflows()) el.classList.add('wrap-anyway');
}
