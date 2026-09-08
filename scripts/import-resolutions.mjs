#!/usr/bin/env node
/**
 * 수집한 해결 내용을 앱 DB(`complaints`)에 넣는다.
 *
 * ★ 왜 필요한가: 카톡 digest 는 카톡만 보고, 카페는 사람이 붙여넣은 것만 들어간다.
 *   그 사이에 **카페 처리 글·댓글 회신·현장 방문 기록**이 통째로 빠져 있었다
 *   (실측 2026-09-08 — 47건 중 41건이 DB 에 없었다). 부서 사전이 여기서 나온다.
 *
 * ★ 부서·기관·완료예정·접수/회신 시각은 **규칙(`parseResolutionBody`)이 뽑은 것**이다.
 *   모델이 지어낸 값이 아니라서 `ai_draft` 를 세우지 않는다. 대신 `note` 에 출처를 남긴다.
 *
 * ★ 멱등: `dedup_key` 유니크. 다시 돌려도 중복이 안 생기고, 사람이 고쳐둔 행을 덮지 않는다
 *   (`ignoreDuplicates`).
 *
 * 사용: node --experimental-strip-types scripts/import-resolutions.mjs [--apply]
 *       --apply 없으면 무엇을 넣을지 보여주기만 한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseResolutionBody } from '../src/server/complaint-classify.ts';

for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const H = os.homedir();
const sol = JSON.parse(fs.readFileSync(path.join(H, 'gccity-해결된민원.json'), 'utf-8')).rows;

const { data: existing, error: ee } = await db.from('complaints').select('id, dedup_key, title, kind, resolution_text, posted_at').limit(1000);
if (ee) { console.error('조회 실패:', ee.message); process.exit(1); }
const haveKey = new Set(existing.map((r) => r.dedup_key));
const norm = (s) => String(s || '').replace(/[^가-힣0-9]/g, '');
const haveTitle = existing.map((r) => norm(r.title));

const KIND_KEY = { '카페 처리 글': 'a', '카페 댓글 회신': 'c', '현장 방문 기록': 'v' };
const rows = [];
const skipped = [];
for (const [i, s] of sol.entries()) {
  const key = `crawl:${s.url ? s.url.split('/').pop() : i}:${KIND_KEY[s.구분] || 'x'}${i}`;
  const t = norm(s.제목);
  const core = t.replace(/^20\d\d년\d{1,2}월\d{1,2}일[월화수목금토일]?/, '').slice(0, 14);
  if (haveKey.has(key) || (core && haveTitle.some((d) => d.includes(core)))) { skipped.push(s.제목); continue; }
  const p = parseResolutionBody(s.해결본문 || '');
  rows.push({
    dedup_key: key,
    origin: 'crawl',
    kind: 'resolution',
    title: String(s.제목 || '').slice(0, 300),
    url: s.url || null,
    author: '조인길 정책관',
    board: s.구분,
    posted_at: s.회신 && /^\d{4}-\d{2}-\d{2}/.test(s.회신) ? new Date(Date.parse(s.회신.length <= 10 ? `${s.회신}T00:00:00+09:00` : s.회신)).toISOString() : null,
    body: String(s.해결본문 || '').slice(0, 8000),
    summary: String(s.해결요약 || '').slice(0, 1000),
    status: 'new',
    reported_at: p.receivedAt ?? (s.접수 && /^\d{4}-\d{2}-\d{2}$/.test(s.접수) ? new Date(Date.parse(`${s.접수}T00:00:00+09:00`)).toISOString() : null),
    resolved_at: p.repliedAt ?? null,
    department: s.부서 || p.department || null,
    agency: s.기관 || p.agency || null,
    due_at: p.dueAt ?? null,
    ai_draft: false,
    note: `카페 크롤 수집 (${s.구분}) — 부서·시각은 규칙 추출`,
  });
}

console.log(`수집 ${sol.length}건 / 이미 있음 ${skipped.length}건 / 넣을 것 ${rows.length}건`);
const withDept = rows.filter((r) => r.department).length;
console.log(`부서 있는 것 ${withDept}건\n`);
for (const r of rows.slice(0, 8)) console.log(`  ${(r.posted_at || '').slice(0, 10)} ${r.title.slice(0, 44)} | ${r.department || '-'}`);
if (rows.length > 8) console.log(`  … 외 ${rows.length - 8}건`);

if (!APPLY) { console.log('\n[미적용] --apply 를 붙이면 실제로 넣는다'); process.exit(0); }
const { data: ins, error } = await db.from('complaints').upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true }).select('id');
if (error) { console.error('삽입 실패:', error.message); process.exit(1); }
console.log(`\n✅ ${ins ? ins.length : 0}건 삽입 완료`);
