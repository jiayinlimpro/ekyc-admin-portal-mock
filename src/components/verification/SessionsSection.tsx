// REQ: DEC-113 — the case's sessions: a returning Reference ID continued it after a Rejected or Unsuccessful session.
import { StatusBadge } from '@/components/common/StatusBadge'
import { formatUpdatedBy } from '@/domain/audit'
import type { VerificationDetail } from '@/domain/types'
import { formatMyt } from '@/lib/format'
import { OUTCOME_LABELS } from '@/lib/labels'
import { Section } from './Section'

const n1 = (x?: number) => (x === undefined ? '—' : x.toFixed(1))

/** Shown only when the case has more than one session; the current session's details are in the sections above. */
export function SessionsSection({ v }: { v: VerificationDetail }) {
  if (v.sessionRows.length < 2) return null
  return (
    <Section title="Sessions" aside={<span className="text-xs text-muted-foreground">Same Reference ID, same case</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Sessions">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Session</th>
              <th className="py-1.5 pr-3 font-medium">Started (MYT)</th>
              <th className="py-1.5 pr-3 font-medium">Flow · rules applied</th>
              <th className="py-1.5 pr-3 font-medium">Result</th>
              <th className="py-1.5 pr-3 font-medium">Reason</th>
              <th className="py-1.5 pr-3 font-medium">Last updated by</th>
              <th className="py-1.5 text-right font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {v.sessionRows.map((s) => (
              <tr key={s.sessionNo} className="border-b align-top last:border-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal whitespace-nowrap">
                  Session {s.sessionNo}
                  {!s.ended && <span className="block text-xs text-muted-foreground">Current</span>}
                </th>
                <td className="py-1.5 pr-3 whitespace-nowrap">{formatMyt(s.startedAt)}</td>
                <td className="py-1.5 pr-3">
                  {s.flowName} <span className="font-mono text-xs text-muted-foreground">{s.revisionLabel}</span>
                </td>
                <td className="py-1.5 pr-3">
                  <StatusBadge status={s.ended?.status ?? v.status} />
                  {s.ended && <span className="block text-xs text-muted-foreground">{formatMyt(s.ended.at)}</span>}
                </td>
                <td className="py-1.5 pr-3">
                  {s.ended ? (
                    <>
                      {s.ended.reason ?? '—'}
                      {/* The ended session's attempts stay in the case's history. */}
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">{s.ended.attempts.length} attempt(s)</summary>
                        <ul className="mt-1 space-y-0.5">
                          {s.ended.attempts.map((a) => (
                            <li key={a.attemptId}>
                              Attempt {a.attemptNo} · {formatMyt(a.startedAt)} · {OUTCOME_LABELS[a.outcome]}
                              {a.phaseScores.FACE_MATCH !== undefined && ` · Face match ${n1(a.phaseScores.FACE_MATCH)}`}
                              {a.phaseScores.LIVENESS !== undefined && ` · Liveness ${n1(a.phaseScores.LIVENESS)}`}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{v.statusReason ?? 'See Checks and Attempts'}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">{formatUpdatedBy(s.ended?.by ?? v.lastUpdatedBy)}</td>
                <td className="py-1.5 text-right tabular-nums">{s.tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
