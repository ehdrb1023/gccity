#!/usr/bin/env node
/**
 * 카톡 대화에서 **민원만** 골라낸다.
 *
 * ★ "민원/비민원" 2값으로 받지 않는다. 걸러낸 이유가 사라지면 필터가 틀려도 아무도 모른다.
 *   report / campaign / chatter / question / out_of_scope 5값으로 받고, 판정은 스크립트가 센다.
 *
 * ★ 실측(2026-09-08): 팔로우 중인 두 방은 **경마공원 이전을 둔 주민 논쟁**이 대부분이다.
 *   그걸 전부 민원으로 담으면 목록이 캠페인으로 뒤덮인다. campaign 을 따로 두는 이유다.
 *
 * ★ 대화 덩어리로 본다. 말풍선 하나만 보면 "네", "ㅋㅋ" 가 무슨 맥락인지 알 수 없다.
 *   앞뒤 메시지를 함께 주고 **앵커 id** 를 지목하게 한다.
 *
 * ★ 개인정보: 방 밖으로 나가는 산출물에는 닉네임을 그대로 싣지 않는다. 여기서는 로컬 파일이라
 *   유지하되, 공유용으로 내보낼 때 반드시 뗄 것(`privacy.md`).
 *
 * 사용: node scripts/kakao-triage.mjs <카톡JSON> [--limit N]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY 없음 — 아무것도 하지 않는다'); process.exit(2); }

const IN = process.argv[2] || path.join(os.homedir(), 'gccity-kakao-aug.json');
const li = process.argv.indexOf('--limit');
const LIMIT = li >= 0 ? Number(process.argv[li + 1]) : Infinity;
const MODEL = process.env.GCCITY_TRIAGE_MODEL || 'claude-sonnet-5';
const ROOMS = new Set(['과천시 지정타 조인길', '과천시 조인길 정책관 소통방']);
const OUT = path.join(os.homedir(), 'gccity-kakao-triage.json');
/** 한 번에 보는 대화 덩어리 크기. 크게 잡으면 맥락이 좋아지지만 앵커를 헷갈린다 */
const CHUNK = 40;

const Item = z.object({
  anchorId: z.string().describe('이 판정의 대표가 되는 메시지 id. 반드시 준 목록 안의 id'),
  kind: z.string().describe('"report"(처리를 요구하는 민원) · "campaign"(집회·청원·서명 동참 요청) · "question"(단순 문의) · "chatter"(잡담·논쟁·인사) · "out_of_scope"(과천시 소관이 아님) 중 하나'),
  title: z.string().describe('30자 이내 명사구. 무엇에 대한 것인지'),
  summary: z.string().describe('무엇을 요구하거나 알린 것인지 두 문장 이내'),
  category: z.string().describe('교통·환경·공원·재건축·행정 같은 짧은 분류 한 낱말'),
  confidence: z.string().describe('"high" · "medium" · "low"'),
  reason: z.string().describe('왜 그렇게 봤는지 한 줄'),
});
const Out = z.object({ items: z.array(Item).describe('이 덩어리에서 뽑은 판정. 전부 잡담이면 빈 배열') });

const SYSTEM = `너는 과천시 민원 담당자다. 오픈채팅방 대화에서 **행정이 처리해야 할 민원**만 골라낸다.

가르는 기준:
- report      : 특정 장소·시설의 문제를 알리고 조치를 요구한다. 처리 부서를 지정할 수 있다
- campaign    : 집회·청원·서명·언론 공유 동참 요청. 시가 이미 입장을 낸 사안의 여론전
- question    : 정보를 묻는 것. 처리할 대상이 없다
- chatter     : 주민끼리의 논쟁·의견·잡담·인사. **이게 대부분이다**
- out_of_scope: 민원 형태지만 과천시 소관이 아니다

주의:
- 같은 사안을 여러 명이 길게 논쟁하면 그것은 chatter 다. 논쟁 자체는 민원이 아니다
- "경마공원 이전 반대" 는 시가 이미 반대 입장을 냈다. 동참 요청이면 campaign 이다
- 애매하면 report 로 올리지 말고 confidence 를 low 로 두어라. **틀린 민원이 빠진 민원보다 나쁘다**
- 준 목록에 없는 id 를 지어내지 마라`;

const src = JSON.parse(fs.readFileSync(IN, 'utf-8'));
const rows = src.rows
  .filter((m) => ROOMS.has(m.room))
  .filter((m) => (m.body || '').trim().length >= 6)
  .sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at))
  .slice(0, LIMIT);
console.log(`대상 ${rows.length}건 / 모델 ${MODEL} / 덩어리 ${CHUNK}`);

const client = new Anthropic();
const byId = new Map(rows.map((r) => [String(r.id), r]));
const all = [];
let failed = 0;

for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const transcript = chunk
    .map((m) => `[${m.id}] ${new Date(Date.parse(m.sent_at) + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')} ${m.sender}: ${String(m.body || '').replace(/\n/g, ' ').slice(0, 400)}`)
    .join('\n');
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `아래는 오픈채팅방 대화다. 민원을 골라내라.\n\n${transcript}` }],
      output_config: { format: zodOutputFormat(Out) },
    });
    const items = (res.parsed_output?.items ?? []).filter((it) => byId.has(String(it.anchorId)));
    for (const it of items) {
      const m = byId.get(String(it.anchorId));
      all.push({ ...it, messageId: m.id, room: m.room, sender: m.sender, sentAt: m.sent_at, body: m.body });
    }
    console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}  이번 덩어리 ${items.length}건  누적 ${all.length}`);
  } catch (e) {
    // 실패를 "지적 없음" 으로 만들지 않는다. 미검사로 남긴다
    failed++;
    console.log(`  ${i}~ 덩어리 실패: ${String(e.message).slice(0, 80)}`);
  }
}

const byKind = {};
for (const a of all) byKind[a.kind] = (byKind[a.kind] || 0) + 1;
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, total: rows.length, failedChunks: failed, byKind, rows: all }, null, 2));
console.log(`\n=== 판정 ===`);
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
if (failed) console.log(`⚠️ 실패한 덩어리 ${failed}개 — 그만큼은 미검사다`);
console.log(`→ ${OUT}`);
