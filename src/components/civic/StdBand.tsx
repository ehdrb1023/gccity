'use client';

import { STAGES, compliance, isLate, slaView, type SlaInput } from '@/lib/sla';
import type { Complaint, Flow } from '@/components/types';

/**
 * 처리 기준 준수 띠 + 그 아래 숫자 넷.
 *
 * ★ 모수를 반드시 함께 적는다. `80%` 가 5건 중 4건인지 100건 중 80건인지 모르면 그 숫자는
 *   판단 근거가 못 된다. 그래서 비율 옆에 언제나 `4 / 5건` 이 붙는다.
 *
 * ★ 세는 대상은 **민원(report)** 뿐이다. 처리 글·공지는 접수부터 답변까지라는 개념이 없다.
 */
export default function StdBand({
  rows,
  flow,
  now,
}: {
  rows: Complaint[];
  flow: Flow | null;
  now: number;
}) {
  const reports = rows.filter((c) => c.kind === 'report');
  const sla: SlaInput[] = reports.map((c) => ({
    reportedAt: c.reportedAt,
    assignedAt: c.assignedAt,
    visitedAt: c.visitedAt,
    resolvedAt: c.resolvedAt,
  }));

  const lateCount = sla.filter((c) => isLate(c, now)).length;
  const replied = sla
    .map((c) => (c.reportedAt && c.resolvedAt ? Math.round((Date.parse(c.resolvedAt) - Date.parse(c.reportedAt)) / 3_600_000) : null))
    .filter((v): v is number => v != null);
  const avg = replied.length ? Math.round(replied.reduce((a, b) => a + b, 0) / replied.length) : null;

  return (
    <>
      <div className="std">
        <div className="std-h">
          <h2>처리 기준 준수</h2>
          <span>민원 {reports.length}건 기준 · 아직 한도 안에서 기다리는 건은 세지 않습니다</span>
        </div>
        <div className="std-g">
          {STAGES.map((s) => {
            const c = compliance(sla, s.key, now);
            return (
              <div className="std-c" key={s.key}>
                <div className="no">
                  <b>{s.step}</b>
                  <i>{s.desc}</i>
                </div>
                <div className="lim">{s.limitHours}시간 안에</div>
                <div className="rate">
                  <b>{c.total === 0 ? '—' : `${c.pct}%`}</b>
                  <span>
                    {c.ok} / {c.total}건
                  </span>
                </div>
                <div className={`meter${c.total > 0 && c.pct < 70 ? ' warn' : ''}`}>
                  <i style={{ width: `${c.total === 0 ? 0 : c.pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="l">확정 민원</div>
          <div className="v">
            {rows.length}
            <small>건</small>
          </div>
        </div>
        <div className="stat">
          <div className="l">기준 넘긴 건</div>
          <div className={`v${lateCount > 0 ? ' alert' : ''}`}>
            {lateCount}
            <small>건</small>
          </div>
        </div>
        <div className="stat">
          <div className="l">평균 답변 소요</div>
          <div className="v">
            {avg == null ? '—' : avg}
            <small>{avg == null ? ` (${replied.length}건 기준)` : `시간 (${replied.length}건)`}</small>
          </div>
        </div>
        <div className="stat">
          <div className="l">미분류</div>
          <div className={`v${(flow?.unknown ?? 0) > 0 ? ' alert' : ''}`}>
            {flow?.unknown ?? 0}
            <small>건</small>
          </div>
        </div>
      </div>
    </>
  );
}

/** 줄에 붙는 단계 칩. `STAGES` 개수만큼 나오고, 상태에 따라 색이 갈린다 */
export function SlaChips({ c, now }: { c: Complaint; now: number }) {
  const input: SlaInput = {
    reportedAt: c.reportedAt,
    assignedAt: c.assignedAt,
    visitedAt: c.visitedAt,
    resolvedAt: c.resolvedAt,
  };
  return (
    <span className="sla">
      {slaView(input, now).map((v) => (
        <span key={v.key} className={`sl ${v.state === 'wait' ? '' : v.state}`}>
          <u>{v.step}</u>
          {v.hours == null ? (
            /* 기록이 비었는데 한도가 지났으면 `대기` 가 아니라 `기록 없음` 이다 — 늦은 것을 숨기지 않는다 */
            `${v.label} ${v.state === 'late' ? '기록 없음' : '대기'}`
          ) : (
            <>
              {v.label} <b>{v.hours}시간</b>
            </>
          )}
        </span>
      ))}
    </span>
  );
}
