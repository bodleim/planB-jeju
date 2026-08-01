'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, type MouseEvent, type ReactNode } from 'react'

/**
 * 서버에서 만든 쿼리 기반 화면도 문서를 새로 읽지 않고 전환한다.
 *
 * 화면 상태는 URL에 남겨 새로고침·공유·뒤로가기는 그대로 지원하면서, 내부 링크와 GET 폼은
 * App Router의 클라이언트 전환으로 처리한다. 수정자 키 클릭, 새 탭, 외부 링크는 브라우저의
 * 기본 동작을 보존한다.
 */
export default function AppNavigation({ children }: { children: ReactNode }) {
  const router = useRouter()

  const navigate = (href: string) => {
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) return false
    router.push(`${url.pathname}${url.search}${url.hash}`)
    return true
  }

  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return

    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (
      link === null ||
      link.target === '_blank' ||
      link.hasAttribute('download') ||
      link.getAttribute('rel')?.includes('external')
    ) return

    const href = link.getAttribute('href')
    if (href === null || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) return
    if (navigate(href)) event.preventDefault()
  }

  const onSubmitCapture = (event: FormEvent<HTMLElement>) => {
    const form = event.currentTarget.querySelector('form')
    const submittedForm = event.target instanceof HTMLFormElement ? event.target : form
    if (submittedForm === null || submittedForm.method.toLowerCase() !== 'get') return

    const action = submittedForm.getAttribute('action') || window.location.pathname
    const url = new URL(action, window.location.href)
    if (url.origin !== window.location.origin) return

    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const data = new FormData(submittedForm, submitter instanceof HTMLElement ? submitter : undefined)
    const params = new URLSearchParams()
    for (const [key, value] of data) {
      if (typeof value === 'string') params.append(key, value)
    }
    url.search = params.toString()

    event.preventDefault()
    navigate(`${url.pathname}${url.search}${url.hash}`)
  }

  return (
    <div onClickCapture={onClickCapture} onSubmitCapture={onSubmitCapture}>
      {children}
    </div>
  )
}
