import { Construction } from 'lucide-react'
import type { NavItem } from '@/app/nav'

/** Stand-in for screens not built yet; lists the rules the real screen must follow. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex items-center gap-3">
        <Icon className="size-6 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-semibold">{item.label}</h1>
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{item.priority}</span>
      </header>
      <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 p-4 text-sm">
        <Construction className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        <div className="space-y-2">
          <p className="font-medium">Not built yet.</p>
          {item.notes.length > 0 && (
            <>
              <p className="text-muted-foreground">When built, this screen must follow:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {item.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
