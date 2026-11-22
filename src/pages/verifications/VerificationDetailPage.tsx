import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { AlertTriangle, ArrowLeft, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/common/NativeSelect'
import { StatusBadge } from '@/components/common/StatusBadge'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { ChecksSection, EvidenceSection, RiskSection, RulesAppliedSection } from '@/components/verification/CaseSections'
import { SessionsSection } from '@/components/verification/SessionsSection'
import { AttemptsSection, TelemetrySection } from '@/components/verification/TelemetrySections'
import { ClaimBar } from '@/components/verification/ClaimBar'
import { DecisionOverlay } from '@/components/verification/DecisionOverlay'
import { ClientMetadataCard, PiiSection } from '@/components/verification/PiiSection'
import { formatUpdatedBy } from '@/domain/audit'
import { isClaimActive } from '@/domain/claimRules'
import { canInProject, type ProjectAction } from '@/domain/access'
import { DEFAULT_CLAIM_WARNING_MIN } from '@/domain/openQuestions'
import type { Actor, Decision, VerificationDetail } from '@/domain/types'
import { useAccess } from '@/app/access'
import { useNow } from '@/hooks/useNow'
import { formatMyt } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { isServiceError } from '@/services/errors'
import { onVerificationsChanged } from '@/services/liveUpdates'
import { userService, type UserSummary } from '@/services/userService'
import { verificationService } from '@/services/verificationService'
import { useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { CopyId } from '@/components/common/CopyId'
import { usePageTitle } from '@/stores/pageTitleStore'

type Loaded = { key: string; detail?: VerificationDetail; error?: { message: string; notFound: boolean } }

const message = (e: unknown) => (isServiceError(e) ? e.message : 'Unexpected error.')

const BANNER_STYLE = {
  PENDING_REVIEW: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100',
  REJECTED: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100',
  FAILED: 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-100', // REQ: DEC-112
} as const

// REQ: DEC-105 / DEC-107 / DEC-112 — the condition plus target vs actual (the flow band and the score, or the risk minimums missed).
function ReasonBanner({ v }: { v: VerificationDetail }) {
  if (!v.statusReason || !(v.status in BANNER_STYLE)) return null
  const detail = v.statusDetail // e.g. "Auto-Reject < 85 · Auto-Pass ≥ 95 · Actual 88.5", or "OSINT Score 22 < 30" (DEC-107)
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${BANNER_STYLE[v.status as keyof typeof BANNER_STYLE]}`}>
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>
        <strong>Reason:</strong> {v.statusReason}
        {detail && <span className="ml-2 font-mono text-xs tabular-nums">{detail}</span>}
        {v.newSessionAllowedAt && <span className="block text-xs">New session allowed from {formatMyt(v.newSessionAllowedAt)} MYT (cooldown)</span>}
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
            verificationService.claim(v.verificationId, pick as Actor).then(
              (d) => {
                toast.info(`${pick.fullName} claimed ${v.referenceId}`)
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
  const { verificationId = '' } = useParams()
  const actor = useSession((s) => s.actor)
  const uiClaimChecks = useDevFlags((s) => s.uiClaimChecks)
  const me = useAccess() // the account and its project roles (DEC-71: the service checks again)
  const now = useNow(1000)
  // One id per page visit: StrictMode's double effect and live refreshes don't log extra PII_VIEWs (DEC-41).
  const [requestId] = useState(() => crypto.randomUUID())
  const key = `${verificationId}|${actor.userId}`
  const [loaded, setLoaded] = useState<Loaded>({ key: '' })
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reviewers, setReviewers] = useState<UserSummary[]>([])

  useEffect(() => {
    let live = true
    verificationService.get(verificationId, actor, { requestId }).then(
      (detail) => live && setLoaded({ key, detail }),
      (e: unknown) => live && setLoaded({ key, error: { message: message(e), notFound: isServiceError(e) && e.code === 'NOT_FOUND' } }),
    )
    return () => {
      live = false
    }
  }, [verificationId, actor, requestId, key, refresh])

  // Another tab (or the dev "simulate" button) changed data: refetch.
  useEffect(() => onVerificationsChanged(() => setRefresh((n) => n + 1)), [])

  const detail = loaded.key === key ? loaded.detail : undefined
  const projectId = detail?.projectId

  // REQ: DEC-109 — a link to a case works from anywhere: the inner portal moves to the case's project.
  const selectProject = useSession((s) => s.selectProject)
  useEffect(() => {
    if (projectId && me.ready && me.selected?.projectId !== projectId && me.projects.some((p) => p.projectId === projectId)) selectProject(projectId)
  }, [projectId, me.ready, me.selected?.projectId, me.projects, selectProject])

  // REQ: DEC-97 — the URL holds the Verification ID; the breadcrumb reads the merchant's Reference ID.
  const { pathname } = useLocation()
  const setTitle = usePageTitle((s) => s.setTitle)
  const referenceId = detail?.referenceId
  useEffect(() => {
    if (referenceId) setTitle(pathname, referenceId)
  }, [referenceId, pathname, setTitle])
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
      <div className="mx-auto max-w-[1600px] space-y-4" aria-busy>
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
      <EmptyState title="Case not found" action={<Link to="/verifications" className="text-sm text-blue-700 hover:underline dark:text-blue-400">Back to Verifications</Link>}>
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
    <div className="mx-auto max-w-[1600px] space-y-4">
      <Link to="/verifications" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Verifications
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-[1_1_28rem] space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{v.referenceId}</h1>
          <StatusBadge status={v.status} className="text-sm" />
          {/* REQ: DEC-97 — the Verification ID, for support tickets and webhooks; the Reference ID above is the merchant's. */}
          <CopyId label="Verification ID" value={v.verificationId} />
        </div>
        {/* REQ: DEC-105 — header strip: project › flow, version and revision, created, last updated (no audit link). */}
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">{v.projectName}</span> › <span className="text-foreground">{v.flowName}</span> · {v.workflowVersion} · Rules applied{' '}
          <span className="font-mono text-foreground">{v.revisionLabel}</span> · {DOCUMENT_TYPE_LABELS[v.documentType]}
        </p>
        <p className="text-sm text-muted-foreground">
          Created {formatMyt(v.createdAt)} MYT · Last updated by <span className="text-foreground">{formatUpdatedBy(v.lastUpdatedBy)}</span> · {formatMyt(v.lastUpdatedAt)} MYT
        </p>
        </div>
        {/* REQ: DEC-105 — client metadata in the header's free space, top right (below the title on narrow screens). */}
        <ClientMetadataCard v={v} />
      </header>

      <ClaimBar
        v={v}
        actor={actor}
        now={now}
        warningMin={DEFAULT_CLAIM_WARNING_MIN}
        mayClaim={may('claimCase')}
        busy={busy}
        onClaim={() => void run(() => verificationService.claim(v.verificationId, actor), 'Assigned to you')}
        onRelease={() => void run(() => verificationService.release(v.verificationId, actor), 'Claim cancelled')}
      />
      <ReasonBanner v={v} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* REQ: DEC-105 — row 1: evidence | extracted data | checks and risk (columns follow the space available). */}
        <div className="@container min-w-0 space-y-4">
          <div className="grid items-start gap-4 @2xl:grid-cols-2 @4xl:grid-cols-3">
            <EvidenceSection v={v} />
            <PiiSection v={v} />
            <div className="space-y-4 @2xl:col-span-2 @4xl:col-span-1">
              <ChecksSection v={v} />
              <RiskSection v={v} />
            </div>
          </div>
          <TelemetrySection v={v} />
          <SessionsSection v={v} />
          <AttemptsSection v={v} />
          <RulesAppliedSection v={v} />
        </div>
        <aside className="space-y-3 lg:sticky lg:top-0">
          <DecisionOverlay
            key={`${v.verificationId}|${actor.userId}`}
            v={v}
            actor={actor}
            now={now}
            uiClaimChecks={uiClaimChecks}
            mayDecide={may('decideCase')}
            busy={busy}
            onSave={(d: Decision) => run(() => verificationService.decide(v.verificationId, actor, d), `Decision saved: ${d.outcome === 'APPROVE' ? 'Approved' : 'Rejected'}`)}
          />
          {!claimActive && <SimulateOtherClaim v={v} actor={actor} reviewers={reviewers} onDone={apply} />}
        </aside>
      </div>
    </div>
  )
}
