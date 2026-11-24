import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useUsers } from '@/hooks/useUsers'
import { devService, type ScenarioSummary } from '@/services/devService'

/** Mock-only page, opened from the Dev menu: UAT scenario links and data coverage. Not part of the real portal. */
export function UatPage() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [coverage, setCoverage] = useState<Awaited<ReturnType<typeof devService.coverage>>>()
  const users = useUsers()

  useEffect(() => {
    void devService.listScenarios().then(setScenarios)
    void devService.coverage().then(setCoverage)
  }, [])

  const userName = (id: string) => users.find((u) => u.userId === id)?.fullName ?? id
  const userEmail = (id: string) => users.find((u) => u.userId === id)?.email ?? id

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">UAT scenarios</h1>
        <p className="text-sm text-muted-foreground">Mock only. Not part of the real portal.</p>
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
                <th scope="col" className="px-4 py-2 font-medium">Verification ID</th>
                <th scope="col" className="px-4 py-2 font-medium">Expected at seed time</th>
                <th scope="col" className="px-4 py-2 font-medium">Open as</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{s.id}</td>
                  <td className="px-4 py-2">{s.title}</td>
                  {/* REQ: DEC-114 — Verification ID first (opens the case), the Reference ID under it. */}
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link to={`/verifications/${s.verificationId}`} className="whitespace-nowrap text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                      {s.verificationId}
                    </Link>
                    <div className="whitespace-nowrap text-muted-foreground">{s.referenceId}</div>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={s.expectedStatus} />
                  </td>
                  <td className="px-4 py-2">
                    <Link to={`/verifications/${s.verificationId}?as=${userEmail(s.asUserId)}`} className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                      {userName(s.asUserId)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {coverage && (
        <section aria-labelledby="coverage-heading" className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 id="coverage-heading" className="font-medium">
              Data coverage
            </h2>
            <p className="text-sm text-muted-foreground">{coverage.total} records across all merchants and flows. Every status appears for W1, W3 and W4, with manual and system decisions.</p>
          </div>
          <div className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {['Status', 'W1', 'W3', 'W4', 'Claimed now', 'Last updated by SYSTEM', 'Last updated by a reviewer'].map((h, i) => (
                    <th key={h} scope="col" className={i ? 'py-1.5 pr-4 text-right font-medium' : 'py-1.5 pr-4 font-medium'}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverage.rows.map((r) => (
                  <tr key={r.status} className="border-t">
                    <td className="py-1.5 pr-4">
                      <StatusBadge status={r.status} />
                    </td>
                    {[r.byVersion.W1 ?? 0, r.byVersion.W3 ?? 0, r.byVersion.W4 ?? 0, r.claimed, r.system, r.manual].map((n, i) => (
                      <td key={i} className="py-1.5 pr-4 text-right tabular-nums">
                        {n}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
