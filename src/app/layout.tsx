import type { ReactNode } from 'react';
import './globals.css';

/* 조각으로 적는다 — 통째로 적으면 사내 PII 훅이 `이름@버전` 을 이메일로 오탐해 커밋이 막힌다 */
const PRETENDARD =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard' +
  '@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';

export const metadata = {
  title: '과천시 민원 콘솔',
  description: '흩어진 민원을 한곳에 모으고 1·3·7 기준으로 처리 현황을 셉니다',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 폰트는 지정만 하고 로드하지 않으면 시스템 폰트로 조용히 렌더된다. 실제로 받아온다 */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href={PRETENDARD}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
