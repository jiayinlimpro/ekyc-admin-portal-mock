// Calendar maths for the date-range field. Days are "yyyy-MM-dd" calendar dates (MYT for filters); pure, unit-tested.
import { formatDate } from './format'

const DAY_MS = 86_400_000
const MYT_OFFSET_MS = 8 * 3_600_000

export interface DateRange {
  from: string // '' = open
  to: string // '' = open
}

const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const msOf = (day: string) => Date.parse(`${day}T00:00:00.000Z`)

/** Today's date in Malaysia (UTC+8). */
export const mytToday = (now: Date) => toDay(now.getTime() + MYT_OFFSET_MS)

export const addDays = (day: string, n: number) => toDay(msOf(day) + n * DAY_MS)

/** A month as { year, month (0–11) }; `addMonths` keeps it valid across years. */
export interface Month {
  year: number
  month: number
}
export const monthOf = (day: string): Month => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1 })
export const addMonths = (m: Month, n: number): Month => {
  const i = m.year * 12 + m.month + n
  return { year: Math.floor(i / 12), month: ((i % 12) + 12) % 12 }
}
export const sameMonth = (a: Month, b: Month) => a.year === b.year && a.month === b.month
export const monthBefore = (a: Month, b: Month) => a.year * 12 + a.month < b.year * 12 + b.month

/** The month as weeks starting Monday; days of other months are `null`, so two months side by side don't repeat days. */
export function monthGrid({ year, month }: Month): (string | null)[][] {
  const first = Date.UTC(year, month, 1)
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const lead = (new Date(first).getUTCDay() + 6) % 7 // Monday = 0
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => toDay(first + i * DAY_MS))]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

/**
 * A click on a day. No start yet, or a full range already: the day starts a new range. Otherwise it ends the range;
 * a day before the start swaps them, so the range is always from ≤ to. `done` = both ends chosen.
 */
export function pickDay(range: DateRange, day: string): DateRange & { done: boolean } {
  if (!range.from || range.to) return { from: day, to: '', done: false }
  return day < range.from ? { from: day, to: range.from, done: true } : { from: range.from, to: day, done: true }
}

/** Where a day sits in the range (or in the preview while choosing the end, `hover`). */
export function dayState(day: string, range: DateRange, hover?: string): { start: boolean; end: boolean; inside: boolean; preview: boolean } {
  const choosing = !!range.from && !range.to && !!hover
  const [a, b] = choosing ? [hover! < range.from ? hover! : range.from, hover! < range.from ? range.from : hover!] : [range.from, range.to || range.from]
  if (!a) return { start: false, end: false, inside: false, preview: false }
  return { start: day === a, end: day === b, inside: day > a && day < b, preview: choosing && day >= a && day <= b }
}

/** Common ranges, ending today (MYT). */
export function presets(today: string): { label: string; range: DateRange }[] {
  return [
    { label: 'Today', range: { from: today, to: today } },
    { label: 'Last 7 days', range: { from: addDays(today, -6), to: today } },
    { label: 'Last 30 days', range: { from: addDays(today, -29), to: today } },
    { label: 'This month', range: { from: `${today.slice(0, 8)}01`, to: today } },
  ]
}

/** The field's text: "01 Oct 2026 – 15 Oct 2026", one day alone, or an open end. */
export function formatRange({ from, to }: DateRange): string {
  if (from && to) return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`
  if (from) return `From ${formatDate(from)}`
  if (to) return `Until ${formatDate(to)}`
  return ''
}
