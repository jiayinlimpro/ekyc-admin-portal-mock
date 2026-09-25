import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Multi-select as a row of toggle buttons (aria-pressed). Nothing selected = no filter. */
export function ToggleChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T[]
  onChange: (next: T[]) => void
}) {
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
              on ? 'border-foreground/30 bg-foreground text-background' : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {on && <Check className="size-3" aria-hidden />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
