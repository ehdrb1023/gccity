#!/usr/bin/env node
/**
 * 학습·평가용 데이터셋 두 벌. **목적이 다르므로 절대 한 파일에 섞지 않는다.**
 *
 *   ① 민원 판별 (is-complaint)
 *      입력: 주민이 쓴 글·말 전량        출력: report 인가 아닌가
 *      → 비민원(잡담·캠페인·문의·소관밖)이 **반드시 함께** 있어야 배울 수 있다
 *
 *   ② 부서 배정 (route-to-department)
 *      입력: 민원 원문·요약              출력: 담당 부서
 *      → **해결된 민원에만** 라벨이 있다. 미해결은 정답이 없으므로 넣지 않는다
 *
 * ★ ②에 비민원을 넣지 말 것. 부서가 없는 행을 "부서 미상" 으로 넣으면 모델이
 *   그 라벨을 배워버려 실제 배정에서 회피 답을 낸다.
 * ★ 닉네임은 뺀다. 학습에 쓸모없고 개인정보다(`privacy.md`).
 *
 * 사용: node scripts/build-datasets.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const H = os.homedir();
const R = (f) => JSON.parse(fs.readFileSync(path.join(H, f), 'utf-8'));
const solved = R('gccity-해결된민원.json').rows;
const unsolved = R('gccity-미해결민원.json').rows;
const triage = R('gccity-kakao-판정.json').rows;

/* ── ① 민원 판별 ───────────────────────────────────────── */
const clf = [];
for (const t of triage) {
  if (t.kind === 'bot_echo') continue;          // 봇 공지가 주민 이름으로 찍힌 것. 사람 발화가 아니다
  if ((t.원문 || '').trim().length < 6) continue;
  clf.push({
    source: '카톡', text: t.원문, label: t.kind,
    is_complaint: t.kind === 'report',
    category: t.category || null, reason: t.판정근거 || null,
    at: t.시각, ref: `msg:${t.messageId}`,
  });
}
for (const u of unsolved) {
  if (u.구분 !== '카페 주민 글(회신 없음)') continue;
  clf.push({
    source: '카페', text: [u.제목, u.본문].filter(Boolean).join('\n'), label: 'report',
    is_complaint: true, category: null, reason: '카페 민원 게시글', at: u.작성일, ref: u.url,
  });
}
for (const s of solved) {
  if (!s.민원요약) continue;
  clf.push({
    source: s.구분, text: s.민원본문 && s.민원본문.length > 20 ? s.민원본문 : s.민원요약,
    label: 'report', is_complaint: true, category: null,
    reason: '해결된 민원 — 부서가 배정된 것이므로 민원임이 확정', at: s.접수, ref: s.url,
  });
}

/* ── ② 부서 배정 ───────────────────────────────────────── */
const route = solved
  .filter((s) => s.부서)                        // 라벨 없는 것은 넣지 않는다
  .map((s) => ({
    input: s.민원요약,
    input_full: s.민원본문 || null,
    department: s.부서,
    agency: s.기관 || null,                     // 시청 밖으로 넘긴 것. 부서와 다른 축이다
    label_source: s.구분,
    해결내용: s.해결요약,
    접수: s.접수, 회신: s.회신, 소요시간h: s.소요시간h ?? null,
    ref: s.url,
  }));

const o1 = path.join(H, 'dataset-민원판별.json');
const o2 = path.join(H, 'dataset-부서배정.json');
const byLabel = {};
for (const c of clf) byLabel[c.label] = (byLabel[c.label] || 0) + 1;
const byDept = {};
for (const r of route) byDept[r.department] = (byDept[r.department] || 0) + 1;

fs.writeFileSync(o1, JSON.stringify({ purpose: '민원인가 아닌가', count: clf.length, byLabel, rows: clf }, null, 2));
fs.writeFileSync(o2, JSON.stringify({ purpose: '민원 → 담당 부서', count: route.length, byDepartment: byDept, rows: route }, null, 2));

console.log(`① 민원 판별  ${clf.length}건`);
for (const [k, v] of Object.entries(byLabel).sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(4)}  ${k}`);
console.log(`   민원 ${clf.filter((c) => c.is_complaint).length} vs 비민원 ${clf.filter((c) => !c.is_complaint).length}`);
console.log(`\n② 부서 배정  ${route.length}건 / 부서 ${Object.keys(byDept).length}종`);
for (const [k, v] of Object.entries(byDept).sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(3)}  ${k}`);
console.log(`\n→ ${o1}\n→ ${o2}`);
