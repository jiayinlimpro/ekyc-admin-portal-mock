import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound, PauseCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Merchant } from '@/domain/types'
import { formatMyt } from '@/lib/format'
import { developerService, type MaskedCredential } from '@/services/developerService'
import { isServiceError } from '@/services/errors'
import { merchantService } from '@/services/merchantService'
import { useSession } from '@/stores/sessionStore'

const message = (e: unknown) => (isServiceError(e) ? e.message : 'Unexpected error.')
const API_BASE = 'https://api.ekyc.example/v1' // reserved example domain: illustrative only

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="space-y-3 p-4 text-sm">{children}</div>
    </section>
  )
}

export function DevelopersPage() {
  const actor = useSession((s) => s.actor)
  const selected = useSession((s) => s.merchantId)
  const selectMerchant = useSession((s) => s.selectMerchant)
  const [merchants, setMerchants] = useState<Merchant[]>()
  const [cred, setCred] = useState<{ merchantId: string; value?: MaskedCredential; error?: string }>()
  const [secret, setSecret] = useState<{ merchantId: string; value: string }>()
  const [rotating, setRotating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let live = true
    merchantService.list(actor).then((m) => live && setMerchants(m), () => live && setMerchants([]))
    return () => {
      live = false
    }
  }, [actor])

  const merchant = merchants?.find((m) => m.merchantId === selected) ?? merchants?.[0]
  const merchantId = merchant?.merchantId

  useEffect(() => {
    if (!merchantId) return
    let live = true
    developerService.getCredential(merchantId, actor).then(
      (value) => live && setCred({ merchantId, value }),
      (e: unknown) => live && setCred({ merchantId, error: message(e) }),
    )
    return () => {
      live = false
    }
  }, [merchantId, actor, refresh])

  if (cred?.error) return <ErrorState message={cred.error} onRetry={() => setRefresh((n) => n + 1)} />
  const c = cred?.merchantId === merchantId ? cred?.value : undefined
  const revealed = secret && secret.merchantId === merchantId ? secret.value : undefined

  const reveal = async () => {
    if (revealed) return setSecret(undefined)
    try {
      setSecret({ merchantId: merchantId!, value: await developerService.revealCredential(merchantId!, actor) })
    } catch (e) {
      toast.error(message(e))
    }
  }
  const copy = async () => {
    try {
      const value = revealed ?? (await developerService.revealCredential(merchantId!, actor))
      await navigator.clipboard.writeText(value)
      toast.success('API key copied')
    } catch (e) {
      toast.error(isServiceError(e) ? e.message : 'Couldn’t copy — your browser blocked clipboard access.')
    }
  }
  const rotate = async () => {
    setBusy(true)
    try {
      const next = await developerService.rotateCredential(merchantId!, actor)
      setSecret(undefined)
      setCred({ merchantId: merchantId!, value: next })
      toast.success(`Rotated: ${next.keyId} is now active`)
      setRotating(false)
    } catch (e) {
      toast.error(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Developers</h1>
          <p className="text-sm text-muted-foreground">API credentials and integration notes. Keys here are fake (sk_mock_…).</p>
        </div>
        {merchants && merchant && (
          <label className="flex items-center gap-2 text-sm">
            Merchant
            <NativeSelect value={merchant.merchantId} className="w-64" onChange={(e) => selectMerchant(e.target.value)}>
              {merchants.map((m) => (
                <option key={m.merchantId} value={m.merchantId}>{m.name}</option>
              ))}
            </NativeSelect>
          </label>
        )}
      </header>

      <Card title="API key" aside={<KeyRound className="size-4 text-muted-foreground" aria-hidden />}>
        {!c ? (
          <div className="h-16 animate-pulse rounded bg-muted" aria-busy />
        ) : (
          <>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
              <dt className="text-muted-foreground">Key ID</dt>
              <dd className="font-mono">{c.keyId}</dd>
              <dt className="text-muted-foreground">Secret</dt>
              <dd className="font-mono break-all" aria-live="polite">{revealed ?? c.masked}</dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{formatMyt(c.createdAt)} MYT · {c.createdBy}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void reveal()}>
                {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />} {revealed ? 'Hide' : 'Reveal'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                <Copy aria-hidden /> Copy
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRotating(true)}>
                <RefreshCw aria-hidden /> Rotate…
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Rotation is recorded in the audit log (CREDENTIAL_ROTATION). A real portal would require re-authentication before reveal.</p>
          </>
        )}
      </Card>

      <Card title="Calling the API">
        <p className="text-muted-foreground">Illustrative request, for integration discussions only. Nothing here calls a server.</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{`curl -X POST ${API_BASE}/verifications \\
  -H "Authorization: Bearer ${c?.masked ?? 'sk_mock_…'}" \\
  -H "Content-Type: application/json" \\
  -d '{ "externalRef": "ORDER-1234", "callbackUrl": null }'`}</pre>
      </Card>

      <Card title="Client metadata captured by the SDK">
        <p>With every session the SDK sends: SDK name and version, operating system, device or browser, IP address and approximate location.</p>
        <p className="text-muted-foreground">Reviewers see it on the verification detail page only (each view is audited). It never appears in the Verifications list.</p>
      </Card>

      <section aria-label="Webhooks" className="rounded-lg border border-dashed bg-muted/30">
        <div className="flex items-center justify-between gap-2 border-b border-dashed px-4 py-2.5">
          <h2 className="text-sm font-semibold text-muted-foreground">Webhooks</h2>
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
            <PauseCircle className="size-3.5" aria-hidden /> On hold
          </span>
        </div>
        <div className="space-y-2 p-4 text-sm text-muted-foreground">
          <p>Webhook configuration (W1 status changed, W2 decision saved) is on hold and not part of this release.</p>
          <fieldset disabled className="grid gap-2 opacity-60 sm:grid-cols-[10rem_1fr]">
            <legend className="sr-only">Webhook settings (disabled)</legend>
            <span>W1 · Status changed</span>
            <input className="h-8 rounded-md border bg-transparent px-2" placeholder="https://…" aria-label="W1 endpoint (on hold)" />
            <span>W2 · Decision saved</span>
            <input className="h-8 rounded-md border bg-transparent px-2" placeholder="https://…" aria-label="W2 endpoint (on hold)" />
          </fieldset>
        </div>
      </section>

      <Dialog open={rotating} onOpenChange={(o) => !busy && setRotating(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate the API key for {merchant?.name}?</DialogTitle>
            <DialogDescription>A new key is issued and {c?.keyId} stops working immediately. Integrations using it will fail until they switch to the new key.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setRotating(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void rotate()}>{busy ? 'Rotating…' : 'Rotate key'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
