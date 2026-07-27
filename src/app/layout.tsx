import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '플랜B 제주 — 끊긴 일정 다시 짜기',
  description:
    '기상악화·결항·휴무로 제주 여행 일정이 중단됐을 때, 지금 위치와 남은 시간에 맞는 대체 일정을 만들어 줍니다.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  )
}
