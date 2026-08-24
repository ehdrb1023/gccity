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
    // 시한이 지난 방 찾기 미리보기를 먼저 지운다 — 그래야 아래 조회가 지운 뒤 상태를 본다
    await expireStalePreviews();
    /*
     * ★ 나머지 셋은 서로 상관이 없으니 한꺼번에 띄운다. 줄줄이 await 하면 3초마다
     *   왕복 세 번을 차례로 기다리게 되고, 그 지연이 화면 반응 속도로 그대로 느껴진다.
     */
    const [state, rooms, messages] = await Promise.all([
      getAppState(),
      listRooms(),
      roomId ? listMessages(roomId) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      ok: true,
      bot: {
        lastSeenAt: state.botLastSeenAt,
        lastGapMs: state.botLastGapMs,
        build: state.botBuild,
        api2: state.botApi2,
        msgCount: state.botMsgCount,
        senderIdx: state.botSenderIdx,
        senderAuth: state.botSenderAuth,
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
