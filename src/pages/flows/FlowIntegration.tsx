import { useState, type FormEvent } from 'react'
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CopyId } from '@/components/common/CopyId'
import type { Flow, FlowApiKey, WebhookEvent } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { integrationService } from '@/services/integrationService'
import { useSession } from '@/stores/sessionStore'
import { Card } from '../projects/settingsUi'
import { cn } from '@/lib/utils'

/** Shown once after create / rotate / regenerate: the mock secret, with Copy. */
function SecretDialog({ title, secret, onClose }: { title: string; secret: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Copy it now. It is shown only once; afterwards only its last characters are visible. Mock value, never real.</DialogDescription>
        </DialogHeader>
        <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all" aria-label="Secret">
          {secret}
        </code>
        <DialogFooter>
          <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(secret).then(() => toast.success('Copied'))}>
            <Copy aria-hidden /> Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** REQ: DEC-97 — an API key's ID is shown masked: key_…a91f. */
const maskId = (id: string) => `${id.slice(0, id.indexOf('_') + 1)}…${id.slice(-4)}`

// Typed, so the sample follows the contract in types.ts.
const SAMPLE_EVENT: WebhookEvent = {
  event: 'verification.status_changed',
  verificationId: 'vrf_q8m2x7c1v9b4n6k3j5h0t2ra',
  flowId: 'flw_fvnn406j99wwk86pomyjx67a',
  referenceId: 'your-own-reference-for-this-user',
  status: 'APPROVED',
  lastUpdatedBy: { kind: 'SYSTEM' },
  occurredAt: '2026-11-18T02:15:00.000Z',
}

/** REQ: DEC-111 / DEC-117 — the secret goes in the header, from the merchant's server only; the key picks the flow. */
function SampleRequest({ flow }: { flow: Flow }) {
  return (
    <Card title="Developer info">
      <p className="text-sm">
        <CopyId label="Flow ID" value={flow.flowId} className="text-sm" />
        <span className="ml-2 text-xs text-muted-foreground">Named in each webhook delivery; not sent when starting a session.</span>
      </p>
      <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs" aria-label="Sample create-session request">
        {`POST /v1/sessions   (sample, mock)
Authorization: Bearer <a secret key of this flow>
{
  "referenceId": "your-own-reference-for-this-user"
}`}
      </pre>
      <p className="mt-2 text-xs text-muted-foreground">
        Call from your server only, never from an app or web page. The key picks this flow, so no flowId is sent. When the user finishes, they see our “Verification complete” page and your app decides what comes next; the result arrives on the webhook.
      </p>
    </Card>
  )
}

const STATUS_NOTE: Partial<Record<Flow['status'], string>> = {
  DRAFT: 'Draft: you can create keys and set the webhook now; sessions start once the flow is activated.',
  RETIRING: 'Retiring: new sessions with these keys are refused; cases already in progress still finish and are sent to the webhook.',
  INACTIVE: 'Inactive: new sessions with these keys are refused.',
}

// REQ: DEC-117 — the flow's API keys and webhook (Flow Detail › Integration). Saved at once: not a flow setting, so no
// reason and no revision (DEC-51); audited. View / Manage API keys and webhook (DEC-75, DEC-102).
export function FlowIntegration({ flow, canView }: { flow: Flow; canView: boolean }) {
  if (!canView) {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">API keys and the webhook need the View API keys and webhook permission.</p>
        <SampleRequest flow={flow} />
      </div>
    )
  }
  return <IntegrationCards flow={flow} />
}

function IntegrationCards({ flow }: { flow: Flow }) {
  const actor = useSession((s) => s.actor)
  const data = useLoad(() => integrationService.get(flow.flowId, actor), [flow.flowId, actor.userId])
  const [secret, setSecret] = useState<{ title: string; value: string }>()
  const [newKey, setNewKey] = useState<string>()
  const [keyError, setKeyError] = useState<string>()
  const [webhookUrl, setWebhookUrl] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  if (data.error && !data.data) return <ErrorState message={data.error} onRetry={data.reload} />
  if (!data.data) return <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy />
  const d = data.data
  const url = webhookUrl ?? d.webhook?.url ?? ''

  const run = async (fn: () => Promise<void>, failField?: string) => {
    setBusy(true)
    setErrors({})
    try {
      await fn()
      data.reload()
    } catch (e) {
      const details = (e as { details?: { field: string; message: string }[] }).details
      if (Array.isArray(details)) setErrors(Object.fromEntries(details.map((x) => [x.field, x.message])))
      else if (failField) setErrors({ [failField]: errorMessage(e) })
      else toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const createKey = (e: FormEvent) => {
    e.preventDefault()
    setKeyError(undefined)
    void (async () => {
      setBusy(true)
      try {
        const r = await integrationService.createKey(flow.flowId, newKey ?? '', actor)
        setNewKey(undefined)
        setSecret({ title: `API key “${r.value.name}” created`, value: r.secret })
        data.reload()
      } catch (err) {
        setKeyError(errorMessage(err))
      } finally {
        setBusy(false)
      }
    })()
  }

  const rotate = (k: FlowApiKey) =>
    window.confirm(`Rotate “${k.name}”? Its current secret stops working immediately.`) &&
    void run(async () => {
      const r = await integrationService.rotateKey(k.keyId, actor)
      setSecret({ title: `New secret for “${k.name}”`, value: r.secret })
    })
  const revoke = (k: FlowApiKey) =>
    window.confirm(`Revoke “${k.name}”? Calls with this key are refused from now on. This cannot be undone.`) &&
    void run(async () => {
      await integrationService.revokeKey(k.keyId, actor)
      toast.success(`“${k.name}” revoked`)
    })

  const saveWebhook = (regenerateSecret = false) =>
    run(async () => {
      const r = await integrationService.setWebhook(flow.flowId, { url, regenerateSecret }, actor)
      setWebhookUrl(undefined)
      if (r.secret) setSecret({ title: 'Webhook signing secret', value: r.secret })
      else toast.success('Webhook saved')
    }, 'url')

  return (
    <div className="space-y-4">
      {d.apiAccess !== 'LIVE' && (
        <p role="status" className={cn('rounded-md px-3 py-2 text-sm', d.apiAccess === 'STOPPED' ? 'bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200' : 'bg-blue-50 text-blue-900 dark:bg-blue-500/10 dark:text-blue-100')}>
          {d.apiAccess === 'STOPPED'
            ? 'Stopped: the merchant is suspended or terminated, so these keys refuse every request.'
            : 'Sandbox only: the merchant is Onboarding, so live requests with these keys are refused until it goes live.'}
        </p>
      )}
      {STATUS_NOTE[flow.status] && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{STATUS_NOTE[flow.status]}</p>}
      {!d.canManage && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Read-only: you can view API keys and the webhook but not change them.</p>}
      <Card title="API keys" aside={d.canManage ? <Button size="sm" onClick={() => setNewKey('')}><Plus aria-hidden /> Create key</Button> : undefined}>
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {['Name', 'Key ID', 'Secret', 'Status', 'Created', 'Last used'].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2 font-medium">{h}</th>
                ))}
                <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {d.keys.map((k) => (
                <tr key={k.keyId} className="border-t">
                  <th scope="row" className="px-4 py-2 text-left font-medium">{k.name}</th>
                  <td className="px-4 py-2 font-mono text-xs" title="Key ID, masked (DEC-97)">{maskId(k.keyId)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{k.secretHint}</td>
                  <td className="px-4 py-2">{k.status === 'ACTIVE' ? 'Active' : `Revoked ${formatMyt(k.revokedAt!).split(', ')[0]}`}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatMyt(k.createdAt).split(', ')[0]}<div className="text-xs text-muted-foreground">{k.createdBy}</div></td>
                  <td className="px-4 py-2 whitespace-nowrap">{k.lastUsedAt ? `${formatMyt(k.lastUsedAt)} MYT` : '—'}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {d.canManage && k.status === 'ACTIVE' && (
                      <>
                        <Button variant="ghost" size="icon-sm" aria-label={`Rotate ${k.name}`} title="Rotate" disabled={busy} onClick={() => rotate(k)}><RefreshCw aria-hidden /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${k.name}`} title="Revoke" disabled={busy} onClick={() => revoke(k)}><Trash2 aria-hidden /></Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Webhook">
        <div className="space-y-3">
          <FormField id="wh-url" label="Endpoint URL (HTTPS)" error={errors.url} hint="Receives verification.status_changed when a case of this flow becomes Pending Review, Approved, Rejected or Unsuccessful (DEC-55, DEC-112).">
            <Input id="wh-url" readOnly={!d.canManage} value={url} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://" aria-invalid={!!errors.url} />
          </FormField>
          <p className="text-sm">
            <span className="text-muted-foreground">Signing secret:</span> <span className="font-mono text-xs">{d.webhook?.secretHint ?? 'created with the first save'}</span>
          </p>
          <p className="text-xs text-muted-foreground">Non-2xx responses are retried up to 3 times at increasing intervals. Deliveries are simulated in the mock (MOCK-11).</p>
          {/* REQ: DEC-55 / DEC-117 — each delivery names the case and the flow (several flows may share one URL). */}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Sample delivery</summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs" aria-label="Sample webhook delivery">{JSON.stringify(SAMPLE_EVENT, null, 2)}</pre>
            <p className="mt-1 text-xs text-muted-foreground">IDs only, no personal data. Keep personal data (IC, phone, email) out of your Reference ID.</p>
          </details>
          <div className={cn('flex flex-wrap gap-2', !d.canManage && 'hidden')}>
            <Button size="sm" disabled={busy} onClick={() => void saveWebhook()}>Save webhook</Button>
            {d.webhook && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => window.confirm('Regenerate the signing secret? The old one stops verifying immediately.') && void saveWebhook(true)}>
                <KeyRound aria-hidden /> Regenerate secret
              </Button>
            )}
          </div>
        </div>
      </Card>

      {newKey !== undefined && (
        <Dialog open onOpenChange={(o) => !o && !busy && setNewKey(undefined)}>
          <DialogContent>
            <form onSubmit={createKey} noValidate className="space-y-4">
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>For the flow {flow.name}. Sessions started with it run on this flow. The secret is shown once.</DialogDescription>
              </DialogHeader>
              <FormField id="k-name" label="Key name" error={keyError}>
                <Input id="k-name" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g. Staging" autoFocus aria-invalid={!!keyError} />
              </FormField>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setNewKey(undefined)}>Cancel</Button>
                <Button type="submit" disabled={busy}>Create key</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      <SampleRequest flow={flow} />
      {secret && <SecretDialog title={secret.title} secret={secret.value} onClose={() => setSecret(undefined)} />}
    </div>
  )
}
