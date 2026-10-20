import { useCallback, useEffect, useState } from 'react'
import { isServiceError } from '@/services/errors'

export const errorMessage = (e: unknown) => (isServiceError(e) ? e.message : e instanceof Error ? e.message : 'Unexpected error.')

/** Field errors from a VALIDATION error, or the message under `form`. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (isServiceError(e) && Array.isArray(e.details)) return Object.fromEntries((e.details as { field: string; message: string }[]).map((x) => [x.field, x.message]))
  return { form: errorMessage(e) }
}

/**
 * Loads data through a service call. Re-runs when `key` changes (include the actor so switching user refetches) or on
 * `reload()`. While reloading, the previous data stays visible (`loading` is true).
 */
export function useLoad<T>(load: () => Promise<T>, key: unknown[]): { data?: T; error?: string; loading: boolean; reload: () => void } {
  const [n, setN] = useState(0)
  const request = JSON.stringify([...key, n])
  const [state, setState] = useState<{ request: string; data?: T; error?: string }>({ request: '' })
  const [last, setLast] = useState<T>()

  useEffect(() => {
    let live = true
    load().then(
      (data) => {
        if (!live) return
        setState({ request, data })
        setLast(data)
      },
      (e: unknown) => live && setState({ request, error: errorMessage(e) }),
    )
    return () => {
      live = false
    }
    // `load` is recreated every render; `request` captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  const reload = useCallback(() => setN((x) => x + 1), [])
  const loading = state.request !== request
  return { data: loading ? last : (state.data ?? last), error: loading ? undefined : state.error, loading, reload }
}
