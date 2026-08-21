import { NextResponse } from 'next/server';
import { runDueSources } from '@/server/complaint-crawl';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 민원 출처 자동 수집. Vercel Cron 이 부른다(`vercel.json`).
 *
 * ★ 이 경로는 로그인 쿠키가 없다. 미들웨어의 `PUBLIC_PATHS` 에 `/api/cron/` 이 들어 있으니
 *   **문지기는 여기 하나뿐이다.** 아래 토큰 검사를 지우지 말 것.
 *
 * ★ fail-closed: `CRON_SECRET` 이 없으면 아무것도 하지 않는다. 봇 설정과 같은 원칙이다 —
 *   "무엇으로 막을지 모르는 채로 열어두는" 쪽으로 실패시키지 않는다.
 *   (Vercel 은 CRON_SECRET 이 설정돼 있으면 Authorization: Bearer 로 실어 보낸다.)
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[gccity] CRON_SECRET 없음 — 민원 자동 수집을 돌리지 않는다');
    return NextResponse.json({ ok: false, reason: 'CRON_SECRET 미설정' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  try {
    const results = await runDueSources();
    // 성공도 로그에 남긴다. 0곳이면 "주기가 아직 안 됐다" 지 "고장" 이 아니다
    console.log(`[gccity] 민원 자동 수집 ${results.length}곳:`, JSON.stringify(results));
    return NextResponse.json({ ok: true, ran: results.length, results });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[gccity] 민원 자동 수집 실패:', reason);
    return NextResponse.json({ ok: false, reason }, { status: 500 });
  }
}
