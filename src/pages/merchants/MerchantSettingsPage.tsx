// REQ: DEC-109 — Merchant settings (outer layer, from a merchant's ⚙ or 👥 on the Merchants page): the merchant-wide screens.
// General (details; edit and status for platform users) · Users · Roles (merchant roles) · Billing (every project) ·
// Audit log (the whole merchant). Each tab shows only with its permission; the services check again.
import { Link, useParams, useSearchParams } from 'react-router'
import { MerchantScope, useAccess } from '@/app/access'
import { EmptyState } from '@/components/common/States'
import { Tabs, tabPanelProps } from '@/components/common/Tabs'
import { canInMerchant, canOnPlatform, type ProjectAction } from '@/domain/access'
import { useLoad } from '@/hooks/useLoad'
import { AuditLogsPage } from '@/pages/audit/AuditLogsPage'
import { BillingPage } from '@/pages/billing/BillingPage'
import { RolesPage } from '@/pages/roles/RolesPage'
import { UsersPage } from '@/pages/users/UsersPage'
import { merchantService } from '@/services/merchantService'
import { useSession } from '@/stores/sessionStore'
import { MerchantGeneral } from './MerchantGeneral'

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'users', label: 'Users' },
  { value: 'roles', label: 'Roles' },
  { value: 'billing', label: 'Billing' },
  { value: 'audit', label: 'Audit log' },
] as const
type Tab = (typeof TABS)[number]['value']

const NEEDS: Record<Exclude<Tab, 'general'>, ProjectAction> = { users: 'viewUsers', roles: 'viewRoles', billing: 'viewBilling', audit: 'viewAudit' }

export function MerchantSettingsPage() {
  const { merchantId = '' } = useParams()
  const actor = useSession((s) => s.actor)
  const { account, ready } = useAccess()
  const [sp, setSp] = useSearchParams()
  const merchant = useLoad(() => merchantService.get(merchantId, actor), [merchantId, actor.userId])
  const allowed = (t: Tab) => (t === 'general' ? true : !!account && canInMerchant(account, NEEDS[t], merchantId))
  const tabs = TABS.filter((t) => allowed(t.value))
  const asked = sp.get('tab') as Tab | null
  const tab: Tab = asked && tabs.some((t) => t.value === asked) ? asked : 'general'

  if (merchant.error && !merchant.data) {
    return (
      <EmptyState title="Merchant not found" action={<Link to="/" className="text-sm text-blue-700 hover:underline dark:text-blue-400">Back to Merchants</Link>}>
        It doesn’t exist, or it isn’t one you can open.
      </EmptyState>
    )
  }
  if (!merchant.data || !ready) return <div className="mx-auto h-40 max-w-[1400px] animate-pulse rounded-lg bg-muted" aria-busy aria-label="Loading merchant settings" />
  const platformUser = !!account && canOnPlatform(account, 'viewMerchants')

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header>
        <p className="text-sm text-muted-foreground">Merchant settings{platformUser ? '' : ' · your merchant'}</p>
        <p className="text-2xl font-semibold">{merchant.data.name}</p>
      </header>
      <Tabs label="Merchant settings" tabs={tabs} value={tab} onChange={(t) => setSp(t === 'general' ? {} : { tab: t }, { replace: true })} />
      <div {...tabPanelProps(tab)}>
        <MerchantScope merchantId={merchantId}>
          {tab === 'general' && <MerchantGeneral merchantId={merchantId} />}
          {tab === 'users' && <UsersPage scope={{ merchantId }} />}
          {tab === 'roles' && <RolesPage scope={{ merchantId }} />}
          {tab === 'billing' && <BillingPage />}
          {tab === 'audit' && <AuditLogsPage />}
        </MerchantScope>
      </div>
    </div>
  )
}
