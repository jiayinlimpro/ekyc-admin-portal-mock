import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Label, control, then a hint or the field's error (announced). Pass the same `id` to the control. */
export function FormField({ id, label, hint, error, children, className }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className={cn('mt-1 text-xs text-muted-foreground')}>{hint}</p>
      )}
    </div>
  )
}
