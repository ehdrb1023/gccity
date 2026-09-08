import Mark from '@/components/ui/Mark';
import { STAGES } from '@/lib/sla';

export const dynamic = 'force-dynamic';

/**
 * 로그인.
 *
 * ★ 폼 제출은 그대로 `POST /api/login` 이다 — 자바스크립트 없이도 들어와진다.
 *   라우트가 `formData()` 를 읽으므로 fetch·JSON 으로 바꾸지 말 것.
 *
 * ★ 실패 문구는 어느 쪽이 틀렸는지 말하지 않는다. 지금은 사용자가 하나뿐이라 계정
 *   열거가 성립하지 않지만, 문구를 갈라두면 계정이 생길 때 그대로 새는 자리가 된다.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  const err =
    e === 'unset'
      ? '서버에 비밀번호가 설정되어 있지 않습니다. 관리자에게 알려주세요.'
      : e === '1'
        ? '비밀번호가 맞지 않습니다. 다시 넣어주세요.'
        : null;

  return (
    <main className="login">
      <div className="login-box">
        <div className="login-mark">
          <Mark size={30} />
          <span className="nm">민원 콘솔</span>
        </div>

        <h1>
          접수부터 답변까지
          <br />
          기한 안에 처리됐는지 셉니다
        </h1>
        <p className="sub">흩어진 민원을 한곳에 모으고, 단계마다 얼마나 걸렸는지 숫자로 봅니다.</p>

        <div className="login-std">
          {STAGES.map((s) => (
            <div key={s.key}>
              <b>{s.step}</b>
              <span>
                {s.label} {s.limitHours}시간
              </span>
            </div>
          ))}
        </div>

        {/* 오류는 폼 위에 둔다 — 제출하고 돌아왔을 때 눈이 가장 먼저 닿는 자리다 */}
        {err && (
          <p className="err" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16v.01" />
            </svg>
            <span>{err}</span>
          </p>
        )}

        <form method="post" action="/api/login">
          <label className="lbl" htmlFor="pw">
            비밀번호
          </label>
          <input
            className="inp"
            id="pw"
            name="password"
            type="password"
            placeholder="비밀번호"
            autoComplete="current-password"
            style={{ marginBottom: 14 }}
            autoFocus
            required
          />
          <button className="btn pri lg" type="submit">
            들어가기
          </button>
        </form>

        <p className="foot">30일 동안 로그인이 유지됩니다.</p>
      </div>
    </main>
  );
}
