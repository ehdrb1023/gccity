import { NextResponse } from 'next/server';
import { checkIngestToken } from '@/server/token';
import { discoveryOn, getAppState, touchHeartbeat } from '@/server/state';
import { followedKeys } from '@/server/rooms';

export const dynamic = 'force-dynamic';

/**
 * 봇이 주기적으로 받아가는 설정.
 *
 * ★ 이 라우트는 미들웨어의 PUBLIC_PATHS 에 반드시 들어 있어야 한다. 빠뜨리면 미들웨어가
 *   로그인 화면으로 리다이렉트하고, 봇은 HTML 을 받아 **조용히** 실패한다.
 *
 * 내려보내는 것은 **방 열쇠뿐이다.** 이름을 내려보내지 말 것 — 봇은 이름으로 방을 가리지
 * 않는다(이 단말의 카톡 알림에는 방 제목이 실려 오지 않는다). 화면에 보이는 이름은
 * 사람이 붙인 것이라 봇의 판정과 아무 관계가 없다.
 */
export async function GET(req: Request) {
  const auth = checkIngestToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: auth.reason }, { status: 401 });
  }

  try {
    await touchHeartbeat();
    const state = await getAppState();
    const follow = await followedKeys();
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
