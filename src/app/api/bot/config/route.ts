import { NextResponse } from 'next/server';
import { checkIngestToken } from '@/server/token';
import { botNoteFrom, discoveryOn, getAppState, touchHeartbeat } from '@/server/state';
import { followedChannelIds } from '@/server/rooms';

export const dynamic = 'force-dynamic';

/**
 * 봇이 주기적으로 받아가는 설정.
 *
 * ★ 이 라우트는 미들웨어의 PUBLIC_PATHS 에 반드시 들어 있어야 한다. 빠뜨리면 미들웨어가
 *   로그인 화면으로 리다이렉트하고, 봇은 HTML 을 받아 **조용히** 실패한다.
 *
 * 내려보내는 것은 **channelId 뿐이다.** 이름을 내려보내지 말 것 — 봇은 이름으로 방을
 * 가리지 않는다(이 폰의 `chat.room` 은 방 제목이 아니라 알림 제목이라 못 믿는다).
 * 화면에 보이는 이름은 사람이 붙인 것이라 봇의 판정과 아무 관계가 없다.
 *
 * 봇은 이 요청의 쿼리에 자기 상태를 얹어 보낸다(`?build=…&api2=1&msgs=12`).
 * API2 가 안 켜지면 channelId 가 아예 없어 수집이 조용히 0 건이 되는데, 그 상태를
 * 화면에서 알아볼 수 있는 곳이 여기뿐이다.
 */
export async function GET(req: Request) {
  const auth = checkIngestToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: auth.reason }, { status: 401 });
  }

  try {
    await touchHeartbeat(botNoteFrom(req));
    const state = await getAppState();
    const follow = await followedChannelIds();
    return NextResponse.json({
      ok: true,
      version: state.configVersion,
      discovery: discoveryOn(state),
      discoveryUntil: state.discoveryUntil,
      follow,
    });
  } catch (e) {
    // 사유를 그대로 돌려준다. 봇 로그에 찍혀야 사람이 원인을 안다 —
    // "200 인데 아무것도 안 온다" 가 제일 비싼 실패다.
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[gccity] config 실패:', reason);
    return NextResponse.json({ ok: false, reason }, { status: 503 });
  }
}
