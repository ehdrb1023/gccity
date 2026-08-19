/**
 * 단일 사용자용 비밀번호 한 겹.
 *
 * 세션 저장소를 두지 않는다 — 쿠키 값이 비밀번호에서 유도된 상수라 서버가 매번 다시 계산해
 * 비교하면 끝이다. 사용자가 하나뿐이라 로그아웃·만료·기기별 세션 같은 개념이 필요 없다.
 * 비밀번호를 바꾸면 기존 쿠키는 자동으로 무효가 된다.
 *
 * Web Crypto 만 쓰는 이유: 미들웨어(Edge 런타임)와 라우트 핸들러 양쪽에서 같은 코드가 돌아야 한다.
 */
export const AUTH_COOKIE = 'gccity_auth';

export async function authToken(): Promise<string | null> {
  const pw = process.env.GCCITY_PASSWORD;
  if (!pw) return null;
  const bytes = new TextEncoder().encode('gccity|v1|' + pw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 길이가 달라도 타이밍이 새지 않게 상수 시간 비교. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAuthed(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await authToken();
  if (!expected) return false;
  return safeEqual(cookieValue, expected);
}
