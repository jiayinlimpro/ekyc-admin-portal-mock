// REQ: DEC-99 / DEC-109 — Platform staff (outer layer, super admins): the staff accounts (one platform role each, every
// merchant) and the platform roles. Merchant users and merchant roles are in each merchant's Merchant settings.
import { useSearchParams } from 'react-router'
import { Tabs, tabPanelProps } from '@/components/common/Tabs'
import { RolesPage } from '@/pages/roles/RolesPage'
import { UsersPage } from '@/pages/users/UsersPage'

const TABS = [
  { value: 'staff', label: 'Staff' },
  { value: 'roles', label: 'Platform roles' },
] as const
type Tab = (typeof TABS)[number]['value']

export function PlatformStaffPage() {
  const [sp, setSp] = useSearchParams()
  const tab: Tab = sp.get('tab') === 'roles' ? 'roles' : 'staff'
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <Tabs label="Platform staff" tabs={TABS} value={tab} onChange={(t) => setSp(t === 'staff' ? {} : { tab: t }, { replace: true })} />
      <div {...tabPanelProps(tab)}>{tab === 'staff' ? <UsersPage scope="PLATFORM" /> : <RolesPage scope="PLATFORM" />}</div>
    </div>
  )
}
