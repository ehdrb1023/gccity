#!/usr/bin/env node
/**
 * 최종 묶음 — ① 해결된 민원 ② 미해결 민원.
 *
 * ★ 요약을 모델에게 시키지 않는다. 정책관 회신문이 정형이라 **규칙이 더 정확하다.**
 *     "갈현천 산책로 주변의 수목이 울창하여 전지 작업이 필요하다 라는 민원이 접수 되었습니다.
 *      이에 과천시청 공원녹지과 하천팀에서 …"
 *      └─────────── 민원 요약 ───────────┘  └──── 해결 요약 ────┘
 *   모델이 그럴듯하게 고쳐 쓰면 이 앱이 재려는 숫자가 조용히 틀어진다(`gccity-domain.md`).
 *
 * ★ 본문은 버리지 않고 함께 싣는다(`본문`). 요약은 훑기용이고 판단은 원문으로 한다.
 *
 * 사용: node --experimental-strip-types scripts/assemble.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const H = os.homedir();
const solved = JSON.parse(fs.readFileSync(path.join(H, 'gccity-solved.json'), 'utf-8')).rows;

/*
 * 제목은 **목록에서 읽은 것**을 쓴다. 글 상세 페이지의 `.post_title` 은 게시판 이름이나
 * 방 제목을 집어오는 경우가 있어(실측 — "S9 제이드 자이", "과천시지정타조인길정책관소통방")
 * 그대로 쓰면 민원 제목이 아닌 것이 목록에 뜬다.
 */
const listTitle = new Map();
for (const f of ['gccity-aug-pick.json', 'gccity-sep-pick.json']) {
  const p = path.join(H, f);
  if (!fs.existsSync(p)) continue;
  for (const r of JSON.parse(fs.readFileSync(p, 'utf-8')).rows) if (r.id) listTitle.set(String(r.id), r.title);
}
const unsolved = JSON.parse(fs.readFileSync(path.join(H, 'gccity-unsolved.json'), 'utf-8')).rows;

/** 정책관 회신문을 민원 요약 / 해결 요약으로 가른다 */
function split(body) {
  const t = String(body || '').replace(/​/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.*?라는 민원이 접수\s*되었습니다\.?)\s*(.*)$/.exec(t);
  if (m) {
    const rest = m[2].replace(/관내[^.]*앞장서 주신[^.]*감사합니다\.?/g, '').trim();
    return { 민원요약: m[1].replace(/\s*라는 민원이 접수\s*되었습니다\.?$/, '').trim(), 해결요약: rest.slice(0, 600) };
  }
  return { 민원요약: null, 해결요약: t.slice(0, 600) };
}

/** 제목 앞머리의 접수일을 떼어 민원 요지만 남긴다 */
function stripDate(t) {
  if (!t) return null;
  return String(t).replace(/^\s*20\d\d\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*(?:\([월화수목금토일]\)\s*)?[-–—]?\s*/, '').trim() || null;
}

/** 개인정보: 산출물에 연락처를 그대로 싣지 않는다 (`privacy.md`) */
const mask = (s) => String(s || '').replace(/01[016-9][- ]?\d{3,4}[- ]?\d{4}/g, '010-****-****');

const A = solved.map((r) => {
  const s = split(r.해결내용);
  return {
    구분: r.type,
    제목: listTitle.get(String(r.articleId)) || r.title,
    // 회신문 앞머리가 비면 제목이 곧 민원 요지다 — 지어내지 말고 제목을 쓴다
    민원요약: s.민원요약 || stripDate(listTitle.get(String(r.articleId))) || (r.민원원문 || '').slice(0, 160) || null,
    해결요약: mask(s.해결요약),
    부서: r.부서 || null,
    기관: r.기관 || null,
    완료예정: r.완료예정 ? r.완료예정.slice(0, 10) : null,
    접수: r.민원시각, 회신: r.회신시각, 소요시간h: r.소요시간h,
    민원출처: r.민원출처,
    민원본문: mask(r.민원원문),
    해결본문: mask(r.해결내용),
    url: r.url,
  };
});

const B = unsolved.map((r) => ({
  구분: '카페 주민 글(회신 없음)',
  제목: listTitle.get(String(r.articleId)) || r.title, 게시판: r.게시판, 작성자: r.작성자, 작성일: r.postedAt,
  댓글수: r.댓글수,
  본문: mask(r.본문),
  url: r.url,
}));

const outA = path.join(H, 'gccity-해결된민원.json');
const outB = path.join(H, 'gccity-미해결민원.json');
fs.writeFileSync(outA, JSON.stringify({ count: A.length, rows: A }, null, 2));
fs.writeFileSync(outB, JSON.stringify({ count: B.length, note: '카톡 미판정분은 gccity-kakao-unlinked.json 에 별도', rows: B }, null, 2));

const 요약있음 = A.filter((x) => x.민원요약).length;
const 부서있음 = A.filter((x) => x.부서).length;
console.log(`① 해결된 민원 ${A.length}건  (민원요약 ${요약있음} · 부서 ${부서있음})`);
const byType = {};
for (const a of A) byType[a.구분] = (byType[a.구분] || 0) + 1;
for (const [k, v] of Object.entries(byType)) console.log(`     ${String(v).padStart(3)}  ${k}`);
console.log(`② 미해결 민원 ${B.length}건 (카페 주민 글)`);
console.log(`\n→ ${outA}\n→ ${outB}`);
console.log('\n--- 샘플 ---');
for (const a of A.slice(0, 3)) {
  console.log(`■ [${a.구분}] ${a.제목.slice(0, 44)}`);
  console.log(`   민원: ${(a.민원요약 || '').slice(0, 80)}`);
  console.log(`   해결: ${(a.해결요약 || '').slice(0, 80)}`);
  console.log(`   부서: ${a.부서 || '-'}  소요: ${a.소요시간h ?? '-'}h`);
}
