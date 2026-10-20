import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { decisionOverlayState, validateDecision, type OverlayState } from '@/domain/claimRules'
import { REASON_CODES } from '@/domain/openQuestions'
import type { Actor, Decision, VerificationDetail } from '@/domain/types'
import { cn } from '@/lib/utils'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'

type Outcome = Decision['outcome']

const OUTCOMES: { value: Outcome; label: string; result: string; icon: typeof CheckCircle2 }[] = [
  { value: 'APPROVE', label: 'Confirm Manual Pass', result: 'Approved', icon: CheckCircle2 },
  { value: 'REJECT', label: 'Maintain Automated Rejection', result: 'Rejected', icon: XCircle },
]

const COMMENT_MAX = 500

/** With dev "Skip UI claim checks" on, the form opens whenever the record is reviewable, so the save hits the service check. */
function overlayState(v: VerificationDetail, actor: Actor, now: Date, uiClaimChecks: boolean, mayDecide: boolean): OverlayState & { devBypass?: boolean } {
  const s = decisionOverlayState(v, actor, now, mayDecide)
  if (uiClaimChecks || s.enabled || v.status !== 'PENDING_REVIEW' || !mayDecide) return s
  return { enabled: true, devBypass: true, showClaim: s.showClaim }
}

// REQ: DEC-30 / DEC-31 / DEC-32 — only the active claim owner on PENDING_REVIEW; reason + comment required; final.
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
  const [reasonCode, setReasonCode] = useState('')
  const [comment, setComment] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [touched, setTouched] = useState(false)

  const decision: Decision | undefined = outcome ? { outcome, reasonCode, comment } : undefined
  const invalid = !decision || !validateDecision(decision).ok
  const chosen = OUTCOMES.find((o) => o.value === outcome)

  const pickOutcome = (o: Outcome) => {
    setOutcome(o)
    if (!REASON_CODES[o].some((r) => r.code === reasonCode)) setReasonCode('')
  }

  const confirm = async () => {
    if (!decision) return
    const ok = await onSave(decision)
    setConfirming(false)
    if (ok) {
      setOutcome(undefined)
      setReasonCode('')
      setComment('')
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
                  <input type="radio" name="outcome" value={o.value} checked={on} onChange={() => pickOutcome(o.value)} className="sr-only" />
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
          <div>
            <label htmlFor="d-reason" className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
              Reason Code <OpenQuestionTag id="OQ-10" />
            </label>
            <NativeSelect id="d-reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-invalid={touched && !reasonCode} disabled={!outcome}>
              <option value="">{outcome ? 'Select a reason…' : 'Choose an outcome first'}</option>
              {outcome &&
                REASON_CODES[outcome].map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
            </NativeSelect>
            {touched && outcome && !reasonCode && <p className="mt-1 text-xs text-destructive">Reason Code is required.</p>}
          </div>
          <div>
            <label htmlFor="d-comment" className="mb-1 block text-xs font-medium text-muted-foreground">
              Audit Comment
            </label>
            <Textarea
              id="d-comment"
              value={comment}
              maxLength={COMMENT_MAX}
              rows={4}
              onChange={(e) => setComment(e.target.value)}
              aria-invalid={touched && !comment.trim()}
              aria-describedby="d-comment-hint"
              placeholder="What did you check, and why this outcome?"
            />
            <p id="d-comment-hint" className={cn('mt-1 text-xs', touched && !comment.trim() ? 'text-destructive' : 'text-muted-foreground')}>
              {touched && !comment.trim() ? 'Audit Comment is required.' : `Saved to the audit log. ${comment.length}/${COMMENT_MAX}`}
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
