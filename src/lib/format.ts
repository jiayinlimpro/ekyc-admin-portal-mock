// Display formatting. Stored times are ISO UTC; everything is displayed in MYT (UTC+8, no DST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MYT_OFFSET_MS = 8 * 3_600_000

/** "25 Sep 2026, 14:03" in MYT. */
export function formatMyt(value: string | Date): string {
  const d = new Date(new Date(value).getTime() + MYT_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Time-warp offset as "+1 h 5 min"; "real time" when 0. */
export function formatOffset(ms: number): string {
  if (ms === 0) return 'real time'
  const sign = ms < 0 ? '−' : '+'
  const totalMin = Math.round(Math.abs(ms) / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${sign}${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m || !h ? `${m} min` : ''}`
}
