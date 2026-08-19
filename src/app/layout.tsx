import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'gccity',
  description: '카카오톡 오픈채팅방 수집 대시보드',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
