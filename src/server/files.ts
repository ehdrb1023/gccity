import { db } from '@/lib/db';

/**
 * 자료실 — 카톡방별 문서 보관소.
 *
 * ★ 파일 바이트는 이 서버를 지나가지 않는다.
 *   브라우저가 Supabase Storage 로 **직접** 올린다(`signUpload` 가 준 서명 URL).
 *   Vercel 함수의 요청 본문 상한이 4.5MB 라, 서버를 거치게 만들면 그보다 큰 PDF 가
 *   전부 막힌다. 계약서 스캔본은 그 선을 쉽게 넘는다.
 *
 * ★ 버킷은 비공개다. 내려받기도 서명 URL 로만 된다(`signDownload`).
 *   공개 버킷으로 바꾸지 말 것 — 경로를 아는 사람이 전부 받아간다.
 */

export const BUCKET = 'room-files';
export const MAX_BYTES = 50 * 1024 * 1024;
const SIGNED_TTL_S = 60 * 10;

export type StoredFile = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  note: string | null;
  createdAt: string;
};

/**
 * 파일명은 Storage 경로에 그대로 쓰지 않는다.
 * 한글·공백·`/` 가 섞이면 경로가 깨지거나 다른 폴더를 가리킨다. 보이는 이름은 DB 에 두고,
 * 경로에는 안전한 문자만 남긴다.
 */
function safeSlug(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  return ext ? `f.${ext}` : 'f';
}

export async function listFiles(roomId: string): Promise<StoredFile[]> {
  const { data, error } = await db()
    .from('files')
    .select('id, name, mime, size_bytes, note, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw new Error(`자료 목록 실패: ${error.message}`);
  return (data ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mime: f.mime,
    sizeBytes: Number(f.size_bytes),
    note: f.note,
    createdAt: f.created_at,
  }));
}

/** 브라우저가 곧바로 올릴 수 있는 서명 URL. 경로는 서버가 정한다(방 밖으로 못 쓰게). */
export async function signUpload(roomId: string, name: string, size: number) {
  if (!name.trim()) throw new Error('파일명이 없다');
  if (size > MAX_BYTES) throw new Error(`파일이 너무 크다 (상한 ${Math.round(MAX_BYTES / 1024 / 1024)}MB)`);

  const { data: room, error: rErr } = await db()
    .from('rooms').select('id').eq('id', roomId).maybeSingle();
  if (rErr) throw new Error(`방 조회 실패: ${rErr.message}`);
  if (!room) throw new Error('없는 방이다');

  const path = `${roomId}/${crypto.randomUUID()}-${safeSlug(name)}`;
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`업로드 URL 발급 실패: ${error.message}`);
  return { path, token: data.token, signedUrl: data.signedUrl };
}

/**
 * 올린 뒤 목록에 등록한다.
 * ★ Storage 에 실제로 있는지 먼저 본다 — 확인 없이 행을 만들면 목록에는 있는데
 *   받으면 404 인 유령 자료가 생긴다. "조용히 성공하는 실패" 의 전형이다.
 */
export async function confirmUpload(input: {
  roomId: string; path: string; name: string; mime: string; size: number; note?: string;
}) {
  if (!input.path.startsWith(`${input.roomId}/`)) throw new Error('경로가 방과 맞지 않는다');

  const dir = input.path.slice(0, input.path.lastIndexOf('/'));
  const base = input.path.slice(input.path.lastIndexOf('/') + 1);
  const { data: found, error: lErr } = await db().storage.from(BUCKET).list(dir, { search: base });
  if (lErr) throw new Error(`저장 확인 실패: ${lErr.message}`);
  if (!found?.some((o: { name: string }) => o.name === base)) throw new Error('업로드된 파일을 찾지 못했다');

  const { error } = await db().from('files').insert({
    room_id: input.roomId,
    name: input.name.slice(0, 300),
    path: input.path,
    mime: input.mime.slice(0, 120),
    size_bytes: input.size,
    note: input.note?.slice(0, 500) || null,
  });
  if (error) throw new Error(`자료 등록 실패: ${error.message}`);
}

/** 내려받기용 서명 URL. 원본 파일명으로 받아지게 이름을 실어 보낸다. */
export async function signDownload(fileId: string): Promise<string> {
  const { data: f, error } = await db()
    .from('files').select('path, name').eq('id', fileId).maybeSingle();
  if (error) throw new Error(`자료 조회 실패: ${error.message}`);
  if (!f) throw new Error('없는 자료다');

  const { data, error: sErr } = await db().storage
    .from(BUCKET)
    .createSignedUrl(f.path, SIGNED_TTL_S, { download: f.name });
  if (sErr) throw new Error(`내려받기 URL 발급 실패: ${sErr.message}`);
  return data.signedUrl;
}

/** 행과 실제 파일을 함께 지운다. 행만 지우면 버킷에 쓰레기가 남는다. */
export async function deleteFile(fileId: string) {
  const { data: f, error } = await db()
    .from('files').select('path').eq('id', fileId).maybeSingle();
  if (error) throw new Error(`자료 조회 실패: ${error.message}`);
  if (!f) return;

  const { error: sErr } = await db().storage.from(BUCKET).remove([f.path]);
  if (sErr) throw new Error(`파일 삭제 실패: ${sErr.message}`);

  const { error: dErr } = await db().from('files').delete().eq('id', fileId);
  if (dErr) throw new Error(`자료 삭제 실패: ${dErr.message}`);
}

/** 메모만 고친다. */
export async function renoteFile(fileId: string, note: string) {
  const { error } = await db()
    .from('files').update({ note: note.trim().slice(0, 500) || null }).eq('id', fileId);
  if (error) throw new Error(`메모 저장 실패: ${error.message}`);
}
