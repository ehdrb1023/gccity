#!/usr/bin/env node
/**
 * 카페 DOM 정찰 — 수집기를 쓰기 전에 무엇을 어디서 긁을지 확정한다.
 *
 * ★ 읽기만 한다. 글을 쓰거나 누르거나 신고하지 않는다.
 * ★ 로그인 창을 닫지 않으려고 프로필을 **복사해서** 띄운다 —
 *   크롬은 한 프로필을 두 프로세스가 못 쓴다(SingletonLock).
 *   그래서 사본에서는 그 잠금 파일을 지우고 연다.
 * ★ 로그인 상태를 먼저 확인하고 보고한다. "글이 안 보임" 이
 *   등급 제한인지 쿠키 미반영인지 갈리지 않으면 오진한다.
 */
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const SRC = process.env.GCCITY_CAFE_PROFILE || path.join(os.homedir(), '.gccity-cafe-profile');
const COPY = path.join(os.tmpdir(), 'gccity-cafe-profile-inspect');
const LIST = process.argv[2];
if (!LIST) { console.error('사용: node scripts/cafe-inspect.mjs <목록URL>'); process.exit(1); }

fs.rmSync(COPY, { recursive: true, force: true });
fs.cpSync(SRC, COPY, { recursive: true, force: true, errorOnExist: false });
for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
  fs.rmSync(path.join(COPY, f), { force: true });
}

const ctx = await chromium.launchPersistentContext(COPY, {
  headless: true,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});

const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(20000);

/* ── 1. 로그인 상태 ─────────────────────────────────────── */
const cookies = await ctx.cookies('https://www.naver.com');
const hasNid = cookies.some((c) => c.name === 'NID_AUT' || c.name === 'NID_SES');
console.log('=== 로그인 ===');
console.log('NID 쿠키 :', hasNid ? '있음' : '없음  ← 로그인 안 됨 (창을 닫아 세션을 저장할 것)');

/* ── 2. 목록 페이지 ─────────────────────────────────────── */
console.log('\n=== 목록 ===');
console.log('URL :', LIST);
await page.goto(LIST, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const frames = page.frames();
console.log('프레임 수 :', frames.length, frames.map((f) => f.url().slice(0, 60)));

async function articleLinks(frame) {
  return frame.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/articles/"]'))
      .map((a) => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 40) }))
      .filter((x) => /\/articles\/\d+/.test(x.href)),
  ).catch(() => []);
}

let links = [];
for (const f of frames) {
  const got = await articleLinks(f);
  if (got.length > links.length) links = got;
}
const uniq = [...new Map(links.map((l) => [l.href.split('?')[0], l])).values()];
console.log('글 링크 :', uniq.length, '건');
uniq.slice(0, 8).forEach((l, i) => console.log(`  ${i + 1}. ${l.text} | ${l.href.slice(0, 100)}`));

if (uniq.length === 0) {
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
  console.log('\n[본문 텍스트 앞부분] — 왜 0건인지 여기서 갈린다');
  console.log(txt);
  await ctx.close();
  process.exit(0);
}

/* ── 3. 글 한 건 ────────────────────────────────────────── */
console.log('\n=== 글 상세 (첫 번째) ===');
await page.goto(uniq[0].href, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const probe = await page.evaluate(() => {
  const pick = (sels) => {
    const out = [];
    for (const s of sels) {
      const els = Array.from(document.querySelectorAll(s));
      if (els.length) {
        const t = els.map((e) => e.innerText || '').join('\n').trim();
        if (t) out.push({ sel: s, n: els.length, len: t.length, head: t.slice(0, 160) });
      }
    }
    return out;
  };
  return {
    title: pick(['h3.title_text', '.title_text', '[class*=ArticleTitle] h3', 'h3']),
    body: pick(['.se-main-container', '.article_viewer', '[class*=ArticleContentBox]', '.content .article', 'article']),
    date: pick(['.date', '[class*=WriterInfo] .date', 'time', '[class*=ArticleWriterProfile]']),
    comment: pick(['.comment_list', '[class*=CommentBox]', '[class*=CommentItem]', '.comment_box', 'ul.comment_list li']),
    docTitle: document.title,
  };
});

for (const [k, v] of Object.entries(probe)) {
  if (k === 'docTitle') { console.log('document.title :', v); continue; }
  console.log(`\n[${k}]`);
  if (!v.length) { console.log('  (매칭 없음)'); continue; }
  v.forEach((m) => console.log(`  ${m.sel}  n=${m.n} len=${m.len}\n    ${m.head.replace(/\n/g, ' ⏎ ')}`));
}

await ctx.close();
