#!/usr/bin/env node
/**
 * 카페 글 본문 수집 — 목록 JSON 을 받아 글마다 본문·댓글을 채운다.
 *
 * ★ 모바일 카페(`m.cafe.naver.com`)를 쓴다. 데스크톱 SPA 는 본문이 중첩 iframe 안에서
 *   늦게 렌더돼 잡기 어렵지만, 모바일은 한 프레임에 제목·작성일·본문·댓글이 다 있다
 *   (실측 2026-09-07). 로그인 쿠키는 `.naver.com` 이라 그대로 통한다.
 *
 * ★ 살아 있는 로그인 창에 CDP 로 붙는다. 본문은 로그인 없이는 빈 채로 렌더된다 —
 *   그래서 붙지 못하면 **시작하지 않는다**. 빈 본문을 잔뜩 저장하는 것이 제일 나쁘다.
 *
 * ★ 사람 열람 속도(3~5초 랜덤). 로그인 화면으로 튕기면 그 자리에서 멈춘다.
 *
 * 사용: node scripts/cafe-bodies.mjs <목록JSON> [--only-resolution] [--max N]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const IN = process.argv[2];
if (!IN) { console.error('사용: node scripts/cafe-bodies.mjs <목록JSON> [--only-resolution] [--max N]'); process.exit(1); }
const ONLY_RES = process.argv.includes('--only-resolution');
const mi = process.argv.indexOf('--max');
const MAX = mi >= 0 ? Number(process.argv[mi + 1]) : Infinity;
const CDP = `http://127.0.0.1:${process.env.GCCITY_CDP_PORT || 9222}`;
const WAIT = () => 3000 + Math.floor(Math.random() * 2000);

const src = JSON.parse(fs.readFileSync(IN, 'utf-8'));
const CAFE = src.cafeId;
let items = src.rows.filter((r) => r.id);
if (ONLY_RES) items = items.filter((r) => r.kind === 'resolution');
items = items.slice(0, MAX);

const OUT = IN.replace(/\.json$/, ONLY_RES ? '-bodies-res.json' : '-bodies.json');
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf-8')) : {};
console.log(`대상 ${items.length}건 (이미 받은 것 ${Object.keys(done).length}건은 건너뜀) → ${OUT}`);

let browser;
try {
  browser = await chromium.connectOverCDP(CDP, { timeout: 5000 });
} catch {
  console.error(`로그인 창에 못 붙었다 (${CDP}). 본문은 로그인 없이는 빈 채로 온다 — 시작하지 않는다.`);
  console.error('먼저: node scripts/cafe-login.mjs  (로그인 상태 유지 켜고, 창은 닫지 말 것)');
  process.exit(2);
}
const ctx = browser.contexts()[0];
const ck = await ctx.cookies();
const names = ck.filter((c) => c.domain.includes('naver')).map((c) => c.name);
if (!names.includes('NID_AUT')) {
  console.error('NID_AUT 쿠키가 없다 = 로그인 안 된 창이다. 시작하지 않는다.');
  process.exit(2);
}
console.log('로그인 확인 (NID_AUT). 수집 시작.');

const page = await ctx.newPage();
page.setDefaultTimeout(20000);
let ok = 0, empty = 0, cmt = 0, stopped = null;

for (const [i, r] of items.entries()) {
  if (done[r.id]) continue;
  const url = `https://m.cafe.naver.com/ca-fe/web/cafes/${CAFE}/articles/${r.id}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {
    console.log(`  ${r.id} 이동 실패: ${e.message.slice(0, 50)}`);
    continue;
  }
  await page.waitForTimeout(WAIT());

  if (/nid\.naver\.com|captcha/i.test(page.url())) { stopped = `로그인·캡챠로 튕김 (${r.id})`; break; }

  /*
   * 댓글 더보기를 눌러 전부 펼친다. **민원 회신이 댓글에 달리는 일이 잦아서**
   * 접힌 채로 두면 회신을 통째로 놓친다(실측 2026-09-07 — 27건에 댓글 92개가
   * 있었는데 한 건도 못 받고 있었다). 상한을 두어 무한 클릭을 막는다.
   */
  for (let k = 0; k < 8; k++) {
    const more = await page.$('.comment_more_bottom a, .comment_more a, .comment_more_bottom button');
    if (!more) break;
    await more.click().catch(() => {});
    await page.waitForTimeout(900);
  }

  const got = await page.evaluate(() => {
    const pick = (s) => { const e = document.querySelector(s); return e ? (e.innerText || '').trim() : null; };
    const body = pick('.se-main-container') || pick('.article_viewer') || pick('#postContent') || '';
    // 모바일 카페 댓글: ul.comment_list > .comment_item (헤더=닉네임 / 콘텐츠=본문 / 푸터=시각)
    const comments = Array.from(document.querySelectorAll('.comment_list .comment_item, .comment_item'))
      .map((el) => {
        const g = (s) => { const e = el.querySelector(s); return e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : ''; };
        const head = g('.comment_header');
        const foot = g('.comment_footer');
        return {
          writer: head.split(' ')[0] || null,
          isAuthor: /작성자/.test(head),
          text: g('.comment_content'),
          at: (foot.match(/(20\d\d\.\d{2}\.\d{2}\.\s*\d{2}:\d{2})/) || [])[1] || null,
        };
      })
      .filter((c) => c.text);
    const info = (document.body.innerText.match(/작성일\s*\n?([\d.]+\.\s*[\d:]+)/) || [])[1] || null;
    const imgs = Array.from(document.querySelectorAll('.se-main-container img, .article_viewer img'))
      .map((im) => im.src).filter((s) => s && !s.startsWith('data:'));
    return { title: pick('.post_title') || pick('h2') || document.title, body, comments, postedAt: info, imgs };
  }).catch(() => null);

  if (!got || got.body.length < 20) { empty++; console.log(`  ${r.id} 본문 비었음 (${got ? got.body.length : 'null'}자)`); }
  else { ok++; }
  cmt += (got && got.comments ? got.comments.length : 0);
  done[r.id] = { ...r, url, ...(got || {}), fetchedAt: new Date().toISOString() };
  if ((i + 1) % 10 === 0 || i === items.length - 1) fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${items.length}  본문 ${ok}  빈것 ${empty}  댓글누적 ${cmt}`);

  // 빈 본문이 연달아 나오면 로그인이 풀린 것이다. 계속 긁어봐야 쓰레기만 쌓인다.
  if (empty >= 5 && ok === 0) { stopped = '본문이 계속 비어 있다 — 로그인 확인 필요'; break; }
}

fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
await page.close().catch(() => {});
console.log(`\n정지: ${stopped || '완주'}`);
console.log(`본문 ${ok}건 / 빈 것 ${empty}건 / 댓글 ${cmt}개 / 저장 ${Object.keys(done).length}건 → ${OUT}`);
process.exit(0);
