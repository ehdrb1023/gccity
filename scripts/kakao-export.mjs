#!/usr/bin/env node
/**
 * 카톡 수집분을 기간별로 뽑아 파일로 내린다.
 *
 * ★ 시크릿은 이 스크립트가 `.env.local` 에서 직접 읽고 **출력하지 않는다.**
 *   에이전트 세션에 값이 흘러들지 않게 하는 것이 요점이다(`ai-usage.md` 2절).
 *
 * ★ 읽기 전용. `messages` 를 조회만 한다.
 *
 * 사용: node scripts/kakao-export.mjs --from 2026-08-01 --to 2026-09-01 [--out <경로>]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '@supabase/supabase-js';

for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Supabase env 없음 (.env.local 확인)'); process.exit(2); }

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const FROM = arg('from', '2026-08-01');
const TO = arg('to', '2026-09-01');
const OUT = arg('out', path.join(os.homedir(), `gccity-kakao-${FROM}.json`));

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: rooms, error: re } = await db.from('rooms').select('id, channel_id, display_name, name_hint, followed');
if (re) { console.error('rooms 조회 실패:', re.message); process.exit(1); }
const roomName = new Map(rooms.map((r) => [r.id, r.display_name || r.name_hint || `#${String(r.channel_id).slice(-8)}`]));
console.log(`방 ${rooms.length}개 (팔로우 ${rooms.filter((r) => r.followed).length}개)`);

// 페이지네이션 — 무제한 조회 금지(backend.md 1절). 1000건씩 끊어 가져온다
const all = [];
for (let page = 0; ; page++) {
  const { data, error } = await db
    .from('messages')
    .select('id, room_id, msg_id, sender, body, sent_at, attachment_type, attachment_name')
    .gte('sent_at', `${FROM}T00:00:00+09:00`)
    .lt('sent_at', `${TO}T00:00:00+09:00`)
    .order('sent_at', { ascending: true })
    .range(page * 1000, page * 1000 + 999);
  if (error) { console.error('messages 조회 실패:', error.message); process.exit(1); }
  all.push(...data);
  if (data.length < 1000) break;
}
const rows = all.map((m) => ({ ...m, room: roomName.get(m.room_id) || '?' }));
fs.writeFileSync(OUT, JSON.stringify({ from: FROM, to: TO, count: rows.length, rows }, null, 2));

const byRoom = {};
for (const r of rows) byRoom[r.room] = (byRoom[r.room] || 0) + 1;
console.log(`${FROM} ~ ${TO}  메시지 ${rows.length}건`);
for (const [k, v] of Object.entries(byRoom).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`→ ${OUT}`);
