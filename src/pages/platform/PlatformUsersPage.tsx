// REQ: DEC-99 / DEC-109 / DEC-110 — Platform Users (outer layer, super admins): the platform staff accounts (one platform
// role each, every merchant; the super admin read-only) and the platform roles. Merchant users and merchant roles are in each merchant's Merchant settings.
import { useSearchParams } from 'react-router'
import { Tabs, tabPanelProps } from '@/components/common/Tabs'
import { RolesPage } from '@/pages/roles/RolesPage'
import { UsersPage } from '@/pages/users/UsersPage'

const TABS = [
  { value: 'users', label: 'Users' },
  { value: 'roles', label: 'Roles' },
] as const
type Tab = (typeof TABS)[number]['value']

export function PlatformUsersPage() {
  const [sp, setSp] = useSearchParams()
  const tab: Tab = sp.get('tab') === 'roles' ? 'roles' : 'users'
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <Tabs label="Platform Users" tabs={TABS} value={tab} onChange={(t) => setSp(t === 'users' ? {} : { tab: t }, { replace: true })} />
      <div {...tabPanelProps(tab)}>{tab === 'users' ? <UsersPage scope="PLATFORM" /> : <RolesPage scope="PLATFORM" />}</div>
    </div>
  )
}
