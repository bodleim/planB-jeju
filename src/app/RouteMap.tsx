'use client'

/**
 * 카카오맵 동선 지도.
 *
 * **없어도 화면은 동작한다** — 키가 없거나 SDK 로드가 실패하면 이 div 는 투명한 채로 남고,
 * 뒤에 서버가 그린 SVG 개략도가 그대로 보인다. 무대에서 네트워크가 끊겨도 지도 때문에
 * 화면이 죽지 않는다 (기상 폴백과 같은 원칙).
 */
import { useEffect, useRef, useState } from 'react'

type Stop = { name: string; lat: number; lng: number }

// 카카오맵 SDK 는 전역으로만 온다. 타입 패키지를 들이지 않고 쓰는 만큼만 선언한다.
type KakaoLatLng = { __brand?: 'LatLng' }
type KakaoBounds = { extend(p: KakaoLatLng): void }
type KakaoMaps = {
  load(cb: () => void): void
  LatLng: new (lat: number, lng: number) => KakaoLatLng
  LatLngBounds: new () => KakaoBounds
  Map: new (
    el: HTMLElement,
    opts: { center: KakaoLatLng; level: number },
  ) => { setBounds(b: KakaoBounds, ...paddingPx: number[]): void }
  Polyline: new (opts: {
    map: unknown
    path: KakaoLatLng[]
    strokeWeight: number
    strokeColor: string
    strokeOpacity: number
    strokeStyle: string
  }) => unknown
  CustomOverlay: new (opts: {
    map: unknown
    position: KakaoLatLng
    content: string
    yAnchor?: number
  }) => unknown
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps }
  }
}

let sdkPromise: Promise<{ maps: KakaoMaps }> | null = null

function loadSdk(appKey: string): Promise<{ maps: KakaoMaps }> {
  if (sdkPromise === null) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`
      script.async = true
      script.onload = () => window.kakao!.maps.load(() => resolve(window.kakao!))
      script.onerror = () => {
        sdkPromise = null // 다음 시도에서 다시 로드할 수 있게
        reject(new Error('kakao maps sdk load failed'))
      }
      document.head.appendChild(script)
    })
  }
  return sdkPromise
}

export default function RouteMap({
  appKey,
  origin,
  stops,
}: {
  appKey: string
  origin: { lat: number; lng: number }
  stops: Stop[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  // 계획이 바뀌면(스와이프·새로 짜기) 좌표도 바뀐다 — 값 기준으로 지도를 다시 그린다.
  const signature = JSON.stringify([origin, stops])

  useEffect(() => {
    let cancelled = false
    loadSdk(appKey)
      .then((kakao) => {
        const el = ref.current
        if (cancelled || el === null) return
        el.innerHTML = '' // 재렌더 시 이전 지도 인스턴스 제거
        const toLatLng = (p: { lat: number; lng: number }) => new kakao.maps.LatLng(p.lat, p.lng)
        const map = new kakao.maps.Map(el, { center: toLatLng(origin), level: 7 })
        const path = [origin, ...stops].map(toLatLng)

        new kakao.maps.Polyline({
          map,
          path,
          strokeWeight: 3,
          strokeColor: '#3e8c8c',
          strokeOpacity: 0.85,
          strokeStyle: 'shortdash',
        })
        new kakao.maps.CustomOverlay({
          map,
          position: path[0],
          content: '<div class="map-origin" title="출발"></div>',
        })
        stops.forEach((s, i) => {
          new kakao.maps.CustomOverlay({
            map,
            position: toLatLng(s),
            yAnchor: 1.2,
            content: `<div class="map-pin" title="${s.name.replaceAll('"', '')}">${i + 1}</div>`,
          })
        })

        const bounds = new kakao.maps.LatLngBounds()
        path.forEach((p) => bounds.extend(p))
        map.setBounds(bounds, 32, 32, 32, 32)
        setReady(true)
      })
      .catch(() => {
        // 폴백 — 아무것도 하지 않는다. 뒤의 SVG 개략도가 그대로 보인다.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- origin/stops 는 signature 로 값 비교
  }, [appKey, signature])

  return (
    <div
      ref={ref}
      aria-hidden={!ready}
      className="absolute inset-0 z-[5] transition-opacity duration-300"
      style={{ opacity: ready ? 1 : 0 }}
    />
  )
}
