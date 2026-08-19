import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { getAppState, discoveryOn, type AppState } from './state';

/** 방 찾기 모드에서 올라오는 미리보기 최대 길이. 사람이 방을 알아볼 최소치만 남긴다. */
export const PREVIEW_MAX = 12;

export type IncomingMsg = {
  key: string;
  nameHint?: string;
  group?: boolean;
  sender?: string;
  text?: string;
  tsMs?: number;
};

export type IncomingSeen = {
  key: string;
  nameHint?: string;
  group?: boolean;
  sender?: string;
  preview?: string;
  tsMs?: number;
};

export type IngestResult = {
  ok: true;
  inserted: number;
  skipped: number;      // 멱등키가 겹쳐 이미 있던 것
  dropped: number;      // 팔로우하지 않는 방이라 본문을 버린 것
  seen: number;         // 방 찾기 모드로 기록한 후보 알림 수
  configVersion: number;
  discovery: boolean;
};

/**
 * 메시지 하나의 멱등키.
 *
 * 알림이 실어 보내는 메시지 자신의 시각(ms)이 사실상 메시지 고유 ID 다. 카톡은 같은 알림을
 * 여러 번 다시 올리는데(읽음 처리·묶음 갱신), 그때마다 지금 시각을 붙이면 같은 말이 두 번
 * 저장된다. 메시지 시각을 쓰면 몇 번을 다시 받아도 같은 키가 된다.
 *
 * ⚠️ tsMs 를 못 얻은 알림은 초 단위로 떨어진다. 그 초 안에 같은 사람이 같은 말을 두 번 하면
 *   한 건이 사라진다. 오픈채팅에서는 실제로 일어나는 일이라, 이 폴백이 얼마나 쓰이는지
 *   라우트가 로그로 남긴다. 자주 찍히면 봇의 시각 추출을 먼저 고칠 것.
 */
export function msgIdFor(tsMs: number | undefined, sender: string, text: string, receivedAt = Date.now()): string {
  const digest = createHash('md5').update(`${sender}|${text}`).digest('hex');
  if (tsMs && tsMs > 0) return `noti:${Math.round(tsMs)}:${digest}`;
  return `fb:${Math.floor(receivedAt / 1000)}:${digest}`;
}

export function sentAtFor(tsMs: number | undefined, receivedAt = Date.now()): string {
  const ms = tsMs && tsMs > 0 ? Math.round(tsMs) : receivedAt;
  return new Date(ms).toISOString();
}

/** 미리보기는 잘라서만 받는다. 봇이 길게 보내도 서버가 다시 자른다 — 저장하는 쪽이 책임진다. */
export function clampPreview(text: string | undefined): string | null {
  if (!text) return null;
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.slice(0, PREVIEW_MAX);
}

export function trimText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

type RoomRow = {
  id: string;
  room_key: string;
  followed: boolean;
  seen_count: number;
  message_count: number;
  display_name: string | null;
  name_hint: string | null;
};

async function loadRooms(keys: string[]): Promise<Map<string, RoomRow>> {
  const map = new Map<string, RoomRow>();
  if (!keys.length) return map;
  const { data, error } = await db()
    .from('rooms')
    .select('id, room_key, followed, seen_count, message_count, display_name, name_hint')
    .in('room_key', keys);
  if (error) throw new Error(`rooms 조회 실패: ${error.message}`);
  for (const r of (data ?? []) as RoomRow[]) map.set(r.room_key, r);
  return map;
}

/**
 * 배치 인입.
 *
 * ★ 순서가 규칙이다 — **팔로우 여부를 본문 저장보다 먼저 본다.**
 *   팔로우하지 않은 방의 본문은 한 글자도 저장하지 않는다. 이 순서를 뒤집는 순간
 *   개인 대화가 DB 에 남는다.
 *
 * ★ 방 행은 **방 찾기 모드일 때만** 만들어진다. 즉 후보 목록은 사람이 일부러 켰을 때만
 *   채워진다. 평소에는 이 폰에 개인 카톡이 아무리 와도 서버에 흔적이 남지 않는다.
 */
export async function ingestBatch(
  msgs: IncomingMsg[],
  seen: IncomingSeen[],
  now = Date.now(),
): Promise<IngestResult> {
  const state: AppState = await getAppState();
  const discovery = discoveryOn(state, now);

  const keys = Array.from(new Set([...msgs, ...seen].map((m) => trimText(m.key)).filter(Boolean)));
  const rooms = await loadRooms(keys);

  let seenCount = 0;

  // ── 1) 방 찾기 모드: 후보 기록. 본문은 앞 몇 자만, 시한부로 남는다 ──
  if (discovery && seen.length) {
    const expires = new Date(Date.parse(state.discoveryUntil!) ).toISOString();
    const byKey = new Map<string, { hits: number; sender: string | null; preview: string | null; hint: string; group: boolean }>();
    for (const s of seen) {
      const key = trimText(s.key);
      if (!key) continue;
      const cur = byKey.get(key) ?? { hits: 0, sender: null, preview: null, hint: '', group: false };
      cur.hits += 1;
      if (trimText(s.sender)) cur.sender = trimText(s.sender);
      const pv = clampPreview(s.preview);
      if (pv) cur.preview = pv;
      if (trimText(s.nameHint)) cur.hint = trimText(s.nameHint);
      if (s.group) cur.group = true;
      byKey.set(key, cur);
      seenCount += 1;
    }

    for (const [key, agg] of byKey) {
      const existing = rooms.get(key);
      if (existing) {
        const { error } = await db()
          .from('rooms')
          .update({
            seen_count: existing.seen_count + agg.hits,
            last_seen_at: new Date(now).toISOString(),
            last_sender: agg.sender,
            last_preview: agg.preview,
            preview_expires_at: expires,
            name_hint: agg.hint || existing.name_hint,
            is_group: agg.group,
          })
          .eq('id', existing.id);
        if (error) console.error('[gccity] 방 후보 갱신 실패:', error.message);
      } else {
        const { data, error } = await db()
          .from('rooms')
          .insert({
            room_key: key,
            name_hint: agg.hint || null,
            is_group: agg.group,
            seen_count: agg.hits,
            last_seen_at: new Date(now).toISOString(),
            last_sender: agg.sender,
            last_preview: agg.preview,
            preview_expires_at: expires,
          })
          .select('id, room_key, followed, seen_count, message_count, display_name, name_hint')
          .maybeSingle();
        // 같은 배치를 두 번 받으면 unique 충돌이 난다. 그건 정상이라 조용히 넘긴다.
        if (error && !error.message.includes('duplicate')) {
          console.error('[gccity] 방 후보 생성 실패:', error.message);
        }
        if (data) rooms.set(key, data as RoomRow);
      }
    }
  }

  // ── 2) 본문: 팔로우 중인 방만 ──
  let inserted = 0;
  let skipped = 0;
  let dropped = 0;

  const byRoom = new Map<string, IncomingMsg[]>();
  for (const m of msgs) {
    const key = trimText(m.key);
    if (!key) continue;
    const room = rooms.get(key);
    // ★ 팔로우 확인이 먼저다. 여기서 걸리면 본문은 어디에도 안 남는다.
    if (!room || !room.followed) {
      dropped += 1;
      continue;
    }
    const list = byRoom.get(key) ?? [];
    list.push(m);
    byRoom.set(key, list);
  }

  for (const [key, list] of byRoom) {
    const room = rooms.get(key)!;
    const rows = [];
    let latest = 0;
    for (const m of list) {
      const sender = trimText(m.sender);
      const text = trimText(m.text);
      if (!text) continue; // 입장·퇴장 같은 시스템 메시지
      const ms = typeof m.tsMs === 'number' && m.tsMs > 0 ? m.tsMs : 0;
      if (ms > latest) latest = ms;
      rows.push({
        room_id: room.id,
        msg_id: msgIdFor(ms || undefined, sender, text, now),
        sender,
        body: text,
        sent_at: sentAtFor(ms || undefined, now),
      });
    }
    if (!rows.length) continue;

    // 완전 유니크 제약이라 ignoreDuplicates 가 정상 동작한다(부분 인덱스면 조용히 실패한다).
    const { data, error } = await db()
      .from('messages')
      .upsert(rows, { onConflict: 'room_id,msg_id', ignoreDuplicates: true })
      .select('id');
    if (error) {
      console.error('[gccity] 메시지 저장 실패:', error.message);
      continue;
    }
    const got = data?.length ?? 0;
    inserted += got;
    skipped += rows.length - got;

    const { error: upErr } = await db()
      .from('rooms')
      .update({
        seen_count: room.seen_count + list.length,
        message_count: room.message_count + got,
        last_seen_at: new Date(now).toISOString(),
        last_message_at: sentAtFor(latest || undefined, now),
      })
      .eq('id', room.id);
    if (upErr) console.error('[gccity] 방 집계 갱신 실패:', upErr.message);
  }

  return {
    ok: true,
    inserted,
    skipped,
    dropped,
    seen: seenCount,
    configVersion: state.configVersion,
    discovery,
  };
}
