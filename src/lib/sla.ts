/**
 * 1·3·7 기준 — 접수부터 답변까지 걸린 시간을 단계별로 잰다.
 *
 * 이름의 1·3·7 은 날짜가 아니라 **부르는 이름**이고, 실제 한도는 시간이다.
 * (1일 배정 = 12시간, 3일 출동 = 36시간, 7일 답변 = 72시간)
 *
 * ★ 기록이 없는 단계를 무조건 `wait` 로 두지 않는다.
 *   한도가 이미 지났는데 기록이 비어 있으면 그것은 "기다리는 중" 이 아니라 **늦은 것**이다.
 *   전자로만 표시하면 열흘 전 민원이 영원히 `배정 대기` 로 남아 준수율에서 빠진다 —
 *   이 프로젝트가 제일 경계하는 조용한 통과가 바로 그 모양이다.
 *
 * ★ 순수 함수만 둔다. DB·React 를 import 하지 않는다 — 서버 집계와 화면이 같은 판정을
 *   쓰려면 양쪽에서 부를 수 있어야 한다 (`complaint-view.ts` 와 같은 이유).
 */

export type StageKey = 'assign' | 'visit' | 'reply';

export type Stage = {
  /** 화면에 크게 박히는 숫자. 1·3·7 */
  no: 1 | 3 | 7;
  key: StageKey;
  /** 짧은 이름 — 줄에 붙는다 */
  label: string;
  /** 긴 이름 — 기준 띠에 붙는다 */
  desc: string;
  /** 접수로부터 몇 시간 안에 */
  limitHours: number;
};

export const STAGES: Stage[] = [
  { no: 1, key: 'assign', label: '배정', desc: '담당 부서 배정', limitHours: 12 },
  { no: 3, key: 'visit', label: '출동', desc: '현장 확인', limitHours: 36 },
  { no: 7, key: 'reply', label: '답변', desc: '민원 답변', limitHours: 72 },
];

/** 아직 안 왔음 / 한도 안 / 한도 임박 / 한도 넘김 */
export type StageState = 'wait' | 'ok' | 'warn' | 'late';

export type SlaInput = {
  reportedAt: string | null;
  assignedAt: string | null;
  visitedAt: string | null;
  resolvedAt: string | null;
};

/** 두 시각 사이의 시간(정수). 어느 한쪽이라도 없거나 못 읽으면 null. */
export function hoursBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 3_600_000);
}

/** 단계별 실제 소요 시간. 기록이 없으면 그 칸이 null 이다. */
export function stageHours(c: SlaInput): Record<StageKey, number | null> {
  return {
    assign: hoursBetween(c.reportedAt, c.assignedAt),
    visit: hoursBetween(c.reportedAt, c.visitedAt),
    reply: hoursBetween(c.reportedAt, c.resolvedAt),
  };
}

/**
 * 한 단계의 판정.
 *
 * @param hours   실제 걸린 시간. 아직 기록이 없으면 null
 * @param limit   한도 시간
 * @param elapsed 접수로부터 **지금까지** 흐른 시간. 기록이 없을 때 늦었는지 가르는 값이다
 */
export function stageState(hours: number | null, limit: number, elapsed: number | null): StageState {
  if (hours == null) {
    // 기록이 없다. 한도가 이미 지났으면 기다리는 중이 아니라 늦은 것이다
    if (elapsed != null && elapsed > limit) return 'late';
    return 'wait';
  }
  if (hours > limit) return 'late';
  if (hours > limit * 0.8) return 'warn';
  return 'ok';
}

/** 접수로부터 지금까지 흐른 시간. 접수일이 없으면 잴 수 없다 — null. */
export function elapsedHours(c: SlaInput, now: number): number | null {
  if (!c.reportedAt) return null;
  const t = Date.parse(c.reportedAt);
  if (Number.isNaN(t)) return null;
  return Math.round((now - t) / 3_600_000);
}

export type StageView = Stage & { hours: number | null; state: StageState };

/** 한 민원의 세 단계를 화면이 그릴 수 있는 꼴로. */
export function slaView(c: SlaInput, now: number): StageView[] {
  const h = stageHours(c);
  const el = elapsedHours(c, now);
  return STAGES.map((s) => ({ ...s, hours: h[s.key], state: stageState(h[s.key], s.limitHours, el) }));
}

/** 한 단계라도 한도를 넘겼는가. 목록의 `넘긴 것만` 거르개가 이걸 쓴다. */
export function isLate(c: SlaInput, now: number): boolean {
  return slaView(c, now).some((s) => s.state === 'late');
}

export type Compliance = { ok: number; total: number; pct: number };

/**
 * 단계별 준수율.
 *
 * ★ 모수(`total`)를 반드시 함께 낸다. 80% 가 5건 중 4건인지 100건 중 80건인지 모르면
 *   그 숫자는 판단 근거가 못 된다 — 화면에서도 `4 / 5건` 을 같이 적는다.
 *
 * ★ 모수에 드는 것은 **판정이 난 건**뿐이다(`ok`·`warn`·`late`). 아직 한도 안에서
 *   기다리는 건(`wait`)은 성공도 실패도 아니라 세지 않는다. 그걸 실패로 세면
 *   민원을 새로 담을 때마다 준수율이 떨어지고, 성공으로 세면 늘 100% 가 된다.
 */
export function compliance(rows: SlaInput[], key: StageKey, now: number): Compliance {
  const stage = STAGES.find((s) => s.key === key);
  if (!stage) return { ok: 0, total: 0, pct: 0 };
  let ok = 0;
  let total = 0;
  for (const r of rows) {
    const h = stageHours(r)[key];
    const st = stageState(h, stage.limitHours, elapsedHours(r, now));
    if (st === 'wait') continue;
    total++;
    if (st !== 'late') ok++;
  }
  return { ok, total, pct: total === 0 ? 0 : Math.round((ok / total) * 100) };
}
