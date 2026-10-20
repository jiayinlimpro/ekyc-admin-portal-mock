import { cn } from '@/lib/utils'

/** Controlled tab bar (role="tablist"); the caller renders the active panel with `tabPanelProps`. */
export function Tabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          id={`tab-${t.value}`}
          aria-selected={value === t.value}
          aria-controls={`panel-${t.value}`}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === t.value ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export const tabPanelProps = (value: string) => ({ role: 'tabpanel', id: `panel-${value}`, 'aria-labelledby': `tab-${value}` }) as const
