import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2, CircleDashed } from 'lucide-react'
import { NAV_ITEMS } from '@/app/nav'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useUsers } from '@/hooks/useUsers'
import { ROLE_LABELS } from '@/lib/labels'
import { devService, type ScenarioSummary } from '@/services/devService'
import { useSession } from '@/stores/sessionStore'

export function HomePage() {
  const actor = useSession((s) => s.actor)
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const users = useUsers()

  useEffect(() => {
    void devService.listScenarios().then(setScenarios)
  }, [])

  const userName = (id: string) => users.find((u) => u.userId === id)?.fullName ?? id
  const screens = NAV_ITEMS.filter((i) => i.path !== '/')

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Welcome, {actor.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {ROLE_LABELS[actor.role]} · {actor.userId}
          {actor.merchantId ? ` · ${actor.merchantId}` : ''}
        </p>
      </header>

      <section className="rounded-lg border bg-card p-4 text-sm">
        <h2 className="mb-2 font-medium">About this mock</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Front-end only. All data is synthetic and lives in this browser; nothing is sent anywhere.</li>
          <li>The business rules are real code, so claims expire, ownership is re-checked on save, and every action is audited.</li>
          <li>
            Use the <strong className="text-foreground">Dev</strong> menu (top right) to switch user, skip time ahead, or reset demo data before a UAT run.
          </li>
          <li>Values marked OPEN QUESTION are placeholders, not signed-off requirements.</li>
        </ul>
      </section>

      <section aria-labelledby="scenarios-heading" className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 id="scenarios-heading" className="font-medium">
            UAT scenarios
          </h2>
          <p className="text-sm text-muted-foreground">Each row is a fixed record. “Open as” signs in as the suggested user first. Claim timers (S07–S09) count from when the data was seeded.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">ID</th>
                <th scope="col" className="px-4 py-2 font-medium">Scenario</th>
                <th scope="col" className="px-4 py-2 font-medium">Reference No</th>
                <th scope="col" className="px-4 py-2 font-medium">Expected at seed time</th>
                <th scope="col" className="px-4 py-2 font-medium">Open as</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{s.id}</td>
                  <td className="px-4 py-2">{s.title}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link to={`/verifications/${s.referenceNo}`} className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                      {s.referenceNo}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={s.expectedStatus} />
                  </td>
                  <td className="px-4 py-2">
                    <Link to={`/verifications/${s.referenceNo}?as=${s.asUserId}`} className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                      {userName(s.asUserId)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="status-heading" className="rounded-lg border bg-card p-4">
        <h2 id="status-heading" className="mb-3 font-medium">
          Build status
        </h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {screens.map((i) => (
            <li key={i.path} className="flex items-center gap-2">
              {i.built ? <CheckCircle2 className="size-4 text-green-600" aria-label="Built" /> : <CircleDashed className="size-4 text-muted-foreground" aria-label="Not built" />}
              <span>{i.label}</span>
              <span className="text-xs text-muted-foreground">{i.priority}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
