'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * 오른쪽에서 밀려 나오는 패널.
 *
 * ★ 예전에는 이 자리의 내용(붙여넣기·출처·작성자)이 목록 위에 인라인으로 펼쳐졌다.
 *   그러면 패널을 열 때마다 아래 목록이 통째로 밀려 읽던 자리를 잃는다.
 *
 * 접근성: ESC 로 닫히고, 뒤 배경을 누르면 닫힌다. 열려 있는 동안 뒤 화면은 스크롤되지 않는다.
 */
export default function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" data-on="true" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dh">
          <h2>{title}</h2>
          <div className="sp" />
          <button className="btn sm line" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="db">{children}</div>
        {footer && <div className="df">{footer}</div>}
      </aside>
    </>
  );
}
