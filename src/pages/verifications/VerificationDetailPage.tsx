import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AlertTriangle, ArrowLeft, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/common/NativeSelect'
import { StatusBadge } from '@/components/common/StatusBadge'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { ActivitySection, CheckSection, IdCaptureSection, RiskSection, RulesAppliedSection, SelfieSection } from '@/components/verification/CaseSections'
import { ClaimBar } from '@/components/verification/ClaimBar'
import { DecisionOverlay } from '@/components/verification/DecisionOverlay'
import { ClientMetadataCard, PiiSection } from '@/components/verification/PiiSection'
import { formatUpdatedBy } from '@/domain/audit'
import { isClaimActive } from '@/domain/claimRules'
import { canInProject, type ProjectAction } from '@/domain/access'
import { DEFAULT_CLAIM_WARNING_MIN } from '@/domain/openQuestions'
import type { Actor, Decision, VerificationDetail } from '@/domain/types'
import { useMyAccount } from '@/hooks/useMyAccount'
import { useNow } from '@/hooks/useNow'
import { formatMyt } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { isServiceError } from '@/services/errors'
import { onVerificationsChanged } from '@/services/liveUpdates'
import { userService, type UserSummary } from '@/services/userService'
import { verificationService } from '@/services/verificationService'
import { useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'

type Loaded = { key: string; detail?: VerificationDetail; error?: { message: string; notFound: boolean } }

const message = (e: unknown) => (isServiceError(e) ? e.message : 'Unexpected error.')

function ReasonBanner({ v }: { v: VerificationDetail }) {
  if (!v.statusReason || (v.status !== 'PENDING_REVIEW' && v.status !== 'REJECTED')) return null
  const rejected = v.status === 'REJECTED'
  return (
    <div
      className={
        rejected
          ? 'flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100'
          : 'flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100'
      }
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>
        <strong>Reason:</strong> {v.statusReason}
      </span>
    </div>
  )
}

/** Dev-only: make another reviewer claim this record, to demo the "claimed by someone else" and race cases in one tab. */
function SimulateOtherClaim({ v, actor, reviewers, onDone }: { v: VerificationDetail; actor: Actor; reviewers: UserSummary[]; onDone: (d: VerificationDetail) => void }) {
  // Reviewers come from the case's project only (userService.listReviewers).
  const others = reviewers.filter((r) => r.userId !== actor.userId)
  const [who, setWho] = useState('')
  if (v.status !== 'PENDING_REVIEW' || !others.length) return null
  const pick = others.find((o) => o.userId === who) ?? others[0]
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-amber-400 p-3 text-xs">
      <p className="flex items-center gap-1 font-medium text-amber-800 dark:text-amber-200">
        <FlaskConical className="size-3.5" aria-hidden /> Dev: simulate another reviewer
      </p>
      <div className="flex gap-2">
        <NativeSelect aria-label="Other reviewer" value={pick.userId} onChange={(e) => setWho(e.target.value)} className="flex-1">
          {others.map((o) => (
            <option key={o.userId} value={o.userId}>
              {o.fullName}
            </option>
          ))}
        </NativeSelect>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            verificationService.claim(v.referenceNo, pick as Actor).then(
              (d) => {
                toast.info(`${pick.fullName} claimed ${v.referenceNo}`)
                onDone(d)
              },
              (e: unknown) => toast.error(message(e)),
            )
          }
        >
          Claims it
        </Button>
      </div>
    </div>
  )
}

export function VerificationDetailPage() {
  const { referenceNo = '' } = useParams()
  const actor = useSession((s) => s.actor)
  const uiClaimChecks = useDevFlags((s) => s.uiClaimChecks)
  const me = useMyAccount()
  const now = useNow(1000)
  // One id per page visit: StrictMode's double effect and live refreshes don't log extra PII_VIEWs (DEC-41).
  const [requestId] = useState(() => crypto.randomUUID())
  const key = `${referenceNo}|${actor.userId}`
  const [loaded, setLoaded] = useState<Loaded>({ key: '' })
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reviewers, setReviewers] = useState<UserSummary[]>([])

  useEffect(() => {
    let live = true
    verificationService.get(referenceNo, actor, { requestId }).then(
      (detail) => live && setLoaded({ key, detail }),
      (e: unknown) => live && setLoaded({ key, error: { message: message(e), notFound: isServiceError(e) && e.code === 'NOT_FOUND' } }),
    )
    return () => {
      live = false
    }
  }, [referenceNo, actor, requestId, key, refresh])

  // Another tab (or the dev "simulate" button) changed data: refetch.
  useEffect(() => onVerificationsChanged(() => setRefresh((n) => n + 1)), [])

  const detail = loaded.key === key ? loaded.detail : undefined
  const projectId = detail?.projectId
  useEffect(() => {
    if (!projectId) return
    let live = true
    userService.listReviewers(actor, projectId).then((r) => live && setReviewers(r), () => live && setReviewers([]))
    return () => {
      live = false
    }
  }, [projectId, actor])

  const apply = useCallback((d: VerificationDetail) => setLoaded({ key, detail: d }), [key])

  const run = async (fn: () => Promise<VerificationDetail>, ok: string): Promise<boolean> => {
    setBusy(true)
    try {
      apply(await fn())
      toast.success(ok)
      return true
    } catch (e) {
      toast.error(message(e)) // e.g. "Your claim expired. No changes saved."
      setRefresh((n) => n + 1)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loaded.key !== key || !me.ready) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4" aria-busy>
        <div className="h-8 w-80 animate-pulse rounded bg-muted" />
        <div className="h-12 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-96 animate-pulse rounded-lg bg-muted" />
          <div className="h-72 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    )
  }
  if (loaded.error) {
    return loaded.error.notFound ? (
      <EmptyState title={`${referenceNo} not found`} action={<Link to="/verifications" className="text-sm text-blue-700 hover:underline dark:text-blue-400">Back to Verifications</Link>}>
        It doesn’t exist, or it belongs to a project you can’t access.
      </EmptyState>
    ) : (
      <ErrorState message={loaded.error.message} onRetry={() => setRefresh((n) => n + 1)} />
    )
  }

  const v = detail!
  const claimActive = isClaimActive(v, now)
  // REQ: DEC-70 / DEC-71 — what the buttons offer follows the user's role in this case's project; services check again.
  const may = (action: ProjectAction) => !!me.account && canInProject(me.account, action, v)

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <Link to="/verifications" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Verifications
      </Link>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{v.referenceNo}</h1>
          <StatusBadge status={v.status} className="text-sm" />
        </div>
        {/* REQ: DEC-44 — header: project, flow, workflow version, configuration revision, created, last updated. */}
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">{v.projectName}</span> › <span className="text-foreground">{v.flowName}</span> · {v.workflowVersion} · Rules applied{' '}
          <span className="font-mono text-foreground">{v.revisionLabel}</span> · {DOCUMENT_TYPE_LABELS[v.documentType]}
        </p>
        <p className="text-sm text-muted-foreground">
          Created {formatMyt(v.createdAt)} MYT · Last updated by <span className="text-foreground">{formatUpdatedBy(v.lastUpdatedBy)}</span> · {formatMyt(v.lastUpdatedAt)} MYT
          {may('viewAudit') && (
            <>
              {' · '}
              <Link to={`/audit?ref=${v.referenceNo}`} className="text-blue-700 hover:underline dark:text-blue-400">
                Audit trail
              </Link>
            </>
          )}
        </p>
      </header>

      <ClaimBar
        v={v}
        actor={actor}
        now={now}
        warningMin={DEFAULT_CLAIM_WARNING_MIN}
        mayClaim={may('claimCase')}
        busy={busy}
        onClaim={() => void run(() => verificationService.claim(v.referenceNo, actor), 'Assigned to you')}
        onRelease={() => void run(() => verificationService.release(v.referenceNo, actor), 'Claim cancelled')}
      />
      <ReasonBanner v={v} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <PiiSection v={v} />
          <IdCaptureSection v={v} />
          <SelfieSection v={v} />
          <CheckSection v={v} check="FACE_MATCH" />
          <CheckSection v={v} check="LIVENESS" />
          <RiskSection v={v} />
          <RulesAppliedSection v={v} />
          <ActivitySection v={v} />
          <ClientMetadataCard v={v} />
        </div>
        <aside className="space-y-3 lg:sticky lg:top-0">
          <DecisionOverlay
            key={`${v.referenceNo}|${actor.userId}`}
            v={v}
            actor={actor}
            now={now}
            uiClaimChecks={uiClaimChecks}
            mayDecide={may('decideCase')}
            busy={busy}
            onSave={(d: Decision) => run(() => verificationService.decide(v.referenceNo, actor, d), `Decision saved: ${d.outcome === 'APPROVE' ? 'Approved' : 'Rejected'}`)}
          />
          {!claimActive && <SimulateOtherClaim v={v} actor={actor} reviewers={reviewers} onDone={apply} />}
        </aside>
      </div>
    </div>
  )
}
