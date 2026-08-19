import { db } from '@/lib/db';
import { bumpConfigVersion } from './state';

export type Room = {
  id: string;
  roomKey: string;
  displayName: string | null;
  nameHint: string | null;
  followed: boolean;
  isGroup: boolean;
  seenCount: number;
  messageCount: number;
  lastSeenAt: string | null;
  lastMessageAt: string | null;
  lastSender: string | null;
  lastPreview: string | null;
};

const SELECT =
  'id, room_key, display_name, name_hint, followed, is_group, seen_count, message_count, last_seen_at, last_message_at, last_sender, last_preview';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRoom(r: any): Room {
  return {
    id: r.id,
    roomKey: r.room_key,
    displayName: r.display_name,
    nameHint: r.name_hint,
    followed: r.followed,
    isGroup: r.is_group,
    seenCount: r.seen_count,
    messageCount: r.message_count,
    lastSeenAt: r.last_seen_at,
    lastMessageAt: r.last_message_at,
    lastSender: r.last_sender,
    lastPreview: r.last_preview,
  };
}

export async function listRooms(): Promise<Room[]> {
  const { data, error } = await db()
    .from('rooms')
    .select(SELECT)
    .order('followed', { ascending: false })
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(`rooms 목록 조회 실패: ${error.message}`);
  return (data ?? []).map(toRoom);
}

/** 봇에게 내려보낼 목록. **열쇠만** 내려보낸다 — 봇은 이름으로 방을 가리지 않는다. */
export async function followedKeys(): Promise<string[]> {
  const { data, error } = await db().from('rooms').select('room_key').eq('followed', true);
  if (error) throw new Error(`팔로우 목록 조회 실패: ${error.message}`);
  return (data ?? []).map((r: { room_key: string }) => r.room_key);
}

export async function setFollowed(id: string, followed: boolean): Promise<void> {
  const patch: Record<string, unknown> = { followed };
  if (followed) patch.followed_at = new Date().toISOString();
  // 팔로우를 켜는 순간 그 방의 미리보기 단서는 필요 없어진다. 이제 본문이 제대로 쌓인다.
  if (followed) {
    patch.last_sender = null;
    patch.last_preview = null;
    patch.preview_expires_at = null;
  }
  const { error } = await db().from('rooms').update(patch).eq('id', id);
  if (error) throw new Error(`팔로우 변경 실패: ${error.message}`);
  await bumpConfigVersion();
}

export async function renameRoom(id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 60);
  const { error } = await db()
    .from('rooms')
    .update({ display_name: clean || null })
    .eq('id', id);
  if (error) throw new Error(`이름 변경 실패: ${error.message}`);
  // 봇에게는 이름을 안 내려보내므로 config 를 올릴 이유가 없다.
}

/**
 * 방과 그 대화를 지운다(cascade). 후보 목록 정리용이다.
 *
 * 팔로우 중인 방은 실수로 지우면 복구가 없다 — 알림은 지나가면 끝이라 다시 받을 수 없다.
 * 그래서 팔로우를 먼저 끄게 하고, 켜져 있으면 거부한다.
 */
export async function deleteRoom(id: string): Promise<void> {
  const { data, error: readErr } = await db().from('rooms').select('followed').eq('id', id).maybeSingle();
  if (readErr) throw new Error(`방 조회 실패: ${readErr.message}`);
  if (!data) throw new Error('없는 방이다');
  if (data.followed) throw new Error('팔로우 중인 방은 지울 수 없다. 먼저 팔로우를 끌 것');
  const { error } = await db().from('rooms').delete().eq('id', id);
  if (error) throw new Error(`방 삭제 실패: ${error.message}`);
  await bumpConfigVersion();
}

export type Message = {
  id: number;
  sender: string;
  body: string;
  sentAt: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  attachmentName: string | null;
};

export async function listMessages(roomId: string, limit = 200): Promise<Message[]> {
  const { data, error } = await db()
    .from('messages')
    .select('id, sender, body, sent_at, attachment_url, attachment_type, attachment_name')
    .eq('room_id', roomId)
    .order('sent_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`메시지 조회 실패: ${error.message}`);
  return (data ?? [])
    .map((m: any) => ({
      id: Number(m.id),
      sender: m.sender,
      body: m.body,
      sentAt: m.sent_at,
      attachmentUrl: m.attachment_url,
      attachmentType: m.attachment_type,
      attachmentName: m.attachment_name,
    }))
    .reverse(); // 화면은 오래된 것이 위
}
