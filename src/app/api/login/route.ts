import { NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData();
  const pw = String(form.get('password') ?? '');
  const configured = process.env.GCCITY_PASSWORD;

  if (!configured) {
    return NextResponse.redirect(new URL('/login?e=unset', req.url), 303);
  }
  if (pw !== configured) {
    return NextResponse.redirect(new URL('/login?e=1', req.url), 303);
  }

  const token = await authToken();
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  res.cookies.set(AUTH_COOKIE, token!, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
