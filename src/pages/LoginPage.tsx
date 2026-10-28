import { useNavigate } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { useUsers } from '@/hooks/useUsers'
import { useSession } from '@/stores/sessionStore'

/** Mock login: pick a demo user. The real portal uses real authentication and a Secure, HttpOnly session cookie. */
export function LoginPage() {
  const users = useUsers().filter((u) => u.status === 'ACTIVE' && !u.signInBlocked)
  // Super admin first, then one group per merchant.
  // Super admins, then platform staff, then one group per merchant (DEC-99).
  const groupOf = (u: (typeof users)[number]) => u.merchantName ?? (u.level === 'PLATFORM_STAFF' ? 'Platform users' : 'Super admin')
  const rank = (g: string) => (g === 'Super admin' ? 0 : g === 'Platform users' ? 1 : 2)
  const groups = [...new Set(users.map(groupOf))].sort((a, b) => rank(a) - rank(b))
  const switchUser = useSession((s) => s.switchUser)
  const navigate = useNavigate()
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-7 text-blue-600 dark:text-blue-400" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold">eKYC Admin Portal</h1>
            <p className="text-xs text-muted-foreground">Mock sign-in · fake data · not production</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Choose who to sign in as. There are no passwords in the mock.</p>
        {groups.map((g) => (
          <section key={g} aria-label={g}>
            <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g}</h2>
            <ul className="divide-y rounded-lg border">
              {users
                .filter((u) => groupOf(u) === g)
                .map((u) => (
                  <li key={u.userId}>
                    <button
                      type="button"
                      onClick={() => {
                        switchUser(u)
                        navigate('/')
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span>{u.fullName}</span>
                      <span className="text-right text-xs text-muted-foreground">{u.access}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          Real build: session in a <span className="font-mono">Secure; HttpOnly; SameSite</span> cookie, checked server-side on every request. Cookie flags can’t be demonstrated in a static mock.
        </p>
      </div>
    </main>
  )
}
