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
export default function UseMyLocation({ base }: { base: string }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'asking' | string>('idle')

  return (
    <div>
      <button
        type="button"
        disabled={state === 'asking'}
        onClick={() => {
          if (!navigator.geolocation) {
            setState('이 브라우저는 위치 기능을 지원하지 않습니다. 아래에서 장소를 검색하세요.')
            return
          }
          setState('asking')
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              router.push(`${base}&lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`),
            (err) =>
              setState(
                err.code === err.PERMISSION_DENIED
                  ? '위치 권한이 거부됐습니다. 아래에서 장소를 검색하세요.'
                  : '위치를 가져오지 못했습니다. 아래에서 장소를 검색하세요.',
              ),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
          )
        }}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-60"
      >
        {state === 'asking' ? '위치 확인 중…' : '현재 위치 사용'}
      </button>
      {state !== 'idle' && state !== 'asking' && (
        <p className="mt-1 text-xs text-amber-800">{state}</p>
      )}
    </div>
  )
}
