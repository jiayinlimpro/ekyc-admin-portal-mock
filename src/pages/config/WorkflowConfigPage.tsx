import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router'
import { Info, Rocket, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { RiskBadge } from '@/components/common/RiskBadge'
import { ErrorState } from '@/components/common/States'
import { Switch } from '@/components/common/Switch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { bumpMinor, diffConfig, validateConfig, type ConfigChange, type ImpactCounts } from '@/domain/configRules'
import { RISK_LEVELS, PHASE_LABELS, type Merchant, type MerchantConfig, type Phase } from '@/domain/types'
import { formatMyt } from '@/lib/format'
import { RISK_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { configService, type ConfigDraftInput } from '@/services/configService'
import { isServiceError } from '@/services/errors'
import { merchantService } from '@/services/merchantService'
import { useSession } from '@/stores/sessionStore'
import { DiffBadge, NumberField, PhaseCard } from './PhaseCard'

type Loaded = { key: string; baseline?: MerchantConfig; draft?: MerchantConfig | null; versions?: MerchantConfig[]; error?: string }

const message = (e: unknown) => (isServiceError(e) ? e.message : 'Unexpected error.')
const toInput = (c: MerchantConfig): ConfigDraftInput => ({ phases: c.phases, risk: c.risk, claimTimeoutMin: c.claimTimeoutMin, claimWarningMin: c.claimWarningMin })
const asConfig = (base: MerchantConfig, input: ConfigDraftInput): MerchantConfig => ({ ...base, ...input })

function describeField(field: string): string {
  const [head, phase, key] = field.split('.')
  const names: Record<string, string> = { autoPass: 'Auto-Pass', autoReject: 'Auto-Reject', maxAttempts: 'Max attempts', cooldownSec: 'Cooldown (sec)', enabled: 'Enabled', maxAllowedLevel: 'Max allowed risk level' }
  if (head === 'phases') return `${PHASE_LABELS[phase as Phase]} · ${names[key] ?? key}`
  if (head === 'risk') return `Risk Assessment · ${names[phase] ?? phase}`
  return { claimTimeoutMin: 'Claim timeout (min)', claimWarningMin: 'Claim warning (min)' }[field] ?? field
}
const show = (v: unknown) => (v === true ? 'on' : v === false ? 'off' : v === undefined ? '—' : String(v))

function BaselinePanel({ baseline, versions }: { baseline: MerchantConfig; versions: MerchantConfig[] }) {
  return (
    <section aria-labelledby="baseline-heading" className="rounded-lg border bg-card">
      <div className="border-b px-4 py-2.5">
        <h2 id="baseline-heading" className="text-sm font-semibold">
          Active production baseline
        </h2>
        <p className="text-xs text-muted-foreground">
          {baseline.version} · deployed {baseline.deployedAt ? formatMyt(baseline.deployedAt) : '—'} by {baseline.updatedBy.fullName} · read-only
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Phase</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Reject &lt;</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Pass ≥</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Tries</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Cool.</th>
          </tr>
        </thead>
        <tbody>
          {baseline.phases.map((p) => (
            <tr key={p.phase} className={cn('border-t', !p.enabled && 'text-muted-foreground line-through')}>
              <th scope="row" className="px-4 py-1.5 text-left font-normal">{PHASE_LABELS[p.phase]}</th>
              <td className="px-2 py-1.5 text-right tabular-nums">{p.autoReject}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{p.autoPass}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{p.maxAttempts}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{p.cooldownSec}s</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="grid grid-cols-2 gap-2 border-t px-4 py-3 text-sm">
        {baseline.risk && (
          <>
            <dt className="text-muted-foreground">Risk gate</dt>
            <dd>{baseline.risk.enabled ? <>max <RiskBadge level={baseline.risk.maxAllowedLevel} /></> : 'off'}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Claim timeout</dt>
        <dd>
          {baseline.claimTimeoutMin} min (warn {baseline.claimWarningMin} min)
        </dd>
      </dl>
      <div className="border-t px-4 py-3">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Version history</h3>
        <ol className="space-y-1 text-xs">
          {versions.map((c) => (
            <li key={c.version} className="flex justify-between gap-2">
              <span className="font-mono">{c.version}</span>
              <span className="text-muted-foreground">
                {c.deployedAt ? formatMyt(c.deployedAt) : '—'} · {c.updatedBy.fullName}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function ImpactPreview({ preview, loading }: { preview?: { baseline: ImpactCounts; draft: ImpactCounts }; loading: boolean }) {
  const rows = [
    ['APPROVED', 'Auto-approved'],
    ['PENDING_REVIEW', 'Pending review'],
    ['REJECTED', 'Auto-rejected'],
  ] as const
  const pct = (c: ImpactCounts, k: (typeof rows)[number][0]) => (c.total ? (100 * c[k]) / c.total : 0)
  return (
    <section aria-labelledby="impact-heading" className="rounded-lg border bg-card">
      <div className="border-b px-4 py-2.5">
        <h2 id="impact-heading" className="text-sm font-semibold">
          What-if preview
        </h2>
        <p className="text-xs text-muted-foreground">
          System outcome of this merchant’s {preview?.baseline.total ?? '…'} finished sessions (mock data) under the baseline vs this canvas. Preview only — nothing already decided changes.
        </p>
      </div>
      <table className={cn('w-full text-sm transition-opacity', loading && 'opacity-50')} aria-busy={loading}>
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Outcome</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Baseline</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Canvas</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, label]) => {
            const b = preview ? pct(preview.baseline, k) : 0
            const d = preview ? pct(preview.draft, k) : 0
            const delta = d - b
            return (
              <tr key={k} className="border-t">
                <th scope="row" className="px-4 py-1.5 text-left font-normal">{label}</th>
                <td className="px-4 py-1.5 text-right tabular-nums">{preview ? `${b.toFixed(1)}% (${preview.baseline[k]})` : '—'}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{preview ? `${d.toFixed(1)}% (${preview.draft[k]})` : '—'}</td>
                <td className={cn('px-4 py-1.5 text-right tabular-nums', Math.abs(delta) >= 0.05 ? 'font-medium' : 'text-muted-foreground')}>
                  {preview ? `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta).toFixed(1)} pt` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function DeployDialog({ open, changes, from, to, busy, onCancel, onConfirm }: { open: boolean; changes: ConfigChange[]; from: string; to: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Deploy {from} → {to}?
          </DialogTitle>
          <DialogDescription>Applies to new sessions only. Sessions already in progress keep {from}. This is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 font-medium">Setting</th>
              <th scope="col" className="py-1 text-right font-medium">From</th>
              <th scope="col" className="py-1 text-right font-medium">To</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.field} className="border-t">
                <td className="py-1.5">{describeField(c.field)}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{show(c.from)}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">{show(c.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Back
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            <Rocket aria-hidden /> {busy ? 'Deploying…' : `Deploy ${to}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfigEditor({
  merchant,
  merchants,
  baseline,
  savedDraft,
  versions,
  onMerchantChange,
  onChanged,
}: {
  merchant: Merchant
  merchants: Merchant[]
  baseline: MerchantConfig
  savedDraft: MerchantConfig | null
  versions: MerchantConfig[]
  onMerchantChange: (id: string) => void
  onChanged: () => void
}) {
  const actor = useSession((s) => s.actor)
  const [canvas, setCanvas] = useState<ConfigDraftInput>(() => toInput(savedDraft ?? baseline))
  const [busy, setBusy] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [preview, setPreview] = useState<{ key: string; value: { baseline: ImpactCounts; draft: ImpactCounts } }>()

  const draftConfig = asConfig(baseline, canvas)
  const errors = validateConfig(draftConfig)
  const changes = diffConfig(baseline, draftConfig)
  const unsaved = savedDraft ? diffConfig(savedDraft, draftConfig).length > 0 : changes.length > 0
  const nextVersion = bumpMinor(baseline.version)
  const canvasKey = JSON.stringify(canvas)

  // Debounced what-if: only when the canvas is valid.
  useEffect(() => {
    if (errors.length) return
    const t = setTimeout(() => {
      configService.previewImpact(merchant.merchantId, JSON.parse(canvasKey) as ConfigDraftInput, actor).then(
        (value) => setPreview({ key: canvasKey, value }),
        () => undefined,
      )
    }, 300)
    return () => clearTimeout(t)
  }, [canvasKey, merchant.merchantId, actor, errors.length])

  // Leaving the page (menu, tab, back) with unsaved edits asks first.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => unsaved && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('You have unsaved changes on the canvas. Leave and lose them?')) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      onChanged()
      return true
    } catch (e) {
      toast.error(message(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const setPhase = (i: number, p: ConfigDraftInput['phases'][number]) => setCanvas((c) => ({ ...c, phases: c.phases.map((x, j) => (j === i ? p : x)) }))
  const onDiscard = () => {
    if (savedDraft) void run(() => configService.discardDraft(merchant.merchantId, actor), 'Draft discarded')
    else setCanvas(toInput(baseline))
  }
  const onSave = () => void run(() => configService.saveDraft(merchant.merchantId, canvas, actor), `Draft ${nextVersion} saved`)
  const onDeploy = async () => {
    const ok = await run(async () => {
      if (unsaved) await configService.saveDraft(merchant.merchantId, canvas, actor)
      await configService.deploy(merchant.merchantId, actor)
    }, `Deployed ${nextVersion} — applies to new sessions`)
    if (ok) setDeploying(false)
  }

  let status: React.ReactNode
  if (unsaved) status = <span className="font-medium text-amber-700 dark:text-amber-300">Unsaved changes</span>
  else if (savedDraft) status = <>Draft {savedDraft.version} saved {formatMyt(savedDraft.updatedAt)} by {savedDraft.updatedBy.fullName}</>
  else status = <>Canvas matches production {baseline.version}</>

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">eKYC Workflow</h1>
          <p className="text-sm text-muted-foreground">Settings are per phase. Individual metrics are display-only.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Merchant
          <NativeSelect
            value={merchant.merchantId}
            className="w-64"
            onChange={(e) => {
              if (!unsaved || window.confirm('You have unsaved changes. Switch merchant and lose them?')) onMerchantChange(e.target.value)
            }}
          >
            {merchants.map((m) => (
              <option key={m.merchantId} value={m.merchantId}>
                {m.name} ({m.workflowVersion})
              </option>
            ))}
          </NativeSelect>
        </label>
      </header>

      <div role="note" className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100">
        <Info className="size-4 shrink-0" aria-hidden />
        Deploying applies to new sessions only. In-flight verifications keep the config version they started with (currently {baseline.version}).
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4 xl:sticky xl:top-0">
          <BaselinePanel baseline={baseline} versions={versions} />
        </div>

        <section aria-labelledby="canvas-heading" className="min-w-0 space-y-4">
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border bg-card/95 px-4 py-3 backdrop-blur">
            <div className="min-w-0 flex-1">
              <h2 id="canvas-heading" className="text-sm font-semibold">
                Staging canvas · {merchant.name} · next {nextVersion}
              </h2>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {status}
                {errors.length > 0 && <span className="ml-2 text-destructive">· {errors.length} error(s) to fix</span>}
                {changes.length > 0 && <span className="ml-2">· {changes.length} change(s) vs production</span>}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={busy || (!savedDraft && !unsaved)} onClick={onDiscard}>
              <RotateCcw aria-hidden /> {savedDraft ? 'Discard draft' : 'Discard changes'}
            </Button>
            <Button variant="outline" size="sm" disabled={busy || !unsaved || errors.length > 0} onClick={onSave}>
              <Save aria-hidden /> Save draft
            </Button>
            <Button size="sm" disabled={busy || changes.length === 0 || errors.length > 0} onClick={() => setDeploying(true)}>
              <Rocket aria-hidden /> Deploy
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Default thresholds, attempts and cooldowns are placeholders: <OpenQuestionTag id="OQ-02" /> <OpenQuestionTag id="OQ-03" />
          </div>
          {canvas.phases.map((p, i) => (
            <PhaseCard key={p.phase} value={p} baseline={baseline.phases.find((b) => b.phase === p.phase)} errors={errors} onChange={(n) => setPhase(i, n)} />
          ))}

          {merchant.workflowVersion === 'V4' && canvas.risk && (
            <section aria-label="Risk Assessment phase" className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h3 className="font-medium">Risk Assessment</h3>
                <span className="text-xs text-muted-foreground">V4 only · internal engine</span>
                <Switch checked={canvas.risk.enabled} onChange={(v) => setCanvas((c) => ({ ...c, risk: { ...c.risk!, enabled: v } }))} label="Risk Assessment enabled" />
                <DiffBadge from={baseline.risk?.enabled} to={canvas.risk.enabled} format={(v: boolean) => (v ? 'on' : 'off')} />
                <OpenQuestionTag id="OQ-05" />
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <label htmlFor="risk-max" className="text-xs font-medium text-muted-foreground">
                      Max risk level for auto-approval
                    </label>
                    <DiffBadge from={baseline.risk?.maxAllowedLevel} to={canvas.risk.maxAllowedLevel} format={(v: string) => RISK_LABELS[v as keyof typeof RISK_LABELS]} />
                  </div>
                  <NativeSelect
                    id="risk-max"
                    className="w-40"
                    disabled={!canvas.risk.enabled}
                    value={canvas.risk.maxAllowedLevel}
                    onChange={(e) => setCanvas((c) => ({ ...c, risk: { ...c.risk!, maxAllowedLevel: e.target.value as (typeof RISK_LEVELS)[number] } }))}
                  >
                    {RISK_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {RISK_LABELS[l]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <p className="max-w-md text-xs text-muted-foreground">Above this level an otherwise passing session goes to Pending Review. Risk never auto-rejects in the mock.</p>
              </div>
            </section>
          )}

          <section aria-label="Claim settings" className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center gap-3">
              <h3 className="font-medium">Review claim</h3>
              <span className="text-xs text-muted-foreground">Merchant-level</span>
              <OpenQuestionTag id="OQ-04" />
            </div>
            <div className="flex flex-wrap gap-6">
              <NumberField id="claim-timeout" label="Claim timeout" suffix="min" value={canvas.claimTimeoutMin} baseline={baseline.claimTimeoutMin} errors={errors} field="claimTimeoutMin" min={1} onChange={(n) => setCanvas((c) => ({ ...c, claimTimeoutMin: n }))} />
              <NumberField id="claim-warning" label="Warn before expiry" suffix="min" value={canvas.claimWarningMin} baseline={baseline.claimWarningMin} errors={errors} field="claimWarningMin" min={0} onChange={(n) => setCanvas((c) => ({ ...c, claimWarningMin: n }))} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">A new timeout applies to claims made after deployment.</p>
          </section>

          <ImpactPreview preview={preview?.value} loading={!!preview && preview.key !== canvasKey} />
        </section>
      </div>

      <DeployDialog open={deploying} changes={changes} from={baseline.version} to={nextVersion} busy={busy} onCancel={() => setDeploying(false)} onConfirm={() => void onDeploy()} />
    </div>
  )
}

export function WorkflowConfigPage() {
  const actor = useSession((s) => s.actor)
  const selected = useSession((s) => s.merchantId)
  const selectMerchant = useSession((s) => s.selectMerchant)
  const [merchants, setMerchants] = useState<Merchant[]>()
  const [refresh, setRefresh] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>({ key: '' })

  useEffect(() => {
    let live = true
    merchantService.list(actor).then(
      (m) => live && setMerchants(m),
      (e: unknown) => live && setLoaded({ key: 'merchants', error: message(e) }),
    )
    return () => {
      live = false
    }
  }, [actor])

  // Top-bar "All merchants" → default to the first merchant until one is picked.
  const merchant = merchants?.find((m) => m.merchantId === selected) ?? merchants?.[0]
  const key = merchant ? `${merchant.merchantId}|${refresh}` : ''

  useEffect(() => {
    if (!merchant) return
    let live = true
    const id = merchant.merchantId
    Promise.all([configService.getActive(id, actor), configService.getDraft(id, actor), configService.listVersions(id, actor)]).then(
      ([baseline, draft, versions]) => live && setLoaded({ key: `${id}|${refresh}`, baseline, draft, versions }),
      (e: unknown) => live && setLoaded({ key: `${id}|${refresh}`, error: message(e) }),
    )
    return () => {
      live = false
    }
  }, [merchant, actor, refresh])

  if (loaded.error) return <ErrorState message={loaded.error} onRetry={() => setRefresh((n) => n + 1)} />
  if (!merchant || !merchants || loaded.key !== key || !loaded.baseline) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4" aria-busy>
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <div className="h-96 animate-pulse rounded-lg bg-muted" />
          <div className="h-[36rem] animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <ConfigEditor
        // Re-mount on merchant change or after save/discard/deploy, so the canvas starts from the stored state.
        key={`${merchant.merchantId}|${loaded.baseline.version}|${loaded.draft?.updatedAt ?? 'none'}|${refresh}`}
        merchant={merchant}
        merchants={merchants}
        baseline={loaded.baseline}
        savedDraft={loaded.draft ?? null}
        versions={loaded.versions ?? []}
        onMerchantChange={selectMerchant}
        onChanged={() => setRefresh((n) => n + 1)}
      />
    </div>
  )
}
