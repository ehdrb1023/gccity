#!/usr/bin/env node
/**
 * 본문을 받을 대상을 고른다 — **민원과 그 해결 내용만**.
 *
 * ★ 목록 전량을 긁지 않는다. 과천축제 홍보·기관 안내문 본문은 학습에도 통계에도
 *   쓸모가 없고, 남의 서버를 그만큼 더 두드린다(실측 2026-09-07 — 208건 전량을
 *   받다가 중단했다).
 *
 * ★ 다만 **거른 것의 건수는 남긴다.** 처리율(처리 글 ÷ 민원)의 분모라서,
 *   목록에서 지워버리면 그 숫자를 만들 수 없다.
 *
 * 사용: node scripts/cafe-pick.mjs <목록JSON> --month 2026-08 [--out <경로>]
 */
import fs from 'node:fs';

const IN = process.argv[2];
const mi = process.argv.indexOf('--month');
const MONTH = mi >= 0 ? process.argv[mi + 1] : null;
const oi = process.argv.indexOf('--out');
if (!IN || !MONTH) { console.error('사용: node scripts/cafe-pick.mjs <목록JSON> --month 2026-08 [--out <경로>]'); process.exit(1); }
const OUT = oi >= 0 ? process.argv[oi + 1] : IN.replace(/\.json$/, `-pick-${MONTH}.json`);

/** 홍보·기사 전용 게시판. 여기 글은 민원이 아니다 */
const NOISE_BOARD = new Set(['과천축제', '언론기사', '블로그', '유튜브', '카카오소식']);
/** 기관 계정. 부서·센터·재단 이름이 곧 신호다 */
const ORG = /(과천시|과천문화재단|재단|센터|복지관|박물관|도서관|팀\d?$|과$|정책관|홍보|비서관|시청|교육청소년|봉사|보건소|일자리)/;

const src = JSON.parse(fs.readFileSync(IN, 'utf-8'));
const rows = src.rows.map((r) => {
  const c = r.cells || [];
  return { ...r, board: r.board ?? (c[0] || ''), author: r.author ?? ((c[2] || '').split('\n')[0].trim()) };
});

const month = rows.filter((r) => r.date && r.date.startsWith(MONTH));
const bucket = (r) => {
  if (r.kind === 'resolution') return '해결(민원 처리 글)';
  if (r.kind === 'visit') return '해결(현장 방문 기록)';
  if (NOISE_BOARD.has(r.board)) return '제외: 홍보·기사';
  if (ORG.test(r.author)) return '제외: 기관 글';
  return '민원(주민 글)';
};
const counts = {};
for (const r of month) counts[bucket(r)] = (counts[bucket(r)] || 0) + 1;

const pick = month.filter((r) => !bucket(r).startsWith('제외'));
fs.writeFileSync(OUT, JSON.stringify({ ...src, month: MONTH, counts, rows: pick }, null, 2));

console.log(`${MONTH} 목록 ${month.length}건`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`\n본문 받을 대상 ${pick.length}건 → ${OUT}`);
