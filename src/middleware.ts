import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, isAuthed } from '@/lib/auth';

/**
 * ★ 봇 라우트를 새로 만들면 여기에 반드시 추가할 것.
 *
 * 빠뜨리면 미들웨어가 로그인 화면으로 307 리다이렉트하고, 봇은 HTML 을 받아 **조용히**
 * 실패한다. 봇 로그에는 "POST 200" 만 남고 DB 는 안 늘고 화면은 멀쩡하다.
 * 이 프로젝트가 제일 경계하는 실패 모양이다.
 */
/*
 * /api/cron/ 도 쿠키가 없다(Vercel Cron 이 부른다). 그쪽은 라우트가 CRON_SECRET 을
 * 직접 검사한다 — 여기서 빼면 로그인 화면 HTML 을 받고 자동 수집이 조용히 멈춘다.
 */
const PUBLIC_PATHS = ['/api/bot/', '/api/cron/', '/login', '/api/login'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const ok = await isAuthed(req.cookies.get(AUTH_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
