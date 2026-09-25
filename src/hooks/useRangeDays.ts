import { useSearchParams } from 'react-router'

export const RANGE_PRESETS = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const
const DEFAULT_DAYS = 30

/** Date range lives in the URL (?days=7) so a dashboard view can be shared. */
export function useRangeDays(): [number, (d: number) => void] {
  const [sp, setSp] = useSearchParams()
  const n = Number(sp.get('days'))
  const days = RANGE_PRESETS.some((p) => p.days === n) ? n : DEFAULT_DAYS
  return [
    days,
    (d) =>
      setSp((p) => {
        if (d === DEFAULT_DAYS) p.delete('days')
        else p.set('days', String(d))
        return p
      }),
  ]
}
