export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;

  return (
    <main className="login">
      <form method="post" action="/api/login">
        <h1>gccity</h1>
        <p>카톡 오픈채팅방 수집 대시보드</p>
        {e === 'unset' && <p className="err">서버에 GCCITY_PASSWORD 가 설정되지 않았다.</p>}
        {e === '1' && <p className="err">비밀번호가 다르다.</p>}
        <input type="password" name="password" placeholder="비밀번호" autoFocus required />
        <button className="btn primary" type="submit">들어가기</button>
      </form>
    </main>
  );
}
