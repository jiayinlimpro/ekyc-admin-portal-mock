import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { AlertTriangle, ArrowLeft, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/common/NativeSelect'
import { StatusBadge } from '@/components/common/StatusBadge'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { ActivitySection, ChecksSection, EvidenceSection, RiskSection, RulesAppliedSection } from '@/components/verification/CaseSections'
import { AttemptsSection, TelemetrySection } from '@/components/verification/TelemetrySections'
import { ClaimBar } from '@/components/verification/ClaimBar'
import { DecisionOverlay } from '@/components/verification/DecisionOverlay'
import { ClientMetadataCard, PiiSection } from '@/components/verification/PiiSection'
import { formatUpdatedBy } from '@/domain/audit'
import { isClaimActive } from '@/domain/claimRules'
import { canInProject, type ProjectAction } from '@/domain/access'
import { RISK_NOT_PASSED } from '@/domain/checkRules'
import { DEFAULT_CLAIM_WARNING_MIN } from '@/domain/openQuestions'
import type { Actor, Decision, VerificationDetail } from '@/domain/types'
import { useAccess } from '@/app/access'
import { useNow } from '@/hooks/useNow'
import { formatMyt } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS, RISK_LABELS } from '@/lib/labels'
import { isServiceError } from '@/services/errors'
import { onVerificationsChanged } from '@/services/liveUpdates'
import { userService, type UserSummary } from '@/services/userService'
import { verificationService } from '@/services/verificationService'
import { useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { CopyId } from '@/components/common/CopyId'
import { useTabs } from '@/stores/tabsStore'

type Loaded = { key: string; detail?: VerificationDetail; error?: { message: string; notFound: boolean } }

const message = (e: unknown) => (isServiceError(e) ? e.message : 'Unexpected error.')

// REQ: DEC-105 — the condition plus target vs actual (the flow band and the score, or the risk maximum and the level).
function ReasonBanner({ v }: { v: VerificationDetail }) {
  if (!v.statusReason || (v.status !== 'PENDING_REVIEW' && v.status !== 'REJECTED')) return null
  const rejected = v.status === 'REJECTED'
  const max = v.rulesApplied.risk?.maxAllowedLevel
  const detail =
    v.statusReason === RISK_NOT_PASSED && max && v.riskLevel ? `Maximum allowed ${RISK_LABELS[max]} · Actual ${RISK_LABELS[v.riskLevel]} (${v.riskScore} / 100)` : v.statusDetail
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
        {detail && <span className="ml-2 font-mono text-xs tabular-nums">{detail}</span>}
        {v.newCaseAllowedAt && <span className="block text-xs">New case allowed from {formatMyt(v.newCaseAllowedAt)} MYT (cooldown)</span>}
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
            verificationService.claim(v.caseId, pick as Actor).then(
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
  const { caseId = '' } = useParams()
  const actor = useSession((s) => s.actor)
  const uiClaimChecks = useDevFlags((s) => s.uiClaimChecks)
  const me = useAccess() // the account and its project roles (DEC-71: the service checks again)
  const now = useNow(1000)
  // One id per page visit: StrictMode's double effect and live refreshes don't log extra PII_VIEWs (DEC-41).
  const [requestId] = useState(() => crypto.randomUUID())
  const key = `${caseId}|${actor.userId}`
  const [loaded, setLoaded] = useState<Loaded>({ key: '' })
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reviewers, setReviewers] = useState<UserSummary[]>([])

  useEffect(() => {
    let live = true
    verificationService.get(caseId, actor, { requestId }).then(
      (detail) => live && setLoaded({ key, detail }),
      (e: unknown) => live && setLoaded({ key, error: { message: message(e), notFound: isServiceError(e) && e.code === 'NOT_FOUND' } }),
    )
    return () => {
      live = false
    }
  }, [caseId, actor, requestId, key, refresh])

  // Another tab (or the dev "simulate" button) changed data: refetch.
  useEffect(() => onVerificationsChanged(() => setRefresh((n) => n + 1)), [])

  const detail = loaded.key === key ? loaded.detail : undefined
  const projectId = detail?.projectId

  // REQ: DEC-97 — the URL holds the case ID; the tab and breadcrumb read the merchant's Reference ID.
  const { pathname, search } = useLocation()
  const openTab = useTabs((s) => s.open)
  const referenceNo = detail?.referenceNo
  useEffect(() => {
    if (referenceNo) openTab({ key: pathname, to: pathname + search, title: referenceNo })
  }, [referenceNo, pathname, search, openTab])
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
          <h1 className="font-mono text-2xl font-semibold">{v.referenceNo}</h1>
          <StatusBadge status={v.status} className="text-sm" />
          {/* REQ: DEC-97 — the case ID, for support tickets and webhooks; the Reference ID above is the merchant's. */}
          <CopyId label="Case ID" value={v.caseId} />
        </div>
        {/* REQ: DEC-105 — header strip: project › flow, version and revision, created, source, last updated, audit. */}
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">{v.projectName}</span> › <span className="text-foreground">{v.flowName}</span> · {v.workflowVersion} · Rules applied{' '}
          <span className="font-mono text-foreground">{v.revisionLabel}</span> · {DOCUMENT_TYPE_LABELS[v.documentType]} · Source <span className="text-foreground">{v.clientMetadata.sdk}</span>
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
        onClaim={() => void run(() => verificationService.claim(v.caseId, actor), 'Assigned to you')}
        onRelease={() => void run(() => verificationService.release(v.caseId, actor), 'Claim cancelled')}
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
          <AttemptsSection v={v} />
          <div className="grid items-start gap-4 @2xl:grid-cols-2">
            <RulesAppliedSection v={v} />
            <ActivitySection v={v} />
          </div>
        </div>
        <aside className="space-y-3 lg:sticky lg:top-0">
          <DecisionOverlay
            key={`${v.caseId}|${actor.userId}`}
            v={v}
            actor={actor}
            now={now}
            uiClaimChecks={uiClaimChecks}
            mayDecide={may('decideCase')}
            busy={busy}
            onSave={(d: Decision) => run(() => verificationService.decide(v.caseId, actor, d), `Decision saved: ${d.outcome === 'APPROVE' ? 'Approved' : 'Rejected'}`)}
          />
          {!claimActive && <SimulateOtherClaim v={v} actor={actor} reviewers={reviewers} onDone={apply} />}
        </aside>
      </div>
    </div>
  )
}
