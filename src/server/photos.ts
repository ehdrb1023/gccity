import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { loadRooms, msgIdFor, normalizeChannelId, sentAtFor, trimText } from './ingest';

/**
 * 대화에 딸린 사진.
 *
 * ★ 자료실(`files` 테이블 · `room-files` 버킷)과 다른 곳에 쌓는다.
 *   자료실은 **사람이 손으로 챙겨 넣는 문서** 목록이고, 여기 오는 것은 방금 지나간 대화의
 *   일부다. 한 버킷에 섞으면 계약서를 찾으러 들어간 자료실이 짤로 뒤덮인다.
 *
 * ★ 사진은 배치(`/api/bot/ingest`)에 실리지 않는다. base64 가 수백 KB~3MB 라 30건짜리
 *   배치에 섞으면 Vercel 함수 본문 상한(4.5MB)을 그대로 넘긴다. 그래서 한 장에 한 요청이다.
 *
 * ★ 팔로우 확인이 **바이트를 만지기 전에** 온다. 팔로우하지 않은 방의 사진은 디코딩조차
 *   하지 않는다 — 버킷에 남기지 않는 정도가 아니라 서버 메모리에도 올리지 않는다.
 */
export const PHOTO_BUCKET = 'room-photos';

/** base64 를 푼 바이트 상한. 봇이 1600px·JPEG80 으로 줄여 보내므로 평소 200KB 안쪽이다. */
const MAX_BYTES = 6 * 1024 * 1024;

export type PhotoInput = {
  channelId: string;
  sender?: string;
  text?: string;
  tsMs?: number;
  logId?: string;
  name?: string;
  mime?: string;
  b64: string;
};

export type PhotoResult = {
  ok: true;
  stored: boolean;
  reason?: string;   // 저장하지 않았다면 왜인지. 봇 로그에 그대로 찍힌다
  bytes?: number;
};

export async function storePhoto(input: PhotoInput, now = Date.now()): Promise<PhotoResult> {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) return { ok: true, stored: false, reason: 'no-channel-id' };

  // ★ 순서. 방을 먼저 본다.
  const rooms = await loadRooms([channelId]);
  const room = rooms.get(channelId);
  if (!room || !room.followed) {
    return { ok: true, stored: false, reason: 'not-followed' };
  }

  const raw = String(input.b64 ?? '').replace(/^data:[^;]+;base64,/, '');
  if (!raw) return { ok: true, stored: false, reason: 'empty-body' };

  const bytes = Buffer.from(raw, 'base64');
  if (!bytes.length) return { ok: true, stored: false, reason: 'bad-base64' };
  if (bytes.length > MAX_BYTES) {
    return { ok: true, stored: false, reason: `too-big:${bytes.length}` };
  }

  // 내용 해시로 경로를 정한다. 봇이 재시도로 같은 사진을 두 번 올려도 같은 자리에 덮인다 —
  // 버킷에 쌍둥이 파일이 쌓이지 않는다.
  const digest = createHash('md5').update(bytes).digest('hex').slice(0, 16);
  const path = `${room.id}/${digest}.jpg`;

  const { error: upErr } = await db()
    .storage.from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType: input.mime || 'image/jpeg', upsert: true });
  if (upErr) {
    // 여기서 500 을 내면 봇이 사진을 다시 보낸다. 그게 맞다 — 사진은 다시 못 얻는다.
    throw new Error(`사진 업로드 실패: ${upErr.message}`);
  }

  const sender = trimText(input.sender);
  const text = trimText(input.text);
  const name = trimText(input.name).slice(0, 300);
  const ms = typeof input.tsMs === 'number' && input.tsMs > 0 ? input.tsMs : 0;

  const row = {
    room_id: room.id,
    msg_id: msgIdFor({ logId: input.logId, tsMs: ms || undefined, sender, text: text || path }, now),
    sender,
    body: text || (name ? `[사진] ${name}` : '[사진]'),
    sent_at: sentAtFor(ms || undefined, now),
    attachment_path: path,
    attachment_type: 'image',
    attachment_name: name || null,
  };

  const { data, error } = await db()
    .from('messages')
    .upsert([row], { onConflict: 'room_id,msg_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`사진 메시지 저장 실패: ${error.message}`);

  const got = data?.length ?? 0;
  const { error: rErr } = await db()
    .from('rooms')
    .update({
      seen_count: room.seen_count + 1,
      message_count: room.message_count + got,
      last_seen_at: new Date(now).toISOString(),
      last_message_at: sentAtFor(ms || undefined, now),
    })
    .eq('id', room.id);
  if (rErr) console.error('[gccity] 방 집계 갱신 실패(사진):', rErr.message);

  return { ok: true, stored: got > 0, reason: got > 0 ? undefined : 'duplicate', bytes: bytes.length };
}

/**
 * 비공개 버킷이라 `<img>` 로 띄우려면 서명 URL 이 필요하다.
 * 한 번에 묶어 서명한다 — 200건짜리 화면을 건건이 서명하면 왕복이 200번이다.
 */
export async function signPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return out;

  const { data, error } = await db().storage.from(PHOTO_BUCKET).createSignedUrls(unique, 3600);
  if (error || !data) {
    console.error('[gccity] 사진 서명 실패:', error?.message ?? '알 수 없음');
    return out;
  }
  for (const d of data) {
    if (d.signedUrl && d.path) out.set(d.path, d.signedUrl);
  }
  return out;
}
