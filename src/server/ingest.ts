import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { getAppState, discoveryOn, type AppState } from './state';

/** 방 찾기 모드에서 올라오는 미리보기 최대 길이. 사람이 방을 알아볼 최소치만 남긴다. */
export const PREVIEW_MAX = 12;

/**
 * 봇이 보내는 첨부 정보. **바이트는 여기 없다.**
 *
 *   image  사진. 바이트는 /api/bot/photo 로 따로 온다(배치에 실으면 본문 상한 4.5MB 를 넘긴다).
 *          여기 image 가 오는 경우는 봇이 사진을 끝내 못 올린 때다 — 그 사실을 남기려고 온다.
 *   file   PDF·한글 같은 문서. **이름과 형식만** 받는다.
 *          바이트를 안 가져오는 것은 결정이다(2026-08-20) — 사람이 자료실에 직접 넣는다.
 */
export type IncomingAtt = {
  kind?: 'image' | 'file';
  name?: string;
  mime?: string;
};

export type IncomingMsg = {
  channelId: string;
  nameHint?: string;
  group?: boolean;
  sender?: string;
  text?: string;
  tsMs?: number;
  logId?: string;
  att?: IncomingAtt;
};

export type IncomingSeen = {
  channelId: string;
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
 * ★ 1순위는 카톡의 logId 다. API2 가 메시지마다 주는 고유 번호라, 같은 메시지를 몇 번 다시
 *   받아도 같은 키가 된다. 알림 열쇠 시절의 "메시지 시각 ms" 보다 확실하다.
 *
 * logId 를 못 얻으면 (시각, 발신자, 본문) 해시로 떨어진다. 이때 시각은 **폰이 메시지를 받은
 * 시각**이라 재전송이 늦어져도 값이 흔들리지 않는다(봇이 큐에 넣을 때 못 박아 보낸다).
 *
 * ⚠️ 시각조차 없으면 초 단위 폴백이다. 그 초 안에 같은 사람이 같은 말을 두 번 하면 한 건이
 *   사라진다. 오픈채팅에서는 실제로 일어나므로 라우트가 그 빈도를 로그로 남긴다.
 */
export function msgIdFor(
  m: { logId?: string; tsMs?: number; sender?: string; text?: string },
  receivedAt = Date.now(),
): string {
  const logId = trimText(m.logId);
  if (logId) return `log:${logId}`;
  const digest = createHash('md5').update(`${m.sender ?? ''}|${m.text ?? ''}`).digest('hex');
  if (m.tsMs && m.tsMs > 0) return `msg:${Math.round(m.tsMs)}:${digest}`;
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

/**
 * channelId 정규화. 사람도 봇도 여기를 지난다.
 *
 * 사람은 다른 봇 로그에서 `ch=[18409238712050393]` 처럼 통째로 복사해 붙인다. 그걸 그대로
 * 저장하면 봇이 보내는 값과 영영 안 맞는데, 화면에는 방이 멀쩡히 등록된 것으로 보인다 —
 * 이 프로젝트가 제일 경계하는 실패 모양이다. 그래서 숫자만 뽑아 쓴다.
 */
export function normalizeChannelId(v: unknown): string {
  const raw = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.slice(0, 24);
}

/** 옛 알림 열쇠(tag·id·getKey)로 만들어진 행인가. 화면에서 구분해 보여주기 위한 것뿐이다. */
export function isLegacyKey(channelId: string): boolean {
  return !/^[0-9]{6,}$/.test(channelId);
}

type RoomRow = {
  id: string;
  channel_id: string;
  followed: boolean;
  seen_count: number;
  message_count: number;
  display_name: string | null;
  name_hint: string | null;
};

const ROOM_COLS =
  'id, channel_id, followed, seen_count, message_count, display_name, name_hint';

export async function loadRooms(ids: string[]): Promise<Map<string, RoomRow>> {
  const map = new Map<string, RoomRow>();
  if (!ids.length) return map;
  const { data, error } = await db().from('rooms').select(ROOM_COLS).in('channel_id', ids);
  if (error) throw new Error(`rooms 조회 실패: ${error.message}`);
  for (const r of (data ?? []) as RoomRow[]) map.set(r.channel_id, r);
  return map;
}

/** 첨부만 온 메시지의 본문. 비워두면 화면에 빈 말풍선이 뜬다. */
function attFallbackText(att: IncomingAtt | undefined): string {
  if (!att) return '';
  const name = trimText(att.name);
  if (att.kind === 'image') return name ? `[사진] ${name}` : '[사진]';
  return name ? `[파일] ${name}` : '[파일]';
}

/**
 * 배치 인입.
 *
 * ★ 순서가 규칙이다 — **팔로우 여부를 본문 저장보다 먼저 본다.**
 *   팔로우하지 않은 방의 본문은 한 글자도 저장하지 않는다. 이 순서를 뒤집는 순간
 *   개인 대화가 DB 에 남는다.
 *
 * ★ 방 행은 **방 찾기 모드일 때, 또는 사람이 대시보드에서 channelId 를 직접 칠 때만**
 *   만들어진다. 평소에는 이 폰에 개인 카톡이 아무리 와도 서버에 흔적이 남지 않는다.
 */
export async function ingestBatch(
  msgs: IncomingMsg[],
  seen: IncomingSeen[],
  now = Date.now(),
): Promise<IngestResult> {
  const state: AppState = await getAppState();
  const discovery = discoveryOn(state, now);

  const ids = Array.from(
    new Set([...msgs, ...seen].map((m) => normalizeChannelId(m.channelId)).filter(Boolean)),
  );
  const rooms = await loadRooms(ids);

  let seenCount = 0;

  // ── 1) 방 찾기 모드: 후보 기록. 본문은 앞 몇 자만, 시한부로 남는다 ──
  if (discovery && seen.length) {
    const expires = new Date(Date.parse(state.discoveryUntil!)).toISOString();
    const byId = new Map<
      string,
      { hits: number; sender: string | null; preview: string | null; hint: string; group: boolean }
    >();
    for (const s of seen) {
      const id = normalizeChannelId(s.channelId);
      if (!id) continue;
      const cur = byId.get(id) ?? { hits: 0, sender: null, preview: null, hint: '', group: false };
      cur.hits += 1;
      if (trimText(s.sender)) cur.sender = trimText(s.sender);
      const pv = clampPreview(s.preview);
      if (pv) cur.preview = pv;
      if (trimText(s.nameHint)) cur.hint = trimText(s.nameHint);
      if (s.group) cur.group = true;
      byId.set(id, cur);
      seenCount += 1;
    }

    for (const [id, agg] of byId) {
      const existing = rooms.get(id);
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
            channel_id: id,
            name_hint: agg.hint || null,
            is_group: agg.group,
            seen_count: agg.hits,
            last_seen_at: new Date(now).toISOString(),
            last_sender: agg.sender,
            last_preview: agg.preview,
            preview_expires_at: expires,
          })
          .select(ROOM_COLS)
          .maybeSingle();
        // 같은 배치를 두 번 받으면 unique 충돌이 난다. 그건 정상이라 조용히 넘긴다.
        if (error && !error.message.includes('duplicate')) {
          console.error('[gccity] 방 후보 생성 실패:', error.message);
        }
        if (data) rooms.set(id, data as RoomRow);
      }
    }
  }

  // ── 2) 본문: 팔로우 중인 방만 ──
  let inserted = 0;
  let skipped = 0;
  let dropped = 0;

  const byRoom = new Map<string, IncomingMsg[]>();
  for (const m of msgs) {
    const id = normalizeChannelId(m.channelId);
    if (!id) continue;
    const room = rooms.get(id);
    // ★ 팔로우 확인이 먼저다. 여기서 걸리면 본문은 어디에도 안 남는다.
    if (!room || !room.followed) {
      dropped += 1;
      continue;
    }
    const list = byRoom.get(id) ?? [];
    list.push(m);
    byRoom.set(id, list);
  }

  for (const [id, list] of byRoom) {
    const room = rooms.get(id)!;
    const rows = [];
    let latest = 0;
    let hint = '';
    for (const m of list) {
      const sender = trimText(m.sender);
      const text = trimText(m.text);
      const att = m.att && (m.att.kind === 'image' || m.att.kind === 'file') ? m.att : undefined;
      // 본문도 첨부도 없으면 입장·퇴장 같은 시스템 메시지다.
      if (!text && !att) continue;
      if (trimText(m.nameHint)) hint = trimText(m.nameHint);
      const ms = typeof m.tsMs === 'number' && m.tsMs > 0 ? m.tsMs : 0;
      if (ms > latest) latest = ms;
      rows.push({
        room_id: room.id,
        msg_id: msgIdFor({ logId: m.logId, tsMs: ms || undefined, sender, text }, now),
        sender,
        body: text || attFallbackText(att),
        sent_at: sentAtFor(ms || undefined, now),
        // 사진 바이트는 /api/bot/photo 로 따로 온다. 여기 오는 image 는 봇이 못 올린 것이라
        // 경로가 없다 — 화면이 "사진(받지 못함)" 으로 드러낸다.
        attachment_path: null,
        attachment_type: att?.kind ?? null,
        attachment_name: att ? trimText(att.name).slice(0, 300) || null : null,
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

    const patch: Record<string, unknown> = {
      seen_count: room.seen_count + list.length,
      message_count: room.message_count + got,
      last_seen_at: new Date(now).toISOString(),
      last_message_at: sentAtFor(latest || undefined, now),
    };
    // 봇이 방 표시 이름을 실어 보내면 힌트로만 담는다. 사람이 붙인 display_name 이 우선이다.
    if (hint && !room.name_hint) patch.name_hint = hint;

    const { error: upErr } = await db().from('rooms').update(patch).eq('id', room.id);
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
