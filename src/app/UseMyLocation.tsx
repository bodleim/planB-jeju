'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * 브라우저 위치를 받아 쿼리의 lat/lng 로 넣는다.
 *
 * **이 컴포넌트가 없어도 화면은 동작한다** — 위치는 장소 검색(`from`)으로도 정할 수 있고,
 * 서버는 lat/lng 가 없으면 검색 결과를 쓴다. 권한을 거부당하는 게 정상 경로 중 하나라
 * 실패를 조용히 넘기지 않고 화면에 이유를 적는다 (앱이 위치를 대신 정하지 않는다).
 *
 * `auto` 면 첫 진입에서 버튼을 누르지 않아도 감지를 시도한다. `delayMs` 는 스플래시가
 * 재생 중일 때 기다리는 시간이다 — 감지 성공이 URL 을 바꾸면(쿼리 추가) 쿼리 없는 첫
 * 진입에만 뜨는 스플래시가 재생 중에 끊기기 때문에, 끝난 뒤에 이동한다.
 *
 * `base` 는 lat/lng 를 뺀 현재 쿼리다 — 서버가 만들어 넘긴다 (함수는 넘길 수 없다).
 */
export default function UseMyLocation({
  base,
  variant = 'button',
  label = '현재 위치 사용',
  auto = false,
  delayMs = 0,
}: {
  base: string
  variant?: 'button' | 'inline'
  label?: string
  auto?: boolean
  delayMs?: number
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'asking' | string>('idle')
  // 컴포넌트가 사라진 뒤(다른 화면으로 이동) 늦게 도착한 위치 콜백이 URL 을
  // 되돌리지 않게 하는 가드. 자동 감지에서 특히 중요하다.
  const cancelled = useRef(false)

  const locate = () => {
    if (!navigator.geolocation) {
      setState('이 브라우저는 위치 기능을 지원하지 않습니다. 아래에서 장소를 검색하세요.')
      return
    }
    // http 주소(localhost 제외)에서는 브라우저가 위치 API 를 차단하고 '권한 거부' 로
    // 보인다 — 설정으로 못 푸는 경우라 따로 안내한다. (폰에서 LAN IP 로 열면 이 경우)
    if (!window.isSecureContext) {
      setState('http 주소에서는 브라우저가 위치를 막습니다 (localhost 또는 https 만 가능). 아래에서 장소를 검색하세요.')
      return
    }
    setState('asking')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled.current) return
        router.push(`${base}&lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`)
      },
      (err) => {
        if (cancelled.current) return
        setState(
          err.code === err.PERMISSION_DENIED
            ? '위치 권한이 꺼져 있어요. 주소창의 자물쇠(사이트 설정) → 위치를 허용하거나, 아래에서 장소를 검색하세요.'
            : '위치를 가져오지 못했어요. 아래에서 장소를 검색하세요.',
        )
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  }

  useEffect(() => {
    cancelled.current = false
    if (!auto) return
    const timer = setTimeout(locate, delayMs)
    return () => {
      cancelled.current = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 첫 마운트에서 1회만 시도한다
  }, [auto])

  return (
    <div>
      <button
        type="button"
        disabled={state === 'asking'}
        onClick={locate}
        className={
          variant === 'inline'
            ? 'location-inline disabled:opacity-60'
            : 'h-[44px] w-full rounded-full bg-teal px-4 text-[14px] font-bold text-white disabled:opacity-60'
        }
      >
        {state === 'asking' ? '위치 확인 중…' : label}
      </button>
      {state !== 'idle' && state !== 'asking' && (
        <p className={variant === 'inline' ? 'location-error' : 'mt-1 text-xs text-orange'}>{state}</p>
      )}
    </div>
  )
}
