import { NextResponse } from 'next/server';
import { runDigest } from '@/server/digest';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 카톡 대화 → 민원 초안 자동 추출. Vercel Cron 이 부른다(`vercel.json`).
 *
 * ★ 쿠키가 없는 경로다. 미들웨어의 `PUBLIC_PATHS` 에 `/api/cron/` 이 들어 있으니
 *   문지기는 아래 토큰 검사 하나뿐이다. 지우지 말 것.
 *
 * ★ 창은 **마지막 성공 실행의 끝**부터다. cron 이 몇 번 걸러도 구멍이 나지 않는다.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[gccity] CRON_SECRET 없음 — 민원 분석을 돌리지 않는다');
    return NextResponse.json({ ok: false, reason: 'CRON_SECRET 미설정' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const out = await runDigest();
  console.log('[gccity] 민원 분석:', JSON.stringify(out));
  // 실패해도 200 으로 돌려준다 — 사유가 digest_runs 와 화면에 남고, cron 재시도는 의미가 없다
  return NextResponse.json(out);
}
