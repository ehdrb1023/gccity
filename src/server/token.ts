import { safeEqual } from '@/lib/auth';

/**
 * 봇 인증. 헤더 하나가 전부다 — 봇에는 세션이 없다.
 *
 * 토큰이 설정돼 있지 않으면 **거부한다.** "설정 안 했으니 통과" 로 실패시키면
 * 배포에서 env 를 빠뜨린 순간 인입이 아무에게나 열린다.
 */
export function checkIngestToken(req: Request): { ok: true } | { ok: false; reason: string } {
  const expected = process.env.GCCITY_INGEST_TOKEN;
  if (!expected) return { ok: false, reason: 'server-token-missing' };
  const got = req.headers.get('x-ingest-token') ?? '';
  if (!got || !safeEqual(got, expected)) return { ok: false, reason: 'bad-token' };
  return { ok: true };
}
