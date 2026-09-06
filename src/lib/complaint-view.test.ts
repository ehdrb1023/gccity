import { describe, expect, it } from 'vitest';
import { isListed, type ListedInput } from './complaint-view';

/**
 * 이 테스트가 지키는 것은 함수 하나가 아니라 **화면과 칩이 같은 판정을 쓴다는 사실**이다.
 *
 * 실측 2026-08-24: 조건이 서버(`countByStatus`)와 화면(`Dashboard.tsx`)에 각각 적혀 있었고,
 * 화면에만 출처 거르개가 붙어 `새 민원 28` 을 눌렀는데 7줄만 떴다. 그때는 주석으로
 * "양쪽을 같이 고칠 것" 이라고만 적어뒀는데 다음 커밋이 그대로 어겼다.
 */

const base: ListedInput = { aiDraft: false, duplicateOf: null, resolutionOf: null };

describe('isListed', () => {
  it('셋 다 아니면 목록에 선다', () => {
    expect(isListed(base)).toBe(true);
  });

  it('AI 초안은 목록에 서지 않는다 — 확정 전이라 검토 보드에 있다', () => {
    expect(isListed({ ...base, aiDraft: true })).toBe(false);
  });

  it('중복으로 내린 글은 목록에 서지 않는다', () => {
    expect(isListed({ ...base, duplicateOf: 'c-1' })).toBe(false);
  });

  it('민원에 이어둔 처리 글은 목록에 서지 않는다 — 민원 줄 안으로 접힌다', () => {
    expect(isListed({ ...base, resolutionOf: 'c-1' })).toBe(false);
  });

  /**
   * 세 조건이 **전부 OR 로 배제**여야 한다. 하나라도 AND 로 바뀌면
   * "초안이면서 중복인 것" 만 걸러지고 나머지가 목록에 샌다.
   */
  it('배제 조건은 하나만 걸려도 내려간다', () => {
    const cases: ListedInput[] = [
      { aiDraft: true, duplicateOf: 'c-1', resolutionOf: null },
      { aiDraft: true, duplicateOf: null, resolutionOf: 'c-2' },
      { aiDraft: false, duplicateOf: 'c-1', resolutionOf: 'c-2' },
      { aiDraft: true, duplicateOf: 'c-1', resolutionOf: 'c-2' },
    ];
    for (const c of cases) expect(isListed(c)).toBe(false);
  });

  /**
   * ★ 핵심 회귀 — 칩 숫자와 줄 수가 같은가.
   *
   * 서버는 같은 조건으로 상태별 건수를 세고 화면은 같은 조건으로 줄을 그린다.
   * 두 계산이 `isListed` 하나만 거치면 어떤 표본에서도 합이 어긋날 수 없다.
   * 여기서 배열을 두 번 서로 다르게 거르면 이 단언이 깨진다.
   */
  it('상태별 건수의 합이 목록 줄 수와 같다', () => {
    const rows = [
      { ...base, status: 'new' },
      { ...base, status: 'new' },
      { ...base, status: 'doing' },
      { ...base, status: 'done' },
      { ...base, aiDraft: true, status: 'new' },
      { ...base, duplicateOf: 'c-1', status: 'done' },
      { ...base, resolutionOf: 'c-2', status: 'done' },
    ];

    const listed = rows.filter(isListed);
    const counts = listed.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    expect(listed).toHaveLength(4);
    expect(counts).toEqual({ new: 2, doing: 1, done: 1 });
    // 칩 숫자를 전부 더하면 눈앞의 줄 수가 나와야 한다
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(listed.length);
  });
});
