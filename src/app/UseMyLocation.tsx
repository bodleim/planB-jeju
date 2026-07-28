'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * 브라우저 위치를 받아 쿼리의 lat/lng 로 넣는다.
 *
 * **이 버튼이 없어도 화면은 동작한다** — 위치는 장소 검색(`from`)으로도 정할 수 있고,
 * 서버는 lat/lng 가 없으면 검색 결과를 쓴다. 권한을 거부당하는 게 정상 경로 중 하나라
 * 실패를 조용히 넘기지 않고 화면에 이유를 적는다 (앱이 위치를 대신 정하지 않는다).
 *
 * `base` 는 lat/lng 를 뺀 현재 쿼리다 — 서버가 만들어 넘긴다 (함수는 넘길 수 없다).
 */
export default function UseMyLocation({
  base,
  variant = 'button',
  label = '현재 위치 사용',
}: {
  base: string
  variant?: 'button' | 'inline'
  label?: string
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'asking' | string>('idle')

  return (
    <div>
      <button
        type="button"
        disabled={state === 'asking'}
        onClick={() => {
          if (!navigator.geolocation) {
            setState('이 브라우저는 위치 기능을 지원하지 않습니다. 위에서 장소를 검색하세요.')
            return
          }
          // http 주소(localhost 제외)에서는 브라우저가 위치 API 를 차단하고 '권한 거부' 로
          // 보인다 — 설정으로 못 푸는 경우라 따로 안내한다. (폰에서 LAN IP 로 열면 이 경우)
          if (!window.isSecureContext) {
            setState(
              'http 주소에서는 브라우저가 위치를 막습니다 (localhost 또는 https 만 가능). 위에서 장소를 검색하세요.',
            )
            return
          }
          setState('asking')
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              router.push(`${base}&lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`),
            (err) =>
              setState(
                err.code === err.PERMISSION_DENIED
                  ? '위치 권한이 거부돼 있습니다. 주소창의 자물쇠(사이트 설정) → 위치를 허용으로 바꾸고 새로고침한 뒤 다시 누르세요. 급하면 위의 장소 검색으로도 됩니다.'
                  : '위치를 가져오지 못했습니다 (macOS 라면 시스템 설정 → 위치 서비스에서 브라우저 허용을 확인). 위에서 장소를 검색하세요.',
              ),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
          )
        }}
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
