import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '플랜B 제주',
  description:
    '기상악화·결항·휴무·정체로 제주 여행 일정이 끊겼을 때, 지금 있는 곳 주변에서 남은 시간에 맞는 일정을 다시 짜주는 서비스',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
