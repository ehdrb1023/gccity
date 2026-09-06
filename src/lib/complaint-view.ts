/**
 * 민원 목록의 "무엇이 화면에 뜨는가" 를 정하는 **하나뿐인 정의**.
 *
 * 서버(`countByStatus` 의 칩 숫자)와 화면(`Dashboard.tsx` 의 줄 목록)이 이것을 함께 쓴다.
 * `src/server/complaints.ts` 는 `'use server'` 쪽이라 클라이언트 컴포넌트가 import 할 수
 * 없어서, 양쪽이 닿는 `lib` 에 둔다.
 *
 * ★ 예전에는 같은 조건이 두 곳에 각각 적혀 있었다. 한쪽에만 거르개를 더한 순간
 *   `새 민원 28` 을 눌렀는데 7줄만 뜨고, 사람은 화면이 뭔가 빠뜨렸다고 읽는다
 *   (실측 2026-08-24). 주석으로 "양쪽을 같이 고칠 것" 이라 적어둔 것으로는 못 막았다 —
 *   그래서 조건을 함수 하나로 옮겼다. 여기 말고 다른 데에 조건을 적지 말 것.
 */
export type ListedInput = {
  aiDraft: boolean;
  duplicateOf: string | null;
  resolutionOf: string | null;
};

/**
 * 목록에 줄로 서는 민원인가.
 *
 * - 초안(`aiDraft`)은 확정 전이라 검토 보드에 있지 목록에 없다
 * - 중복(`duplicateOf`)은 가려둔 것이다. 지운 것이 아니라 목록에서 내렸을 뿐이다
 * - 이어둔 처리 글(`resolutionOf`)은 민원 줄 안으로 접혀 들어가 따로 서지 않는다
 */
export function isListed(c: ListedInput): boolean {
  return !c.aiDraft && !c.duplicateOf && !c.resolutionOf;
}
