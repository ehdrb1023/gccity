import { NextResponse } from 'next/server';
import { discoveryOn, expireStalePreviews, getAppState } from '@/server/state';
import { listMessages, listRooms } from '@/server/rooms';

export const dynamic = 'force-dynamic';

/**
 * 대시보드가 몇 초마다 받아가는 전부. 화면 상태를 한 번에 내려보낸다.
 *
 * ★ 봇 상태를 서버 렌더 시각에 고정하지 말 것. 탭을 켜둔 채 30분이 지나면 멀쩡한 봇이
 *   "끊김" 으로 뜬다. 거짓 경보는 경보가 없느니만 못하다 — 한 번 헛울면 다음부터 아무도
 *   안 본다. 그래서 폴링으로 갱신한다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const roomId = url.searchParams.get('room');

  try {
    await expireStalePreviews();
    const state = await getAppState();
    const rooms = await listRooms();
    const messages = roomId ? await listMessages(roomId) : [];

    return NextResponse.json({
      ok: true,
      bot: {
        lastSeenAt: state.botLastSeenAt,
        lastGapMs: state.botLastGapMs,
      },
      discovery: { on: discoveryOn(state), until: state.discoveryUntil },
      rooms,
      messages,
      serverNow: new Date().toISOString(),
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[gccity] state 실패:', reason);
    return NextResponse.json({ ok: false, reason }, { status: 500 });
  }
}
