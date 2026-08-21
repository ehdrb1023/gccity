import { NextResponse } from 'next/server';
import { checkIngestToken } from '@/server/token';
import { botNoteFrom, touchHeartbeat } from '@/server/state';
import { storePhoto } from '@/server/photos';

export const dynamic = 'force-dynamic';

/**
 * 사진 한 장 = 요청 한 번.
 *
 * ★ 배치(`/api/bot/ingest`)에 섞지 않는 이유: base64 는 원본의 4/3 이라 30건짜리 배치에
 *   사진 두 장만 들어가도 Vercel 함수 본문 상한(4.5MB)을 넘긴다. 그러면 그 배치의 **텍스트까지
 *   전부** 413 으로 튕긴다 — 사진 한 장 때문에 대화가 통째로 사라지는 셈이다.
 *
 * ★ 이 경로도 미들웨어의 PUBLIC_PATHS(`/api/bot/`) 안이라 로그인 없이 열린다.
 *   인증은 X-Ingest-Token 헤더 하나가 전부다.
 *
 * 실패는 사유를 그대로 돌려준다. 봇이 그 문자열을 로그에 찍는다.
 */
export async function POST(req: Request) {
  const auth = checkIngestToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: auth.reason }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }

  try {
    await touchHeartbeat(botNoteFrom(req));
    const result = await storePhoto({
      channelId: String(body.channelId ?? ''),
      sender: body.sender ? String(body.sender) : '',
      text: body.text ? String(body.text) : '',
      tsMs: typeof body.tsMs === 'number' ? body.tsMs : undefined,
      logId: body.logId ? String(body.logId) : undefined,
      name: body.name ? String(body.name) : '',
      mime: body.mime ? String(body.mime) : 'image/jpeg',
      b64: String(body.b64 ?? ''),
    });

    console.log(
      `[gccity] photo ch=${String(body.channelId ?? '')} ` +
        `stored=${result.stored}${result.reason ? ` reason=${result.reason}` : ''}` +
        (result.bytes ? ` bytes=${result.bytes}` : ''),
    );
    return NextResponse.json(result);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[gccity] photo 실패:', reason);
    // 503 이면 봇이 다시 보낸다. 사진은 지나가면 다시 못 얻으니 재시도가 맞다.
    return NextResponse.json({ ok: false, reason }, { status: 503 });
  }
}
