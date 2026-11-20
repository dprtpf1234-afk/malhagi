// 화면 구성 도우미. 사용자 입력은 항상 textContent로만 넣습니다(innerHTML 사용 금지).

const SVG_NS = 'http://www.w3.org/2000/svg';

/** h('button', {class:'btn', onclick}, '텍스트', 자식노드...) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** SVG 요소 만들기 */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// 아이콘 (항상 글자와 함께 씀)
const ICONS = {
  speaker: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z',
  expand: 'M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z',
  stop: 'M7 7h10v10H7z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  text: 'M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
  replay: 'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  slow: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7z',
  prev: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z',
  next: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
};
export function icon(name) {
  return s('svg', { viewBox: '0 0 24 24', width: 28, height: 28, 'aria-hidden': 'true', class: 'icon' },
    s('path', { d: ICONS[name] || '', fill: 'currentColor' }));
}

export function button(label, onclick, { kind = 'primary', iconName, iconRight = false, disabled = false, id } = {}) {
  // 클릭 이벤트 객체가 화면 함수의 인자로 넘어가지 않도록 감쌈
  const handler = onclick ? () => onclick() : undefined;
  return h('button', { type: 'button', class: `btn btn-${kind}`, onclick: handler, disabled, id },
    iconName && !iconRight ? icon(iconName) : null, h('span', { text: label }), iconName && iconRight ? icon(iconName) : null);
}

let toastTimer = null;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
