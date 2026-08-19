import { NextResponse } from 'next/server';
import { confirmUpload, deleteFile, listFiles, renoteFile, signDownload, signUpload } from '@/server/files';

export const dynamic = 'force-dynamic';

/** 방 하나의 자료 목록. 대시보드가 자료실 탭에서만 부른다(상태 폴링에 얹지 않는다). */
export async function GET(req: Request) {
  const roomId = new URL(req.url).searchParams.get('room');
  if (!roomId) return NextResponse.json({ ok: false, reason: 'room 없음' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, files: await listFiles(roomId) });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[gccity] 자료 목록 실패:', reason);
    return NextResponse.json({ ok: false, reason }, { status: 500 });
  }
}

/**
 * 업로드는 두 걸음이다 — sign 으로 서명 URL 을 받고, 브라우저가 Storage 에 직접 올린 뒤,
 * confirm 으로 목록에 등록한다. 파일 바이트가 이 서버를 지나가지 않는 이유는
 * `src/server/files.ts` 머리말 참조(Vercel 본문 상한 4.5MB).
 */
export async function POST(req: Request) {
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'sign': {
        const out = await signUpload(String(body.roomId ?? ''), String(body.name ?? ''), Number(body.size ?? 0));
        return NextResponse.json({ ok: true, ...out });
      }
      case 'confirm': {
        await confirmUpload({
          roomId: String(body.roomId ?? ''),
          path: String(body.path ?? ''),
          name: String(body.name ?? ''),
          mime: String(body.mime ?? ''),
          size: Number(body.size ?? 0),
          note: body.note ? String(body.note) : undefined,
        });
        return NextResponse.json({ ok: true });
      }
      case 'download': {
        return NextResponse.json({ ok: true, url: await signDownload(String(body.id ?? '')) });
      }
      case 'note': {
        await renoteFile(String(body.id ?? ''), String(body.note ?? ''));
        return NextResponse.json({ ok: true });
      }
      case 'delete': {
        await deleteFile(String(body.id ?? ''));
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, reason: 'unknown-action' }, { status: 400 });
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }
}
