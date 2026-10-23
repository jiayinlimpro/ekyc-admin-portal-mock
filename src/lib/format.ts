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

/** MYT calendar date "yyyy-MM-dd" → ISO UTC at the start (or end) of that MYT day. */
export function mytDateToUtcIso(date: string, endOfDay = false): string {
  const start = Date.parse(`${date}T00:00:00.000Z`) - MYT_OFFSET_MS
  return new Date(endOfDay ? start + 86_400_000 - 1 : start).toISOString()
}

/** Claim countdown: "12 min left", "45 s left". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired'
  if (ms < 60_000) return `${Math.ceil(ms / 1000)} s left`
  return `${Math.floor(ms / 60_000)} min left`
}

/** "12:05" (mm:ss) for a live countdown. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** MyKad-style date: "1990-04-15" → "15 Apr 1990". */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
}

/** A duration stored in seconds, as people read it: "30 min", "2 min 30 s", "45 s" (DEC-53). */
export function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return [m ? `${m} min` : '', s || !m ? `${s} s` : ''].filter(Boolean).join(' ')
}
