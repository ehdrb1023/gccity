#!/usr/bin/env node
/**
 * 카페 수집용 브라우저 로그인 — 사람이 직접 로그인하는 창을 띄운다.
 *
 * ★ 비밀번호는 이 스크립트도, 에이전트 세션도 보지 않는다. 사람이 창에 손으로 친다.
 *   남는 것은 프로필 디렉토리의 세션 쿠키뿐이고 그건 **레포 밖**에 둔다 —
 *   레포 안에 두면 네이버 세션이 커밋될 수 있다.
 *
 * ★ 로그인 자동화를 넣지 말 것. 캡챠·기기인증이 이 방식에서 사라지는 이유가
 *   "사람이 친다" 하나다. 자동화하는 순간 그게 제일 약한 고리가 된다.
 *
 * 사용: node scripts/cafe-login.mjs [시작URL]
 *       창을 닫으면 세션이 저장되고 스크립트가 끝난다.
 */
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';

const PROFILE = process.env.GCCITY_CAFE_PROFILE || path.join(os.homedir(), '.gccity-cafe-profile');
const START = process.argv[2] || 'https://nid.naver.com/nidlogin.login';
const PORT = Number(process.env.GCCITY_CDP_PORT || 9222);

console.log('프로필 :', PROFILE);
console.log('시작    :', START);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: null,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  // 네이버는 자동화 표식이 붙은 브라우저를 더 깐깐하게 본다. 사람이 쓰는 창에 가깝게 둔다.
  // 원격 디버깅 포트를 열어둔다. 수집기가 **이 창에 그대로 붙는다** —
  // 프로필 사본을 뜨지 않으므로 "창을 닫아야 세션이 저장된다" 문제가 사라진다.
  // 네이버는 '로그인 상태 유지'를 안 켜면 NID_AUT 를 세션 쿠키로 준다.
  // 세션 쿠키는 디스크에 안 써져서, 창을 닫는 순간 로그인이 통째로 날아간다(실측 2026-09-07).
  args: [
    '--disable-blink-features=AutomationControlled',
    '--start-maximized',
    `--remote-debugging-port=${PORT}`,
  ],
  ignoreDefaultArgs: ['--enable-automation'],
});

const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(START, { waitUntil: 'domcontentloaded' }).catch((e) => {
  console.log('첫 페이지 이동 실패:', e.message);
});

console.log('');
console.log('창이 떴다. 여기서 할 일:');
console.log('  1. ★ "로그인 상태 유지" 를 켜고 로그인할 것');
console.log('     안 켜면 NID_AUT 가 세션 쿠키로 와서 창을 닫는 순간 사라진다');
console.log('  2. 네이버 로그인 (아이디·비번·2차인증 전부 손으로)');
console.log('  3. ★ 창을 닫지 말 것. 수집기가 이 창에 붙는다');
console.log(`     CDP  http://127.0.0.1:${PORT}`);
console.log('');

await new Promise((resolve) => ctx.on('close', resolve));
console.log('창이 닫혔다. 세션 저장 완료 →', PROFILE);
