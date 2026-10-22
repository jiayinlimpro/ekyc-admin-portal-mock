// One field for a start and end date with a two-month calendar: the first click picks the start, the second the end,
// and the days between are highlighted (while choosing, up to the day under the pointer).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useNow } from '@/hooks/useNow'
import { addDays, addMonths, dayState, formatRange, monthBefore, monthGrid, monthOf, mytToday, pickDay, presets, sameMonth, type DateRange, type Month } from '@/lib/dateRange'
import { cn } from '@/lib/utils'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const longDate = (day: string) => `${Number(day.slice(8))} ${MONTH_NAMES[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`

/** The left month shown: the start's month, but never so late that the right month would be after today's. */
const firstMonth = (range: DateRange, today: string): Month => {
  const last = addMonths(monthOf(today), -1)
  const m = range.from ? monthOf(range.from) : last
  return monthBefore(m, last) ? m : last
}

export function DateRangeField({
  id,
  value,
  onChange,
  placeholder = 'Any date',
  title = 'Choose dates',
  invalid = false,
}: {
  id: string
  value: DateRange
  onChange: (range: DateRange) => void
  placeholder?: string
  /** Heading of the calendar, for screen readers too. */
  title?: string
  invalid?: boolean
}) {
  const today = mytToday(useNow(60_000))
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>(value)
  const [hover, setHover] = useState<string>()
  const [view, setView] = useState<Month>(() => firstMonth(value, today))
  const [focusDay, setFocusDay] = useState<string>()
  const grid = useRef<HTMLDivElement>(null)

  const openChange = (next: boolean) => {
    // Closing with only a start chosen keeps the previous dates.
    if (next) {
      setDraft(value)
      setView(firstMonth(value, today))
      setHover(undefined)
      setFocusDay(undefined)
    }
    setOpen(next)
  }
  const commit = (range: DateRange) => {
    setDraft(range)
    onChange(range)
    setOpen(false)
  }
  const pick = (day: string) => {
    const next = pickDay(draft, day)
    if (next.done) return commit({ from: next.from, to: next.to })
    setDraft({ from: next.from, to: next.to })
  }

  // Arrow keys move between days (and months); the focused day follows.
  useEffect(() => {
    if (focusDay) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus()
  }, [focusDay, view])
  const onKeyDown = (e: KeyboardEvent) => {
    const day = (e.target as HTMLElement).dataset.day
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!day || !step) return
    e.preventDefault()
    const target = addDays(day, step)
    if (target > today) return
    const m = monthOf(target)
    if (monthBefore(m, view)) setView(m)
    else if (monthBefore(addMonths(view, 1), m)) setView(addMonths(m, -1))
    setFocusDay(target)
    setHover(target)
  }

  const months = [view, addMonths(view, 1)]
  const canNext = (m: Month) => monthBefore(m, monthOf(today))
  // One day in the calendars takes Tab (roving focus): the focused day, else the start, else today, else the 1st.
  const visible = (day: string) => months.some((m) => sameMonth(m, monthOf(day)))
  const tabDay = [focusDay, draft.from, today].find((d): d is string => !!d && visible(d)) ?? `${view.year}-${String(view.month + 1).padStart(2, '0')}-01`
  const text = formatRange(value)

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger
        id={id}
        aria-invalid={invalid || undefined}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30',
          !text && 'text-muted-foreground',
        )}
      >
        <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{text || placeholder}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto">
        <PopoverTitle className="sr-only">{title}</PopoverTitle>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-wrap gap-1 sm:w-28 sm:flex-col sm:border-r sm:pr-3" role="group" aria-label="Quick ranges">
            {presets(today).map((p) => (
              <Button key={p.label} type="button" variant="ghost" size="sm" className="justify-start" onClick={() => commit(p.range)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
              {draft.from && !draft.to ? `From ${longDate(draft.from)}: now choose the end date.` : 'Choose the start date, then the end date.'}
            </p>
            <div ref={grid} className="flex gap-4" onKeyDown={onKeyDown} onMouseLeave={() => setHover(undefined)}>
              {months.map((m, i) => (
                // On a phone only the later month shows, with both arrows; on wider screens each month has one.
                <div key={`${m.year}-${m.month}`} className={cn(i === 0 && 'hidden sm:block')}>
                  <div className="mb-1 flex h-7 items-center justify-between">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous month" className={cn(i === 1 && 'sm:invisible')} onClick={() => setView(addMonths(view, -1))}>
                      <ChevronLeft aria-hidden />
                    </Button>
                    <span className="text-sm font-medium">
                      {MONTH_NAMES[m.month]} {m.year}
                    </span>
                    {i === 1 ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Next month" disabled={!canNext(m)} onClick={() => setView(addMonths(view, 1))}>
                        <ChevronRight aria-hidden />
                      </Button>
                    ) : (
                      <span className="size-7" />
                    )}
                  </div>
                  <table role="grid" aria-label={`${MONTH_NAMES[m.month]} ${m.year}`} className="border-collapse">
                    <thead>
                      <tr>
                        {WEEKDAYS.map((d) => (
                          <th key={d} scope="col" className="size-8 text-center text-xs font-normal text-muted-foreground">
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {monthGrid(m).map((week, w) => (
                        <tr key={w}>
                          {week.map((day, d) => {
                            if (!day) return <td key={d} className="size-8 p-0" />
                            const s = dayState(day, draft, hover)
                            const edge = s.start || s.end
                            const band = s.inside || (edge && !(s.start && s.end)) // a range of two days or more
                            const future = day > today
                            return (
                              <td
                                key={d}
                                className={cn(
                                  'size-8 p-0',
                                  band && (s.preview ? 'bg-primary/10' : 'bg-primary/15'),
                                  band && s.start && 'rounded-l-md',
                                  band && s.end && 'rounded-r-md',
                                )}
                              >
                                <button
                                  type="button"
                                  data-day={day}
                                  tabIndex={day === tabDay ? 0 : -1}
                                  disabled={future}
                                  aria-label={longDate(day)}
                                  aria-pressed={edge || s.inside}
                                  aria-current={day === today ? 'date' : undefined}
                                  onClick={() => pick(day)}
                                  onMouseEnter={() => setHover(day)}
                                  onFocus={() => setFocusDay(day)}
                                  className={cn(
                                    'size-8 rounded-md text-sm tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30',
                                    day === today && 'font-semibold underline underline-offset-4',
                                    edge && 'bg-primary text-primary-foreground hover:bg-primary/90',
                                  )}
                                >
                                  {Number(day.slice(8))}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground">{formatRange(draft) || 'No dates chosen'} · MYT</span>
              <Button type="button" variant="outline" size="sm" onClick={() => commit({ from: '', to: '' })}>
                Clear
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
