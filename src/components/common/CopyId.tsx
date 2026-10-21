// REQ: DEC-97 — an ID people copy or quote (flow ID, case ID): shown in full, with a copy button.
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function CopyId({ label, value, className }: { label: string; value: string; className?: string }) {
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Couldn’t copy. Select the ${label.toLowerCase()} and copy it instead.`),
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      {label}
      <code className="rounded bg-muted px-1 font-mono text-foreground select-all">{value}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="rounded p-0.5 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <Copy className="size-3.5" aria-hidden />
      </button>
    </span>
  )
}
