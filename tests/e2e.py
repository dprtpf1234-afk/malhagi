"""실제 브라우저(Chrome)로 처음부터 끝까지 돌려 보는 시험.

    node tests/dev-server.js 8787 &            # 백업 서버 있음 (가짜 Redis)
    NO_BACKUP=1 node tests/dev-server.js 8788 & # 백업 서버 없음
    python3 tests/e2e.py

목소리는 가짜 음성 합성으로 바꿔 끼워, 무엇을 몇 배속으로 읽었는지 기록합니다.
"""
import json, re, sys, os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:8787')
BASE_NOBACKUP = os.environ.get('BASE_NOBACKUP', 'http://localhost:8788')
SHOTS = os.environ.get('SHOTS', '/tmp/shots')
os.makedirs(SHOTS, exist_ok=True)

FAKE_TTS = """
(() => {
  window.__spoken = [];
  const voice = { name: 'Yuna (Korean (South Korea))', lang: 'ko-KR', voiceURI: 'yuna', localService: true, default: true };
  const voice2 = { name: 'Google 한국의', lang: 'ko-KR', voiceURI: 'google-ko', localService: false, default: false };
  class U { constructor(t) { this.text = t; this.rate = 1; this.lang = ''; this.voice = null; } }
  const synth = {
    speaking: false, pending: false,
    getVoices: () => [voice, voice2],
    addEventListener() {}, removeEventListener() {},
    cancel() { this.speaking = false; }, resume() {}, pause() {},
    speak(u) { this.speaking = true; window.__spoken.push({ text: u.text, rate: u.rate, voice: u.voice && u.voice.voiceURI });
      setTimeout(() => { this.speaking = false; u.onend && u.onend(); }, 30); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U;
})();
"""

ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  ok  ' if cond else '  FAIL') + f' {name}' + (f' — {detail}' if detail and not cond else ''))

NO_FULLSCREEN = """
Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false });
Element.prototype.requestFullscreen = undefined;
Element.prototype.webkitRequestFullscreen = undefined;
"""

def new_page(browser, ua=ANDROID_UA, width=390, height=844):
    ctx = browser.new_context(viewport={'width': width, 'height': height}, user_agent=ua, locale='ko-KR',
                              timezone_id='Asia/Seoul', device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.add_init_script(FAKE_TTS)
    if ua == IPHONE_UA: ctx.add_init_script(NO_FULLSCREEN)  # 아이폰 Safari는 전체화면을 지원하지 않음
    page = ctx.new_page()
    page.errors = []
    page.requests = []
    page.on('console', lambda m: page.errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.on('request', lambda r: page.requests.append(r.url))
    page.on('response', lambda r: page.errors.append(f'HTTP {r.status} {r.request.method} {r.url}') if r.status >= 400 else None)
    return ctx, page

def wait_js(page, expr, timeout=8000):
    """앱의 CSP가 eval을 막아 wait_for_function 대신 직접 반복 확인"""
    import time
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if page.evaluate(expr): return True
        except Exception:
            pass
        page.wait_for_timeout(100)
    raise AssertionError(f'timeout waiting for: {expr}')

def no_overflow(page):
    # 화면 밖(오른쪽)으로 삐져나온 요소가 하나도 없어야 함
    out = page.evaluate('''[...document.querySelectorAll('#app *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; }).map(e => e.className || e.tagName).slice(0, 5)''')
    if out: print('    넘친 요소:', out)
    return not out and page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

def click(page, name, exact=False):
    page.get_by_role('button', name=name, exact=exact).first.click()

def run_practice(page, n):
    for i in range(n):
        expect(page.locator('.step')).to_have_text(f'{i + 1} / {n}')
        wait_js(page, 'document.querySelector(".count") && /[1-9]/.test(document.querySelector(".count").textContent)')
        click(page, re.compile('마치기|다음'))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # ── 기기 1: 첫 설정 + 백업 켜기 ──
    print('기기 1: 첫 설정')
    ctx1, a = new_page(browser)
    a.goto(BASE + '/')
    expect(a.get_by_role('heading', name='말하기 짝꿍')).to_be_visible()
    click(a, '처음이에요')
    expect(a.get_by_role('heading', name='글씨 크기를 골라 주세요')).to_be_visible()
    click(a, '크게', exact=True)
    check('글씨 크기 크게가 바로 적용', a.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim()") == '1.15')
    click(a, '다음')
    expect(a.get_by_role('heading', name='시작하기 전에')).to_be_visible()
    expect(a.get_by_text('기록 백업 (선택)')).to_be_visible()
    start_btn = a.get_by_role('button', name=re.compile('시작하기$'))
    check('동의 전에는 기기에만 저장', '이 기기에만' in start_btn.inner_text())
    a.locator('#agree-backup').check()
    check('동의하면 백업 켜고 시작', '백업 켜고' in start_btn.inner_text())
    a.screenshot(path=f'{SHOTS}/01-intro.png', full_page=True)
    start_btn.click()
    expect(a.get_by_role('heading', name='목소리와 빠르기')).to_be_visible()
    expect(a.get_by_role('button', name='목소리 1 · Yuna', exact=True)).to_be_visible()
    expect(a.get_by_role('button', name=re.compile('목소리 2 · Google 한국의'))).to_be_visible()
    click(a, re.compile('목소리 2'))
    click(a, '조금 천천히')
    click(a, '들어 보기')
    wait_js(a, 'window.__spoken.length >= 2')
    last = a.evaluate('window.__spoken.at(-1)')
    check('들어 보기: 고른 목소리·빠르기, 끝에 마침표', last == {'text': '사과, 할머니, 물 좀 주세요.', 'rate': 0.9, 'voice': 'google-ko'}, json.dumps(last, ensure_ascii=False))
    a.screenshot(path=f'{SHOTS}/02-voice.png', full_page=True)
    click(a, '다음')
    expect(a.get_by_role('heading', name='복구 코드를 적어 두세요')).to_be_visible()
    code = ''.join(a.locator('.code-group').all_inner_texts())
    check('복구 코드 16자리', re.fullmatch(r'[2-9A-HJ-NP-Z]{16}', code) is not None, code)
    check('적어 두기 전에는 시작 못 함', a.get_by_role('button', name='시작하기').is_disabled())
    a.locator('#wrote').check()
    a.screenshot(path=f'{SHOTS}/03-code.png', full_page=True)
    click(a, '시작하기')

    # ── 홈 → 오늘의 낱말·문장 ──
    print('기기 1: 연습')
    expect(a.get_by_role('heading', name='오늘의 연습')).to_be_visible()
    check('오늘의 낱말 10개', a.get_by_text('10개 중 0개를 들었어요.').count() == 1)
    check('크게 글씨에서 위쪽 막대가 한 줄', a.evaluate("document.querySelector('.topbar').offsetHeight < 80"), str(a.evaluate("document.querySelector('.topbar').offsetHeight")))
    check('홈 화면이 넘치지 않음', no_overflow(a))
    a.screenshot(path=f'{SHOTS}/04-home.png', full_page=True)
    click(a, '시작하기')
    expect(a.locator('.step')).to_have_text('1 / 10')
    wait_js(a, 'window.__spoken.some(s => s.rate === 0.9 && !s.text.startsWith("사과, 할머니"))')
    expect(a.locator('.count')).to_have_text('들은 횟수 1번')
    word = a.locator('.target').inner_text()
    click(a, '다시 듣기')
    expect(a.locator('.count')).to_have_text('들은 횟수 2번')
    click(a, '천천히 듣기')
    expect(a.locator('.count')).to_have_text('들은 횟수 3번')
    a.wait_for_timeout(250)
    slow = a.evaluate('window.__spoken.at(-1)')
    check('천천히 듣기는 0.65배속 (0.9 - 0.25)', slow['rate'] == 0.65 and slow['text'] == word + '.', json.dumps(slow, ensure_ascii=False))
    a.screenshot(path=f'{SHOTS}/05-practice.png', full_page=True)
    spoken_before = a.evaluate('window.__spoken.length')
    a.get_by_role('button', name='전체화면').click()
    expect(a.get_by_role('button', name='전체화면 끄기')).to_be_visible()
    a.wait_for_timeout(500)
    check('연습 중 전체화면을 켜도 다시 재생되지 않음', a.evaluate('window.__spoken.length') == spoken_before and a.locator('.count').inner_text() == '들은 횟수 3번')
    a.get_by_role('button', name='전체화면 끄기').click()
    expect(a.get_by_role('button', name='전체화면', exact=True)).to_be_visible()
    check('이전 버튼은 첫 낱말에서 꺼짐', a.get_by_role('button', name='‹ 이전').is_disabled())
    click(a, '다음 ›')
    click(a, '‹ 이전')
    expect(a.locator('.count')).to_have_text(re.compile('들은 횟수 [34]번'))
    click(a, '다음 ›')
    # 2번째부터 끝까지
    for i in range(1, 10):
        expect(a.locator('.step')).to_have_text(f'{i + 1} / 10')
        wait_js(a, '/[1-9]/.test(document.querySelector(".count").textContent)')
        click(a, re.compile('마치기|다음'))
    expect(a.get_by_role('heading', name='잘하셨어요!')).to_be_visible()
    a.screenshot(path=f'{SHOTS}/06-done.png', full_page=True)
    click(a, '오늘의 문장 하기')
    run_practice(a, 5)
    expect(a.get_by_role('heading', name='잘하셨어요!')).to_be_visible()
    click(a, '처음 화면으로')
    expect(a.get_by_text('✓ 다 했어요')).to_have_count(2)
    check('홈에 두 목록 모두 완료 표시', a.get_by_text('✓ 다 했어요').count() == 2, a.locator('main').inner_text()[:400])

    # 분야별 낱말
    click(a, '분야별 낱말')
    expect(a.get_by_role('heading', name='분야별 낱말')).to_be_visible()
    click(a, re.compile('^교통·이동'))
    expect(a.get_by_role('heading', name='교통·이동')).to_be_visible()
    check('교통·이동 100개를 10개씩 10묶음', a.locator('.set').count() == 10)
    a.screenshot(path=f'{SHOTS}/06b-sets.png', full_page=True)
    click(a, '처음부터 시작하기')
    expect(a.locator('.tag')).to_have_text('교통·이동 1~10')
    for _ in range(8):
        if a.locator('.target').inner_text() == '엘리베이터': break
        click(a, '다음 ›')
    a.evaluate("document.documentElement.style.setProperty('--font-scale','1.5'); document.documentElement.setAttribute('data-large-text','')")
    a.evaluate("window.dispatchEvent(new Event('resize'))")
    a.wait_for_timeout(200)
    t = a.locator('.target')
    check('가장 큰 글씨에서도 긴 낱말이 한 줄', t.inner_text() == '엘리베이터' and a.evaluate("(() => { const e = document.querySelector('.target'); return e.scrollWidth <= e.clientWidth + 1 && e.getClientRects().length === 1 && e.offsetHeight < parseFloat(getComputedStyle(e).fontSize) * 2; })()"))
    check('가장 큰 글씨 연습 화면이 옆으로 넘치지 않음', no_overflow(a))
    a.screenshot(path=f'{SHOTS}/07-practice-largest.png', full_page=True)
    click(a, '다음 ›')
    click(a, '마치기 ✓')
    expect(a.get_by_role('heading', name='잘하셨어요!')).to_be_visible()
    click(a, '다음 10개 하기')
    expect(a.locator('.tag')).to_have_text('교통·이동 11~20')
    check('다음 10개 하기 → 11~20번', a.locator('.step').inner_text() == '1 / 10')
    wait_js(a, '/[1-9]/.test(document.querySelector(".count").textContent)')
    click(a, '‹ 그만하기')
    expect(a.get_by_role('heading', name='교통·이동')).to_be_visible()
    check('묶음 화면에 들은 묶음 표시 (1~10, 11~20)', a.locator('.set.done').count() + a.locator('.set.part').count() == 2 and a.locator('.set').nth(1).get_attribute('class') != 'set', str([a.locator('.set').nth(i).get_attribute('class') for i in range(3)]))
    check('가장 큰 글씨 묶음 화면이 넘치지 않음', no_overflow(a))
    a.get_by_role('button', name='홈', exact=True).click()

    # 글씨 크기 창
    a.get_by_role('button', name=re.compile('글씨 크기')).first.click()
    expect(a.get_by_role('dialog')).to_be_visible()
    a.get_by_role('dialog').get_by_role('button', name='가장 크게').click()
    check('글씨 크기 창에서 고르면 저장', a.evaluate("localStorage.getItem('malhagi.fontScale')") == '1.5')
    a.get_by_role('dialog').get_by_role('button', name='닫기').click()

    # 기록
    print('기기 1: 기록·설정')
    a.get_by_role('button', name='나의 기록').click()
    expect(a.get_by_role('heading', name='나의 기록')).to_be_visible()
    stats = a.locator('.stat strong').all_inner_texts()
    check('기록: 연습한 날 1일', stats[0] == '1일', str(stats))
    check('가장 큰 글씨 기록 화면이 넘치지 않음', no_overflow(a))
    a.screenshot(path=f'{SHOTS}/08-records-largest.png', full_page=True)
    a.locator('.cell.has.today').click()
    expect(a.get_by_role('heading', name='오늘 연습')).to_be_visible()
    check('오늘 낱말 기록에 10개 이상', int(re.search(r'낱말 (\d+)개', a.locator('main').inner_text()).group(1)) >= 10)

    # 나만의 낱말
    a.get_by_role('button', name='설정').last.click()
    click(a, re.compile('나만의 낱말·문장'))
    a.locator('#new-word').fill('영희')
    click(a, '넣기')
    a.locator('#new-word').fill('영희')
    click(a, '넣기')
    expect(a.get_by_text('이미 들어 있어요.')).to_be_visible()
    a.get_by_role('button', name='문장', exact=True).click()
    a.locator('#new-word').fill('영희야 밥 먹었니?')
    a.locator('#new-word').press('Enter')
    expect(a.get_by_text('나만의 낱말 1개')).to_be_visible()
    expect(a.get_by_text('나만의 문장 1개')).to_be_visible()
    check('가장 큰 글씨 설정 화면이 넘치지 않음', no_overflow(a))
    a.screenshot(path=f'{SHOTS}/09-mywords.png', full_page=True)

    # 백업
    click(a, '‹ 설정')
    click(a, re.compile('기록 백업'))
    click(a, '지금 백업하기')
    expect(a.locator('#toast')).to_have_text('백업했어요.', timeout=15000)
    check('마지막 백업 시각 표시', a.get_by_text(re.compile('마지막 백업:')).count() == 1)
    a.screenshot(path=f'{SHOTS}/10-backup.png', full_page=True)
    local = a.evaluate("JSON.parse(localStorage.getItem('malhagi.v3.data'))")
    check('기기 저장: 백업 켜짐·밀린 것 없음', local['backup']['on'] and not local['backup']['dirty'] and local['backup']['n'] >= 1, json.dumps(local['backup']))
    total_plays = sum(it['p'] for d in local['days'].values() for it in d['items'].values())

    # ── 기기 2 (아이폰): 복구 코드로 불러오기 ──
    print('기기 2: 불러오기')
    ctx2, b = new_page(browser, ua=IPHONE_UA)
    b.goto(BASE + '/')
    click(b, '다른 기기에서 쓰던 기록 불러오기')
    b.locator('#code').fill('abcd')
    click(b, '불러오기')
    expect(b.get_by_text('복구 코드는 16자리예요. 다시 확인해 주세요.')).to_be_visible()
    wrong = 'ABCDEFGHJKLMNPQR' if code != 'ABCDEFGHJKLMNPQR' else 'BBCDEFGHJKLMNPQR'
    b.locator('#code').fill(wrong)
    click(b, '불러오기')
    expect(b.get_by_text('이 복구 코드로 저장된 기록이 없어요. 코드를 다시 확인해 주세요.')).to_be_visible(timeout=15000)
    pretty = '-'.join([code[i:i + 4] for i in range(0, 16, 4)]).lower()
    b.locator('#code').fill(' ' + pretty + ' ')
    click(b, '불러오기')
    expect(b.get_by_role('heading', name='목소리와 빠르기')).to_be_visible(timeout=15000)
    click(b, '다음')
    expect(b.get_by_role('heading', name='오늘의 연습')).to_be_visible()
    check('불러온 기기에서도 오늘 목록 완료', b.get_by_text('✓ 다 했어요').count() == 2)
    check('아이폰 홈 화면 앱이 아니면 전체화면 버튼이 보임', b.get_by_role('button', name='전체화면').count() == 1)
    b.get_by_role('button', name='전체화면').click()
    expect(b.get_by_role('dialog')).to_be_visible()
    check('아이폰 전체화면 → 홈 화면 추가 안내', '공유 버튼' in b.get_by_role('dialog').inner_text())
    b.get_by_role('button', name='알겠어요').click()
    b.get_by_role('button', name='나의 기록').click()
    stats2 = b.locator('.stat strong').all_inner_texts()
    check('불러온 기록의 들은 횟수가 같음', stats2[2] == f'{total_plays}번', f'{stats2} vs {total_plays}')
    b.get_by_role('button', name='설정').last.click()
    rows = b.locator('.rows').first.inner_text()
    check('나만의 낱말·문장도 불러옴', '나만의 낱말·문장\n2개' in rows or '2개' in rows, rows)

    # 기기 2에서 연습 → 기기 1과 합쳐짐
    b.get_by_role('button', name='홈', exact=True).click()
    click(b, '분야별 문장')
    click(b, re.compile('^나만의 문장'))
    expect(b.locator('.target')).to_have_text('영희야 밥 먹었니?')
    wait_js(b, '/1번/.test(document.querySelector(".count").textContent)')
    click(b, '마치기 ✓')
    b.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    b.wait_for_timeout(300)
    # 어제 기록 만들어 넣고 다시 열기
    b.evaluate("""(() => {
      const d = JSON.parse(localStorage.getItem('malhagi.v3.data'));
      const t = new Date(); t.setDate(t.getDate() - 1);
      const p = (n) => String(n).padStart(2, '0');
      const k = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
      d.days[k] = { at: Date.now(), plan: {}, items: { 'w:food:사과': { t: '사과', k: 'word', c: '음식·음료', p: 4 }, 's:meal:맛있어요': { t: '맛있어요', k: 'sentence', c: '식사', p: 2 } } };
      localStorage.setItem('malhagi.v3.data', JSON.stringify(d));
    })()""")
    b.goto(BASE + '/#/home')
    b.reload()
    expect(b.get_by_role('button', name='어제 연습 다시 하기 (낱말 1 · 문장 1)')).to_be_visible()
    click(b, re.compile('어제 연습 다시 하기'))
    expect(b.get_by_role('heading', name='어제 연습')).to_be_visible()
    check('어제 낱말 기록', b.get_by_text('4번').count() == 1)
    click(b, '이날 낱말 다시 하기')
    expect(b.locator('.target')).to_have_text('사과')
    wait_js(b, '/1번/.test(document.querySelector(".count").textContent)')
    click(b, '마치기 ✓')
    b.screenshot(path=f'{SHOTS}/11-iphone-done.png', full_page=True)
    b.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    wait_js(b, "!JSON.parse(localStorage.getItem('malhagi.v3.data')).backup.dirty", timeout=15000)

    # 기기 1을 다시 열면 기기 2의 연습이 합쳐져 있어야 함
    a.goto(BASE + '/#/records')
    a.reload()
    wait_js(a, "(() => { const d = JSON.parse(localStorage.getItem('malhagi.v3.data')); return Object.keys(d.days).length >= 2; })()", timeout=15000)
    a.reload()
    stats1 = a.locator('.stat strong').all_inner_texts()
    check('기기 2의 어제 기록이 기기 1에 합쳐짐', stats1[0] == '2일', str(stats1))

    # 오프라인
    print('오프라인')
    a.evaluate("navigator.serviceWorker.ready")
    a.reload()
    wait_js(a, "!!navigator.serviceWorker.controller", timeout=10000)
    ctx1.set_offline(True)
    a.goto(BASE + '/#/home')
    a.reload()
    expect(a.get_by_role('heading', name='오늘의 연습')).to_be_visible()
    click(a, '분야별 낱말')
    click(a, re.compile('^몸'))
    click(a, '처음부터 시작하기')
    expect(a.locator('.target')).to_have_text('머리')
    check('오프라인에서도 연습 가능', True)
    ctx1.set_offline(False)

    # ── 모두 지우기 (기기 2) ──
    print('기기 2: 모두 지우기')
    b.goto(BASE + '/#/settings')
    click(b, '모든 기록 지우기')
    expect(b.get_by_role('dialog')).to_contain_text('백업 서버에 있는 기록도 함께 지워요.')
    b.get_by_role('dialog').get_by_role('button', name='모두 지우기').click()
    expect(b.get_by_role('heading', name='말하기 짝꿍')).to_be_visible()
    check('기기 2의 기록이 사라짐', b.evaluate("localStorage.getItem('malhagi.v3.data')") is None)

    # ── 백업 서버 없는 상태 ──
    print('백업 서버 없음')
    ctx3, c = new_page(browser, width=360, height=740)
    c.goto(BASE_NOBACKUP + '/')
    click(c, '처음이에요')
    click(c, '다음')
    expect(c.get_by_role('button', name='시작하기', exact=True)).to_be_visible()
    check('백업 서버가 없으면 백업 안내·동의 칸이 없음', c.get_by_text('기록 백업').count() == 0 and c.locator('#agree-backup').count() == 0)
    check('백업 없이 시작 버튼', c.get_by_role('button', name='시작하기', exact=True).count() == 1)
    click(c, '시작하기', exact=True)
    click(c, '다음')
    expect(c.get_by_role('heading', name='오늘의 연습')).to_be_visible()
    check('복구 코드 화면을 건너뜀', True)
    c.get_by_role('button', name='설정').last.click()
    click(c, re.compile('기록 저장·불러오기'))
    expect(c.get_by_role('heading', name='기록 저장·불러오기')).to_be_visible()
    check('백업 버튼이 보이지 않음', c.get_by_role('button', name='백업 켜기').count() == 0)
    with c.expect_download() as dl:
        click(c, '기록 파일 내려받기')
    path = dl.value.path()
    exported = json.load(open(path, encoding='utf-8'))
    check('기록 파일 내려받기', exported.get('app') == 'malhagi' and 'days' in exported)
    c.screenshot(path=f'{SHOTS}/12-nobackup.png', full_page=True)

    # 파일로 다른 기기에 불러오기
    ctx4, e = new_page(browser)
    e.goto(BASE_NOBACKUP + '/')
    click(e, '다른 기기에서 쓰던 기록 불러오기')
    expect(e.get_by_role('heading', name='기록 파일로 불러오기')).to_be_visible()
    check('백업 서버가 없으면 복구 코드 칸이 없음', e.locator('#code').count() == 0)
    e.locator('#file').set_input_files(path)
    expect(e.get_by_role('heading', name='목소리와 빠르기')).to_be_visible()
    click(e, '다음')
    expect(e.get_by_role('heading', name='오늘의 연습')).to_be_visible()

    # ── 공통 확인 ──
    pages = [a, b, c, e]
    errs = [x for pg in pages for x in pg.errors if 'ERR_INTERNET_DISCONNECTED' not in x]  # 오프라인 시험 중 백업 확인 실패는 정상
    check('콘솔 오류 없음', not errs, ' | '.join(errs[:5]))
    ext = sorted({u for pg in pages for u in pg.requests if not u.startswith(('http://localhost', 'blob:', 'data:'))})
    check('바깥 주소로 나가는 요청 없음', not ext, ', '.join(ext[:5]))

    browser.close()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)} / {len(results)} 통과')
sys.exit(1 if failed else 0)
