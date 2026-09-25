import { useEffect, useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { POLICY } from '@/domain/openQuestions'
import { can, PERMISSIONS } from '@/domain/permissions'
import { ROLES, type RoleType, type UserRecord } from '@/domain/types'
import { PERMISSION_LABELS, ROLE_LABELS } from '@/lib/labels'
import { uamService } from '@/services/uamService'
import { useSession } from '@/stores/sessionStore'

const ROLE_DESCRIPTIONS: Record<RoleType, string> = {
  PLATFORM_ADMIN: 'Runs the platform: all merchants, workflow configuration, users, billing and API keys.',
  MERCHANT_REVIEWER: 'Reviews verifications for one merchant: claims records and saves decisions.',
}

// REQ: DEC-70 — two roles only; permissions are fixed flags checked through can().
export function RolesPage() {
  const actor = useSession((s) => s.actor)
  const [users, setUsers] = useState<UserRecord[]>([])
  useEffect(() => {
    let live = true
    uamService.listUsers(actor).then((u) => live && setUsers(u), () => undefined)
    return () => {
      live = false
    }
  }, [actor])

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <header>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          Roles <OpenQuestionTag id="OQ-09" />
        </h1>
        <p className="text-sm text-muted-foreground">Two roles only. Permissions are fixed in this mock; the UI hides what a role can’t do, and the real backend must enforce it.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.map((r) => (
          <section key={r} aria-label={ROLE_LABELS[r]} className="rounded-lg border bg-card p-4">
            <h2 className="font-medium">{ROLE_LABELS[r]}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {users.filter((u) => u.role === r && u.active).length} active user(s) · code <span className="font-mono">{r}</span>
            </p>
          </section>
        ))}
      </div>
      <section aria-label="Permission matrix" className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Permissions per role</caption>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Permission</th>
              {ROLES.map((r) => (
                <th key={r} scope="col" className="px-4 py-2 text-center font-medium">{ROLE_LABELS[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p} className="border-t">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <div className="font-medium">{PERMISSION_LABELS[p].label}</div>
                  <div className="text-xs text-muted-foreground">
                    {PERMISSION_LABELS[p].description} <span className="font-mono">{p}</span>
                    {p === 'canReview' && (
                      <span className="ml-1">
                        · Admin review currently {POLICY.adminCanReview ? 'allowed' : 'blocked'} <OpenQuestionTag id="OQ-08" />
                      </span>
                    )}
                  </div>
                </th>
                {ROLES.map((r) => (
                  <td key={r} className="px-4 py-2 text-center">
                    {can({ role: r }, p) ? (
                      <span role="img" aria-label="Allowed" className="inline-flex">
                        <Check className="size-4 text-green-600" aria-hidden />
                      </span>
                    ) : (
                      <span role="img" aria-label="Not allowed" className="inline-flex">
                        <Minus className="size-4 text-muted-foreground" aria-hidden />
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
