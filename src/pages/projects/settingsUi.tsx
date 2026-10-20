import type { ReactNode } from 'react'

/** A titled settings card. */
export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}
