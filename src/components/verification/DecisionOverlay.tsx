import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { decisionOverlayState, NOTE_MAX, validateDecision, type OverlayState } from '@/domain/claimRules'
import { REJECT_REASONS } from '@/domain/conditions'
import type { Actor, Decision, VerificationDetail } from '@/domain/types'
import { cn } from '@/lib/utils'

type Outcome = Decision['outcome']

// REQ: DEC-30 — button names from the module spec.
const OUTCOMES: { value: Outcome; label: string; result: string; icon: typeof CheckCircle2 }[] = [
  { value: 'APPROVE', label: 'Confirm Manual Pass', result: 'Approved', icon: CheckCircle2 },
  { value: 'REJECT', label: 'Reject', result: 'Rejected', icon: XCircle },
]

/** Reject reasons grouped by stage, in catalogue order (DEC-35). */
const REASON_GROUPS = [...new Set(REJECT_REASONS.map((r) => r.stage))].map((stage) => ({ stage, reasons: REJECT_REASONS.filter((r) => r.stage === stage) }))

/** With dev "Skip UI claim checks" on, the form opens whenever the record is reviewable, so the save hits the service check. */
function overlayState(v: VerificationDetail, actor: Actor, now: Date, uiClaimChecks: boolean, mayDecide: boolean): OverlayState & { devBypass?: boolean } {
  const s = decisionOverlayState(v, actor, now, mayDecide)
  if (uiClaimChecks || s.enabled || v.status !== 'PENDING_REVIEW' || !mayDecide) return s
  return { enabled: true, devBypass: true, showClaim: s.showClaim }
}

// REQ: DEC-30 / DEC-31 / DEC-32 — only the active claim owner on PENDING_REVIEW; Reject needs a reason; note optional; final.
export function DecisionOverlay({
  v,
  actor,
  now,
  uiClaimChecks,
  mayDecide,
  busy,
  onSave,
}: {
  v: VerificationDetail
  actor: Actor
  now: Date
  uiClaimChecks: boolean
  /** The user's role in the case's project may decide (DEC-70); the claim decides the rest. */
  mayDecide: boolean
  busy: boolean
  onSave: (d: Decision) => Promise<boolean>
}) {
  const state = overlayState(v, actor, now, uiClaimChecks, mayDecide)
  // Kept when the overlay disables (e.g. claim expired mid-typing, OQ-13), so nothing typed is lost.
  const [outcome, setOutcome] = useState<Outcome>()
  const [reasonIds, setReasonIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [touched, setTouched] = useState(false)

  const trimmed = note.trim() || undefined
  const decision: Decision | undefined = outcome === 'APPROVE' ? { outcome, note: trimmed } : outcome === 'REJECT' ? { outcome, reasonIds, note: trimmed } : undefined
  const invalid = !decision || !validateDecision(decision).ok
  const chosen = OUTCOMES.find((o) => o.value === outcome)
  const toggleReason = (id: string) => setReasonIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const confirm = async () => {
    if (!decision) return
    const ok = await onSave(decision)
    setConfirming(false)
    if (ok) {
      setOutcome(undefined)
      setReasonIds([])
      setNote('')
      setTouched(false)
    }
  }

  return (
    <section aria-labelledby="decision-heading" className="rounded-lg border bg-card">
      <div className="border-b px-4 py-2.5">
        <h2 id="decision-heading" className="text-sm font-semibold">
          Decision
        </h2>
      </div>
      <form
        className="space-y-4 p-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (!invalid) setConfirming(true)
        }}
      >
        {!state.enabled && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm" role="status">
            {state.why}
          </p>
        )}
        {state.devBypass && (
          <p className="rounded-md border border-dashed border-amber-400 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Dev: UI claim checks are off. Saving goes straight to the service’s ownership check.
          </p>
        )}
        <fieldset disabled={!state.enabled || busy} className="space-y-4 disabled:opacity-60">
          <legend className="sr-only">Decision</legend>
          <div role="radiogroup" aria-label="Outcome" className="grid gap-2">
            {OUTCOMES.map((o) => {
              const Icon = o.icon
              const on = outcome === o.value
              return (
                <label
                  key={o.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                    on && (o.value === 'APPROVE' ? 'border-green-500 bg-green-50 dark:bg-green-500/10' : 'border-red-500 bg-red-50 dark:bg-red-500/10'),
                  )}
                >
                  <input type="radio" name="outcome" value={o.value} checked={on} onChange={() => setOutcome(o.value)} className="sr-only" />
                  <Icon className={cn('size-4', o.value === 'APPROVE' ? 'text-green-600' : 'text-red-600')} aria-hidden />
                  <span className="flex-1">
                    <span className="block font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">Status becomes {o.result}</span>
                  </span>
                </label>
              )
            })}
            {touched && !outcome && <p className="text-xs text-destructive">Choose an outcome.</p>}
          </div>
          {outcome === 'REJECT' && (
            <fieldset aria-describedby="d-reasons-hint">
              <legend className="mb-1 text-xs font-medium text-muted-foreground">Reasons for rejection</legend>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
                {REASON_GROUPS.map((g) => (
                  <div key={g.stage} role="group" aria-label={g.stage}>
                    <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.stage}</div>
                    {g.reasons.map((r) => (
                      <label key={r.id} className="flex items-start gap-2 py-0.5 text-sm">
                        <input type="checkbox" className="mt-1" checked={reasonIds.includes(r.id)} onChange={() => toggleReason(r.id)} />
                        <span>{r.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <p id="d-reasons-hint" className={cn('mt-1 text-xs', touched && !reasonIds.length ? 'text-destructive' : 'text-muted-foreground')}>
                {touched && !reasonIds.length ? 'Choose at least one reason.' : `${reasonIds.length} selected · from the condition catalogue (DEC-35)`}
              </p>
            </fieldset>
          )}
          <div>
            <label htmlFor="d-note" className="mb-1 block text-xs font-medium text-muted-foreground">
              Note <span className="font-normal">(optional)</span>
            </label>
            <Textarea
              id="d-note"
              value={note}
              maxLength={NOTE_MAX}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby="d-note-hint"
              placeholder="What did you check?"
            />
            <p id="d-note-hint" className="mt-1 text-xs text-muted-foreground">
              Saved to the audit log. {note.length}/{NOTE_MAX}
            </p>
          </div>
          <Button type="submit" className="w-full">
            Save decision
          </Button>
        </fieldset>
      </form>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {chosen?.label} → {chosen?.result}?
            </DialogTitle>
            <DialogDescription>
              {v.referenceNo} will be set to <strong>{chosen?.result}</strong> with you as Last Updated By. Decisions are final and cannot be reopened.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button variant={outcome === 'REJECT' ? 'destructive' : 'default'} disabled={busy} onClick={confirm}>
              {busy ? 'Saving…' : `Confirm ${chosen?.result}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
