#!/usr/bin/env node
/**
 * 네이버 카페 목록 수집 — 로그인은 사람이, 읽기만 자동.
 *
 * ★ 목록만 읽는다. 본문은 별도 단계다(로그인 필요).
 *   목록만으로도 **처리 글은 제목으로 확정**된다 — 제목의 날짜가 접수일,
 *   글 작성일이 회신일이라 소요일이 여기서 이미 나온다.
 *
 * ★ 사람 열람 속도로 넘긴다. 페이지당 대기 + 상한. 캡챠·로그인 리다이렉트가
 *   보이면 그 자리에서 멈추고 사유를 남긴다 — 조용히 계속 두드리지 않는다.
 *
 * ★ 프로필은 레포 밖(`~/.gccity-cafe-profile`). 네이버 세션이 들어 있다.
 *
 * 사용:
 *   node scripts/cafe-collect.mjs --menu 124 --since 2026-08-01
 *   node scripts/cafe-collect.mjs --menu 0   --since 2026-08-01 --max-pages 30
 */
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CAFE_ID = process.env.GCCITY_CAFE_ID || '31138369';
const SRC = process.env.GCCITY_CAFE_PROFILE || path.join(os.homedir(), '.gccity-cafe-profile');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const MENU = arg('menu', '0');
const SINCE = arg('since', '2026-08-01');
const MAX_PAGES = Number(arg('max-pages', '40'));
const OUT = arg('out', path.join(os.homedir(), `gccity-cafe-menu${MENU}-${SINCE}.json`));
/**
 * 사람이 목록을 훑는 속도. 3~5초 사이에서 매번 다르게 쉰다.
 * 고정 간격은 그 자체가 기계 신호라 랜덤을 준다. 줄이지 말 것.
 */
const WAIT_MIN_MS = 3000;
const WAIT_MAX_MS = 5000;
const waitMs = () => WAIT_MIN_MS + Math.floor(Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS));

/* 서버(`src/server/complaint-classify.ts`)와 **같은** 규칙. 한쪽만 고치면 판정이 갈린다. */
const DATED_TITLE = /^\s*(20\d\d)\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:\(\s*[월화수목금토일]\s*\)\s*)?[-–—]?\s*(.*)$/;
const COMPLAINT_WORD = /(민원|청원|요청|신고|건의)/;
/*
 * 현장 방문 기록 — `2026년 9월 3일 (목) - 과천 자이 경로당 - 48회`
 *
 * 주무관이 경로당·어린이집을 순회하며 **받아온** 민원이다. 제목에 `민원` 낱말이 없어
 * COMPLAINT_WORD 규칙에 안 걸려 21건이 통째로 빠져 있었다(실측 2026-09-07).
 *
 * ★ `resolution` 과 섞지 말 것. 처리 글은 접수일(제목)↔회신일(작성일)이 있어 소요일이
 *   나오지만, 방문 기록은 그 구조가 없다. 섞으면 소요일 0일짜리가 무더기로 들어와
 *   평균이 조용히 무너진다.
 */
const VISIT_TITLE = /[-–—]\s*(\d+)\s*회\s*$/;

function classifyTitle(title) {
  const t = String(title ?? '');
  const m = DATED_TITLE.exec(t);
  if (!m) return { kind: null, reportedAt: null, visitNo: null };
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { kind: null, reportedAt: null, visitNo: null };
  const pad = (n) => String(n).padStart(2, '0');
  const at = `${y}-${pad(mo)}-${pad(d)}`;
  const v = VISIT_TITLE.exec(m[4]);
  if (v) return { kind: 'visit', reportedAt: at, visitNo: Number(v[1]) };
  if (COMPLAINT_WORD.test(m[4])) return { kind: 'resolution', reportedAt: at, visitNo: null };
  return { kind: null, reportedAt: null, visitNo: null };
}

/*
 * 브라우저 붙기 — 두 길이 있고 순서가 중요하다.
 *
 * ① 살아 있는 로그인 창에 CDP 로 붙는다 (권장).
 *    네이버는 '로그인 상태 유지' 를 안 켜면 NID_AUT 를 **세션 쿠키**로 준다.
 *    세션 쿠키는 디스크에 안 써지므로 프로필 사본에는 로그인이 안 따라온다
 *    (실측 2026-09-07 — 창을 닫자 인증 쿠키가 통째로 사라졌다).
 *    살아 있는 창에 붙으면 그 문제가 아예 없다.
 * ② 창이 없으면 프로필 사본으로 띄운다. 목록은 비로그인으로도 읽히므로
 *    이 길도 쓸모가 있다 — 다만 본문은 못 읽는다.
 */
const CDP = `http://127.0.0.1:${process.env.GCCITY_CDP_PORT || 9222}`;
let browser = null;
let ctx = null;
try {
  browser = await chromium.connectOverCDP(CDP, { timeout: 3000 });
  ctx = browser.contexts()[0];
  console.log('로그인 창에 붙었다 →', CDP);
} catch {
  console.log('로그인 창 없음 → 프로필 사본으로 진행 (본문은 못 읽는다)');
  const profileCopy = path.join(os.tmpdir(), 'gccity-cafe-collect');
  fs.rmSync(profileCopy, { recursive: true, force: true });
  fs.cpSync(SRC, profileCopy, { recursive: true, force: true });
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(profileCopy, f), { force: true });
  }
  ctx = await chromium.launchPersistentContext(profileCopy, {
    headless: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1600, height: 1400 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
}

const page = await ctx.newPage();
page.setDefaultTimeout(30000);

const cookies = await ctx.cookies('https://www.naver.com');
const loggedIn = cookies.some((c) => c.name === 'NID_AUT' || c.name === 'NID_SES');
console.log(`카페 ${CAFE_ID} / 메뉴 ${MENU} / ${SINCE} 이후 / 로그인 ${loggedIn ? 'O' : 'X (목록만 가능)'}`);

const rows = new Map();
let stopped = null;

for (let p = 1; p <= MAX_PAGES; p++) {
  const url = `https://cafe.naver.com/f-e/cafes/${CAFE_ID}/menus/${MENU}?viewType=L&page=${p}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(waitMs());

  // 로그인 화면으로 튕기면 즉시 정지. 계속 두드리는 것이 제일 나쁘다.
  if (/nid\.naver\.com|captcha/i.test(page.url())) {
    stopped = `로그인·캡챠 화면으로 튕김 (${page.url()})`;
    break;
  }

  const got = await page.evaluate(() =>
    Array.from(document.querySelectorAll('tr'))
      .filter((tr) => tr.querySelector('a[href*="/articles/"]'))
      .map((tr) => {
        const a = tr.querySelector('a[href*="/articles/"]');
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || '').trim());
        const txt = (tr.innerText || '').replace(/\s+/g, ' ').trim();
        const dm = txt.match(/(20\d\d)\.(\d{2})\.(\d{2})\./);
        // 칸 순서: [게시판, 제목(+댓글수), 작성자(+멤버등급), 날짜, 조회수]
        const cell = (i) => (cells[i] || '').split('\n')[0].trim();
        return {
          id: (a.getAttribute('href') || '').match(/articles\/(\d+)/)?.[1] || null,
          url: a.href.split('?')[0],
          title: (a.innerText || '').replace(/\s+/g, ' ').trim(),
          board: cell(0),
          author: cell(2),
          pinned: /^(공지|필독)/.test(txt),
          date: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : null,
          raw: txt.slice(0, 240),
        };
      }),
  );

  if (got.length === 0) { stopped = `${p}쪽에서 글 행을 찾지 못했다`; break; }

  const fresh = got.filter((r) => !r.pinned && r.id);
  for (const r of fresh) if (!rows.has(r.id)) rows.set(r.id, r);

  const dates = fresh.map((r) => r.date).filter(Boolean);
  const oldest = dates.sort()[0] || '?';
  console.log(`  ${p}쪽  행 ${fresh.length}  가장 오래된 글 ${oldest}  누적 ${rows.size}`);

  if (dates.length && oldest < SINCE) { stopped = `${SINCE} 이전 도달`; break; }
  if (p === MAX_PAGES) stopped = `페이지 상한(${MAX_PAGES}) 도달`;
}

await page.close().catch(() => {});
// 붙은 창은 사람 것이다. 끊기만 하고 닫지 않는다 — 닫으면 세션 쿠키가 날아간다.
if (!browser) await ctx.close().catch(() => {});

const all = [...rows.values()];
const target = all.filter((r) => r.date && r.date >= SINCE);
const withKind = target.map((r) => {
  const c = classifyTitle(r.title);
  const lead =
    c.reportedAt && r.date
      ? Math.max(0, Math.floor((Date.parse(r.date + 'T00:00:00+09:00') - Date.parse(c.reportedAt + 'T00:00:00+09:00')) / 86400000))
      : null;
  return { ...r, kind: c.kind || 'unknown', reportedAt: c.reportedAt, visitNo: c.visitNo,
           resolvedAt: c.kind === 'resolution' ? r.date : null, leadDays: c.kind === 'resolution' ? lead : null };
});

const res = withKind.filter((r) => r.kind === 'resolution');
const visits = withKind.filter((r) => r.kind === 'visit');
const leads = res.map((r) => r.leadDays).filter((n) => n !== null);

console.log(`\n정지 사유 : ${stopped || '완주'}`);
console.log(`수집       : ${all.length}건 (${SINCE} 이후 ${target.length}건)`);
console.log(`처리 글    : ${res.length}건  ← 제목만으로 확정`);
console.log(`현장 방문  : ${visits.length}건  ← 주무관 순회 기록 (소요일 없음)`);
if (leads.length) {
  console.log(`처리 소요  : 평균 ${(leads.reduce((a, b) => a + b, 0) / leads.length).toFixed(1)}일 (모수 ${leads.length})`);
}
console.log(`나머지     : ${target.length - res.length - visits.length}건 — 본문·작성자를 봐야 민원/공지가 갈린다`);

fs.writeFileSync(OUT, JSON.stringify({ cafeId: CAFE_ID, menu: MENU, since: SINCE, stopped, rows: withKind }, null, 2));
console.log(`\n저장 → ${OUT}`);

for (const r of res.slice(0, 12)) {
  console.log(`  [처리 ${String(r.leadDays).padStart(2)}일] ${r.reportedAt} → ${r.date}  ${r.title.slice(0, 50)}`);
}

// CDP 로 붙은 경우 브라우저를 닫지 않으므로 이벤트 루프가 안 비워진다.
// 명시적으로 끝내지 않으면 timeout 에 걸려 143 으로 죽는다(실측 2026-09-08).
process.exit(0);
