// 화면 조각 만들기 (사용자가 넣은 글자는 항상 글자로만 넣어 화면을 바꿀 수 없게 함)

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 버튼 (onClick은 인자 없이 부름) */
export function btn(label, onClick, { kind = 'secondary', cls = '', ...attrs } = {}) {
  return h('button', { type: 'button', class: `btn btn-${kind} ${cls}`.trim(), onclick: () => onClick(), ...attrs }, label);
}

// ── 글씨 크기 ──

export const FONT_SIZES = Object.freeze([
  { value: 0.9, label: '작게' },
  { value: 1, label: '보통' },
  { value: 1.15, label: '크게' },
  { value: 1.3, label: '아주 크게' },
  { value: 1.5, label: '가장 크게' },
]);
const FONT_KEY = 'malhagi.fontScale'; // 예전 버전과 같은 이름이라 고른 크기가 그대로 이어짐

export function getFontScale() {
  try {
    const v = Number(localStorage.getItem(FONT_KEY));
    if (FONT_SIZES.some((s) => s.value === v)) return v;
  } catch { /* 저장소를 쓸 수 없는 환경 */ }
  return 1;
}

export function applyFontScale(value, { save = true } = {}) {
  document.documentElement.style.setProperty('--font-scale', String(value));
  document.documentElement.toggleAttribute('data-large-text', value >= 1.3);
  if (save) { try { localStorage.setItem(FONT_KEY, String(value)); } catch { /* 무시 */ } }
}

/** 긴 낱말이 화면보다 넓으면 줄을 바꾸지 않고 글자를 줄여 맞춤 */
export function fitText(el, { minPx = 26 } = {}) {
  if (!el || !el.isConnected) return;
  el.style.fontSize = '';
  el.classList.remove('wrap-anyway');
  let size = parseFloat(getComputedStyle(el).fontSize);
  const over = () => el.scrollWidth > el.clientWidth + 1;
  let guard = 80;
  while (over() && size > minPx && guard-- > 0) {
    size = Math.max(minPx, size - 2);
    el.style.fontSize = `${size}px`;
  }
  if (over()) el.classList.add('wrap-anyway');
}

// ── 창(모달) ──

let openModal = null;

/**
 * 창 띄우기. actions: [{ label, value, kind }] → 누른 버튼의 value로 resolve (바깥·Esc·닫기는 null)
 */
export function modal({ title, body = [], actions = [{ label: '확인', value: true, kind: 'primary' }], dismissible = true }) {
  closeModal();
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const finish = (v) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      openModal = null;
      if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) finish(null); };
    const heading = h('h2', { id: 'modal-title', tabindex: '-1' }, title);
    const panel = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
      heading,
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' }, actions.map((a) => btn(a.label, () => finish(a.value), { kind: a.kind || 'secondary' }))));
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap && dismissible) finish(null); } }, panel);
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    openModal = { finish };
    heading.focus({ preventScroll: true });
  });
}

export function closeModal() {
  if (openModal) openModal.finish(null);
}

// ── 짧은 알림 ──

let toastTimer = 0;
export function toast(text) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function dateLabel(d, { weekday = true } = {}) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일${weekday ? ` ${WEEK[d.getDay()]}요일` : ''}`;
}
export const WEEKDAYS = WEEK;
