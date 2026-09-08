import { describe, expect, it } from 'vitest';
import { STAGES, compliance, isLate, slaView, stageHours, stageState, type SlaInput } from './sla';

/**
 * 이 테스트가 지키는 것은 숫자 계산이 아니라 **늦은 것이 늦다고 나오는가**이다.
 * 기록이 비어 있을 때 조용히 `대기` 로 두면 준수율에서 통째로 빠진다.
 */

const NOW = Date.parse('2026-09-07T00:00:00Z');
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString();
const at = (from: string, n: number) => new Date(Date.parse(from) + n * 3_600_000).toISOString();

const none: SlaInput = { reportedAt: null, assignedAt: null, visitedAt: null, resolvedAt: null };

describe('stageState', () => {
  it('한도 안이면 ok', () => {
    expect(stageState(6, 12, 6)).toBe('ok');
  });

  it('한도의 80%를 넘으면 warn — 아직 안 늦었지만 곧이다', () => {
    expect(stageState(11, 12, 11)).toBe('warn');
  });

  it('한도를 넘으면 late', () => {
    expect(stageState(13, 12, 13)).toBe('late');
  });

  it('기록이 없고 한도도 아직이면 wait', () => {
    expect(stageState(null, 12, 5)).toBe('wait');
  });

  /**
   * ★ 핵심. 기록이 없는데 한도가 지났으면 `wait` 이 아니라 `late` 다.
   *   여기가 `wait` 로 돌아오면 열흘 묵은 민원이 영원히 대기로 남고 준수율에서 빠진다.
   */
  it('기록이 없고 한도가 지났으면 late — 대기로 숨기지 않는다', () => {
    expect(stageState(null, 12, 100)).toBe('late');
  });

  it('접수일조차 없으면 잴 수 없으니 wait', () => {
    expect(stageState(null, 12, null)).toBe('wait');
  });
});

describe('stageHours', () => {
  it('접수 기준으로 각 단계까지의 시간을 잰다', () => {
    const r = h(48);
    const c: SlaInput = { reportedAt: r, assignedAt: at(r, 5), visitedAt: at(r, 20), resolvedAt: at(r, 40) };
    expect(stageHours(c)).toEqual({ assign: 5, visit: 20, reply: 40 });
  });

  it('기록이 없는 단계는 null 이다 — 0 이 아니다', () => {
    expect(stageHours({ ...none, reportedAt: h(10) })).toEqual({ assign: null, visit: null, reply: null });
  });
});

describe('isLate', () => {
  it('세 단계 모두 한도 안이면 늦지 않았다', () => {
    const r = h(80);
    expect(isLate({ reportedAt: r, assignedAt: at(r, 4), visitedAt: at(r, 20), resolvedAt: at(r, 60) }, NOW)).toBe(false);
  });

  it('한 단계만 넘겨도 늦은 것이다', () => {
    const r = h(80);
    expect(isLate({ reportedAt: r, assignedAt: at(r, 30), visitedAt: at(r, 32), resolvedAt: at(r, 60) }, NOW)).toBe(true);
  });

  it('접수한 지 오래인데 아무 기록이 없으면 늦은 것이다', () => {
    expect(isLate({ ...none, reportedAt: h(200) }, NOW)).toBe(true);
  });

  it('막 접수한 건은 늦지 않았다', () => {
    expect(isLate({ ...none, reportedAt: h(1) }, NOW)).toBe(false);
  });
});

describe('compliance', () => {
  /**
   * ★ 아직 한도 안에서 기다리는 건은 모수에서 뺀다.
   *   실패로 세면 새 민원을 담을 때마다 준수율이 떨어지고, 성공으로 세면 늘 100% 가 된다.
   */
  it('대기 중인 건은 모수에 넣지 않는다', () => {
    const fresh: SlaInput = { ...none, reportedAt: h(2) };
    const good = { reportedAt: h(50), assignedAt: h(45), visitedAt: null, resolvedAt: null };
    const c = compliance([fresh, good], 'assign', NOW);
    expect(c).toEqual({ ok: 1, total: 1, pct: 100 });
  });

  it('넘긴 건이 섞이면 비율이 내려간다', () => {
    const r1 = h(60);
    const r2 = h(60);
    const good: SlaInput = { reportedAt: r1, assignedAt: at(r1, 5), visitedAt: null, resolvedAt: null };
    const bad: SlaInput = { reportedAt: r2, assignedAt: at(r2, 30), visitedAt: null, resolvedAt: null };
    expect(compliance([good, bad], 'assign', NOW)).toEqual({ ok: 1, total: 2, pct: 50 });
  });

  it('모수가 0이면 0%다 — 나눗셈이 터지지 않는다', () => {
    expect(compliance([], 'reply', NOW)).toEqual({ ok: 0, total: 0, pct: 0 });
    expect(compliance([{ ...none, reportedAt: h(1) }], 'reply', NOW)).toEqual({ ok: 0, total: 0, pct: 0 });
  });

  it('접수일이 없는 건은 어느 쪽으로도 세지 않는다', () => {
    expect(compliance([none], 'assign', NOW)).toEqual({ ok: 0, total: 0, pct: 0 });
  });
});

describe('slaView', () => {
  /**
   * 단계 정의는 `STAGES` 하나뿐이다. 여기서 배열을 그대로 확인해 두면 단계를 고칠 때
   * 화면만 고치고 집계를 빠뜨리는 일을 막는다.
   */
  it('STAGES 를 정의된 차례 그대로 낸다', () => {
    const v = slaView({ ...none, reportedAt: h(1) }, NOW);
    expect(v.map((s) => s.step)).toEqual(STAGES.map((s) => s.step));
    expect(v.map((s) => s.key)).toEqual(['assign', 'visit', 'reply']);
    expect(v.map((s) => s.limitHours)).toEqual(STAGES.map((s) => s.limitHours));
  });
});
