import type { ReactNode } from 'react';

/**
 * 빈 상태. **다음에 할 일을 반드시 준다** — 비어 있다는 사실만 적으면 사람이 막힌다
 * (`~/.claude/rules/design.md` 8절).
 */
export default function Empty({
  icon,
  title,
  desc,
  action,
}: {
  icon?: ReactNode;
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="ei">{icon}</div>}
      <div className="et">{title}</div>
      {desc && <div className="ed">{desc}</div>}
      {action}
    </div>
  );
}

/** 목록이 뜨기 전 자리를 잡아두는 스켈레톤. 스피너를 쓰지 않는 이유는 레이아웃 시프트 때문이다 */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="sk" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}
