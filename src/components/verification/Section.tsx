import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Card with a heading, used for every block on the detail page. */
export function Section({ title, aside, children, className, id }: { title: string; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const headingId = id ?? `sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={headingId} className={cn('rounded-lg border bg-card', className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id={headingId} className="text-sm font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Fields({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}
