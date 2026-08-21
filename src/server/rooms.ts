import { db } from '@/lib/db';
import { isLegacyKey, normalizeChannelId } from './ingest';
import { signPhotoUrls } from './photos';
import { bumpConfigVersion } from './state';

export type Room = {
  id: string;
  channelId: string;
  legacyKey: boolean;      // 옛 알림 열쇠로 만들어진 행. 이제 아무것도 안 들어온다
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
  'id, channel_id, display_name, name_hint, followed, is_group, seen_count, message_count, last_seen_at, last_message_at, last_sender, last_preview';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRoom(r: any): Room {
  return {
    id: r.id,
    channelId: r.channel_id,
    legacyKey: isLegacyKey(String(r.channel_id ?? '')),
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

/** 봇에게 내려보낼 목록. **channelId 만** 내려보낸다 — 봇은 이름으로 방을 가리지 않는다. */
export async function followedChannelIds(): Promise<string[]> {
  const { data, error } = await db().from('rooms').select('channel_id').eq('followed', true);
  if (error) throw new Error(`팔로우 목록 조회 실패: ${error.message}`);
  return (data ?? []).map((r: { channel_id: string }) => r.channel_id);
}

/**
 * 대시보드에서 channelId 를 직접 쳐서 방을 등록한다.
 *
 * 방 찾기 모드를 켜지 않고도 방을 정할 수 있는 유일한 경로다 — 그리고 이쪽이 **개인정보를
 * 한 건도 흘리지 않는다.** 방 찾기는 켜져 있는 동안 이 폰의 모든 방(개인 카톡 포함)의
 * 발신자와 앞 12자를 서버로 올리지만, 여기는 사람이 아는 숫자 하나를 칠 뿐이다.
 *
 * 이름은 **따로 받는다.** channelId 를 방 이름으로 쓰면 화면이 숫자 무더기가 된다.
 * 이름은 언제든 [이름] 버튼으로 고칠 수 있고, 봇에게는 내려보내지 않는다.
 */
export async function addRoomByChannelId(rawId: string, name: string): Promise<{ id: string; created: boolean }> {
  const channelId = normalizeChannelId(rawId);
  if (!channelId) throw new Error('channelId 는 숫자다. 봇 로그의 ch=[…] 안 숫자를 넣을 것');
  if (channelId.length < 6) throw new Error(`channelId 가 너무 짧다 (${channelId}) — 잘못 붙여넣은 것 같다`);

  const clean = name.trim().slice(0, 60);

  const { data: existing, error: readErr } = await db()
    .from('rooms')
    .select('id, followed')
    .eq('channel_id', channelId)
    .maybeSingle();
  if (readErr) throw new Error(`방 조회 실패: ${readErr.message}`);

  if (existing) {
    const patch: Record<string, unknown> = {
      followed: true,
      followed_at: new Date().toISOString(),
      last_sender: null,
      last_preview: null,
      preview_expires_at: null,
    };
    if (clean) patch.display_name = clean;
    const { error } = await db().from('rooms').update(patch).eq('id', existing.id);
    if (error) throw new Error(`방 등록 실패: ${error.message}`);
    await bumpConfigVersion();
    return { id: existing.id, created: false };
  }

  const { data, error } = await db()
    .from('rooms')
    .insert({
      channel_id: channelId,
      display_name: clean || null,
      followed: true,
      followed_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`방 등록 실패: ${error.message}`);
  await bumpConfigVersion();
  return { id: data!.id, created: true };
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
 * 방과 그 대화를 지운다(cascade). 후보 목록·옛 열쇠 정리용이다.
 *
 * 팔로우 중인 방은 실수로 지우면 복구가 없다 — 지나간 대화는 다시 받을 수 없다.
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
  /** 'image' | 'file' | null. file 은 **이름만** 있다 — 바이트는 사람이 자료실에 넣는다 */
  attachmentType: string | null;
  attachmentName: string | null;
  /** 사진의 서명 URL. image 인데 이 값이 없으면 봇이 사진을 못 올린 것이다 */
  attachmentUrl: string | null;
};

export async function listMessages(roomId: string, limit = 200): Promise<Message[]> {
  const { data, error } = await db()
    .from('messages')
    .select('id, sender, body, sent_at, attachment_path, attachment_type, attachment_name')
    .eq('room_id', roomId)
    .order('sent_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`메시지 조회 실패: ${error.message}`);

  const rows = data ?? [];
  const signed = await signPhotoUrls(rows.map((m: any) => m.attachment_path).filter(Boolean));

  return rows
    .map((m: any) => ({
      id: Number(m.id),
      sender: m.sender,
      body: m.body,
      sentAt: m.sent_at,
      attachmentType: m.attachment_type,
      attachmentName: m.attachment_name,
      attachmentUrl: m.attachment_path ? signed.get(m.attachment_path) ?? null : null,
    }))
    .reverse(); // 화면은 오래된 것이 위
}
