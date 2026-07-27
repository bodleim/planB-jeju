'use client'

import { useRouter } from 'next/navigation'
import { useRef, type ReactNode } from 'react'

/**
 * 좌우 스와이프로 그 시간대만 대안으로 넘긴다.
 *
 * **화면은 이 컴포넌트 없이도 동작한다.** 서버가 이미 이전·다음 링크를 뿌려 놓았고,
 * 여기서 하는 일은 그 링크로 이동하는 것뿐이다 — 스와이프는 링크의 편의 장치다.
 * 무대에서 JS 가 죽어도 사용자는 링크를 눌러 대안을 넘길 수 있다 (CLAUDE.md F2 항목).
 */
export default function SwipeSlot({
  prevHref,
  nextHref,
  children,
}: {
  prevHref: string | null
  nextHref: string | null
  children: ReactNode
}) {
  const router = useRouter()
  const start = useRef<{ x: number; y: number } | null>(null)

  // 세로 스크롤을 스와이프로 오해하지 않도록 가로 이동이 세로보다 확실히 커야 한다.
  const THRESHOLD_PX = 56

  return (
    <div
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerUp={(e) => {
        const from = start.current
        start.current = null
        if (!from) return
        const dx = e.clientX - from.x
        const dy = e.clientY - from.y
        if (Math.abs(dx) < THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return
        const href = dx < 0 ? nextHref : prevHref
        if (href) router.push(href, { scroll: false })
      }}
      className="touch-pan-y select-none"
    >
      {children}
    </div>
  )
}
