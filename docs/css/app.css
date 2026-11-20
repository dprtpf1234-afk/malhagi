/* 말하기 짝꿍 – PRD 5장 디자인 정책
   파스텔은 면(배경·버튼·하이라이트)에만, 글자는 진한 색. 본문 24px(보통), 연습 낱말 48px 이상.
   글꼴: 모든 기기에서 Mac(Apple SD Gothic Neo)과 같은 모양이 되도록 Pretendard를 직접 제공 (fonts/fonts.css).
   글씨 크기: 모든 크기를 rem으로 잡고, html의 --font-scale 하나로 전체를 키움(설정 → 글씨 크기). */

:root {
  --bg: #FDFBF7;
  --surface: #FFFFFF;
  --ink: #2B2B2B;          /* 13.7:1 */
  --ink-2: #4E4A44;
  --accent-ink: #1F5F63;   /* 7.1:1 */
  --mint: #A8DADC;         /* 버튼 면 (글자 #2B2B2B, 9.26:1) */
  --mint-strong: #8FCDD0;
  --peach: #F4A261;        /* 보조 버튼 면 (6.87:1) */
  --hl-a: #DCEBFA;         /* 오답 하이라이트 1 */
  --hl-b: #FBE3CF;         /* 오답 하이라이트 2 */
  --line: #E6E0D6;
  --note: #F3F1EC;
  --warn-bg: #FCF4EA;
  --warn-ink: #8A4B12;
  --danger-bg: #F7E1DC;
  --radius: 16px;
  --font: 'Pretendard', 'Apple SD Gothic Neo', -apple-system, BlinkMacSystemFont, system-ui, 'Noto Sans KR', 'Malgun Gothic', sans-serif;
  --font-scale: 1;
}

* { box-sizing: border-box; }
html { font-size: calc(125% * var(--font-scale)); -webkit-text-size-adjust: 100%; }   /* 보통: 1rem = 20px. 브라우저 기본 글자 크기 설정도 따름 */
body {
  margin: 0; min-height: 100vh; min-height: 100dvh;
  background: var(--bg); color: var(--ink);
  font-family: var(--font); font-size: 1.2rem; line-height: 1.6;   /* 24px */
  word-break: keep-all; overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
#app { max-width: 720px; margin: 0 auto; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; padding: 0 1rem; }

h1 { font-size: 1.6rem; line-height: 1.35; margin: 0.6rem 0 0.8rem; font-weight: 600; outline: none; }
h2 { font-size: 1.25rem; margin: 1.4rem 0 0.5rem; font-weight: 600; }
p { margin: 0 0 0.8rem; }
.lead { font-size: 1.25rem; }
.small { font-size: 0.85rem; color: var(--ink-2); display: block; }
.note { background: var(--note); border-radius: 12px; padding: 0.8rem 1rem; font-size: 1rem; }
.warn { background: var(--warn-bg); color: var(--warn-ink); border-radius: 12px; padding: 0.8rem 1rem; font-size: 1rem; }
a.link, .linkbtn { color: var(--accent-ink); font-size: 1rem; text-decoration: underline; background: none; border: 0; padding: 0; font-family: inherit; cursor: pointer; }

/* 위쪽 막대: 아이콘 위, 짧은 글자 아래 (글씨를 키워도 한 줄에 들어가게) */
.topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.4rem; padding: 0.5rem 0; }
.topbar-right { display: flex; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end; }
.btn.btn-tool {
  flex-direction: column; gap: 0.1rem; min-height: 3rem; min-width: 3.2rem; padding: 0.3rem 0.45rem;
  font-size: 0.72rem; font-weight: 600; line-height: 1.15; white-space: nowrap;
  background: transparent; border: 2px solid var(--line); border-radius: 12px;
}
.btn.btn-tool .icon { width: 1.3rem; height: 1.3rem; }

/* 본문 */
.screen { flex: 1; display: flex; flex-direction: column; padding-bottom: 1rem; outline: none; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem; margin: 0.8rem 0; }
section { margin-bottom: 1rem; }

/* 아래쪽 버튼 (한 손 엄지 위치) */
.actions { position: sticky; bottom: 0; display: flex; flex-direction: column; gap: 0.8rem; padding: 0.9rem 0 1.2rem; background: var(--bg); border-top: 1px solid var(--line); box-shadow: 0 -6px 12px rgba(253,251,247,0.9); z-index: 2; }
.actions .check { margin: 0; }
html[data-large-text] .actions { position: static; box-shadow: none; }
.row { display: flex; gap: 0.8rem; flex-wrap: wrap; align-items: center; }
.row > * { flex: 1 1 0; min-width: 0; }
.actions .row > .btn-primary { flex: 2 1 0; }

/* 버튼: 최소 60×60px, 간격 16px */
.btn {
  min-height: 3.2rem; min-width: 3.2rem; padding: 0.6rem 1.2rem;
  border-radius: var(--radius); border: 2px solid transparent;
  font-family: inherit; font-size: 1.2rem; font-weight: 600; color: var(--ink);
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
}
.btn:focus-visible, .choice:focus-visible, .key:focus-visible, input:focus-visible { outline: 4px solid var(--accent-ink); outline-offset: 2px; }
.btn:disabled { opacity: 0.45; cursor: default; }
.btn-primary { background: var(--mint); }
.btn-primary:not(:disabled):active { background: var(--mint-strong); }
.btn-secondary { background: var(--surface); border-color: var(--line); }
.btn-ghost { background: transparent; border-color: var(--line); font-size: 0.95rem; min-height: 3rem; padding: 0.4rem 0.7rem; white-space: nowrap; gap: 0.3rem; }
.btn-danger { background: var(--danger-bg); color: #7A2418; }
.btn-hero { background: var(--mint); min-height: 4.2rem; font-size: 1.5rem; }
.btn-mic { background: var(--peach); min-height: 4.6rem; font-size: 1.4rem; }
.icon { flex: none; }

/* 선택 버튼 */
.choices { display: flex; flex-wrap: wrap; gap: 0.8rem; margin-bottom: 0.5rem; }
.choices.col { flex-direction: column; }
.choice {
  min-height: 3.2rem; padding: 0.6rem 1.1rem; border-radius: var(--radius);
  border: 2px solid var(--line); background: var(--surface); color: var(--ink);
  font-family: inherit; font-size: 1.1rem; display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; text-align: left;
}
.choices.col .choice { flex-direction: column; align-items: flex-start; }
.choice small { font-size: 0.85rem; color: var(--ink-2); }
.choice.selected { border-color: var(--accent-ink); background: #EEF7F7; font-weight: 600; }

/* 동의 */
.points { list-style: none; padding: 0; margin: 0 0 1rem; }
.points li { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 0.8rem 1rem; margin-bottom: 0.6rem; display: flex; flex-direction: column; }
.points li span { font-size: 1rem; color: var(--ink-2); }
.check { display: flex; gap: 0.8rem; align-items: flex-start; padding: 0.8rem; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); margin-bottom: 0.6rem; font-size: 1.05rem; cursor: pointer; }
.check input { width: 2rem; height: 2rem; flex: none; accent-color: var(--accent-ink); margin: 0; }
.steps { padding-left: 1.4rem; }
.steps li { margin-bottom: 0.5rem; }

/* 연습 화면 */
.progress { color: var(--ink-2); font-size: 1rem; text-align: center; margin: 0; }
.stage-word { position: relative; display: flex; justify-content: center; align-items: center; min-height: 9rem; margin: 1rem 0; }
.word { position: relative; z-index: 1; width: 100%; font-size: 3rem; font-weight: 600; text-align: center; line-height: 1.3; letter-spacing: 0.02em; overflow-wrap: normal; } /* 화면보다 길면 app.js의 fitWord가 줄임 */
.word .wg { display: inline-block; white-space: nowrap; } /* 띄어쓰기에서만 줄바꿈 */
.word.wrap-anyway .wg { display: inline; white-space: normal; overflow-wrap: anywhere; }
.word .ch { padding: 0 0.04em; border-radius: 8px; }
.word .hl-a, .word .hl-b { text-decoration: underline; text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
.word .hl-a { background: var(--hl-a); }
.word .hl-b { background: var(--hl-b); }
.ring { position: absolute; width: 9rem; height: 9rem; border-radius: 50%; background: var(--mint); opacity: 0; transform: scale(calc(0.85 + var(--lv, 0) * 0.4)); transition: opacity .2s, transform .1s; }
.ring.on { opacity: 0.35; animation: breathe 1.6s ease-in-out infinite; }
.ring.on.speaking { opacity: 0.55; }
@keyframes breathe { 50% { transform: scale(calc(1 + var(--lv, 0) * 0.4)); } }
.feedback { text-align: center; font-size: 1.3rem; font-weight: 600; min-height: 2.2rem; margin: 0.4rem 0; }
.gauge { height: 1rem; border-radius: 1rem; background: var(--note); overflow: hidden; margin: 0.4rem 1rem; }
.gauge-fill { height: 100%; width: 0; background: var(--mint-strong); transition: width .8s ease-out; }
.hint { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem; text-align: center; }
.hint p { margin: 0.4rem 0 0; font-size: 1.1rem; }
.hint-jamo { font-size: 3rem; font-weight: 600; color: var(--accent-ink); line-height: 1.2; }
.hint-img { display: block; max-width: 12rem; margin: 0.5rem auto; }
.hidden { display: none !important; }

/* 복구 코드 */
.code { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.6rem; margin: 1rem 0; }
.code span { font-family: var(--font); font-variant-numeric: tabular-nums; font-size: min(1.8rem, 8.5vw); font-weight: 600; letter-spacing: 0.12em; background: var(--surface); border: 2px solid var(--line); border-radius: 12px; padding: 0.4rem 0.7rem; }
.qr { display: block; width: 11rem; height: 11rem; margin: 0 auto 1rem; image-rendering: pixelated; }
.code-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr)); gap: 0.6rem; margin: 1rem 0; } /* 좁은 화면·큰 글씨에서는 2줄 이상으로 */
.code-box { width: 100%; min-width: 0; min-height: 3.4rem; padding: 0; font-family: var(--font); font-variant-numeric: tabular-nums; letter-spacing: 0.08em; font-size: 1.5rem; text-align: center; text-transform: uppercase; border: 2px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); }
.scan { width: 100%; border-radius: var(--radius); background: #000; }
input[type='text'] { font-family: inherit; font-size: 1.2rem; min-height: 3.2rem; padding: 0 0.8rem; border: 2px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); }

/* 기록 */
.cal-title { font-weight: 600; margin-bottom: 0.4rem; }
.cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.3rem; text-align: center; }
.cal-head { font-size: 0.85rem; color: var(--ink-2); }
.cal-day { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 0.95rem; }
.cal-day.on { background: var(--mint); font-weight: 600; }
.chart { width: 100%; height: auto; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); margin: 0.6rem 0; }
.chart .grid { stroke: var(--line); stroke-width: 1; }
.chart .axis { fill: var(--ink-2); font-size: 13px; font-family: var(--font); }
.chart .line { fill: none; stroke: var(--accent-ink); stroke-width: 2.5; stroke-linejoin: round; }
.chart .dot { fill: var(--accent-ink); }
.wordlist, .devices { list-style: none; padding: 0; margin: 0.6rem 0; }
.wordlist li, .devices li { display: flex; justify-content: space-between; align-items: center; gap: 0.8rem; padding: 0.6rem 0.8rem; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 0.5rem; }
.devices li { flex-direction: column; align-items: flex-start; }

/* 설정 */
.setting { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.6rem 1rem; padding: 0.8rem 0; border-bottom: 1px solid var(--line); }
.setting > div { flex: 1 1 10rem; }
.setting .btn { flex: none; }

/* 화면 잠금 */
.pin-dots { display: flex; justify-content: center; gap: 1rem; margin: 1rem 0; }
.pin-dots span { width: 1.2rem; height: 1.2rem; border-radius: 50%; border: 2px solid var(--ink-2); }
.pin-dots span.on { background: var(--ink); border-color: var(--ink); }
.keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem; max-width: 22rem; margin: 0 auto; }
.key { min-height: 4rem; font-size: 1.6rem; font-family: inherit; font-weight: 600; border-radius: var(--radius); border: 2px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; }

/* 기타 */
.spinner { width: 3.5rem; height: 3.5rem; margin: 2rem auto; border-radius: 50%; border: 6px solid var(--note); border-top-color: var(--accent-ink); animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
#toast { position: fixed; left: 50%; bottom: 7rem; transform: translateX(-50%) translateY(1rem); background: var(--ink); color: #fff; padding: 0.7rem 1.2rem; border-radius: 12px; font-size: 1rem; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; max-width: 90vw; z-index: 10; }
#toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
noscript p { padding: 2rem 1rem; }

/* 글씨 크기 창 */
.overlay { position: fixed; inset: 0; background: rgba(43,43,43,0.35); z-index: 20; display: flex; align-items: flex-end; justify-content: center; }
.sheet { width: 100%; max-width: 720px; max-height: 92vh; overflow-y: auto; background: var(--bg); border-radius: 20px 20px 0 0; padding: 1.2rem 1rem calc(1.2rem + env(safe-area-inset-bottom)); box-shadow: 0 -8px 24px rgba(0,0,0,0.12); }
.sheet h2 { margin-top: 0; outline: none; }
.size-sample { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 0.8rem 1rem; margin-bottom: 0.8rem; }
.size-options { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 0.8rem; }
.size-options .choice { justify-content: space-between; width: 100%; }
.size-options .choice .aa { font-weight: 600; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
