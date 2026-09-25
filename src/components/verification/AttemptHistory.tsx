import { CAPTURE_PHASES, PHASE_LABELS, type VerificationDetail } from '@/domain/types'
import { formatMyt } from '@/lib/format'
import { OUTCOME_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Section } from './Section'

// REQ: DEC-17 / DEC-18 — retries keep the same Reference No; user retakes are flagged (Retry KPI counts only these).
export function AttemptHistory({ v }: { v: VerificationDetail }) {
  const retakes = v.attempts.filter((a) => a.isUserRetake).length
  return (
    <Section title="Attempt history" aside={<span className="text-xs text-muted-foreground">{v.attempts.length} attempt(s) · {retakes} user retake(s) · same Reference No</span>}>
      <div className="-m-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">#</th>
              <th scope="col" className="px-4 py-2 font-medium">Started (MYT)</th>
              <th scope="col" className="px-4 py-2 font-medium">Stopped at phase</th>
              <th scope="col" className="px-4 py-2 font-medium">Outcome</th>
              <th scope="col" className="px-4 py-2 font-medium">User retake</th>
              {CAPTURE_PHASES.map((p) => (
                <th key={p} scope="col" className="px-4 py-2 text-right font-medium whitespace-nowrap">
                  {PHASE_LABELS[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.attempts.map((a) => (
              <tr key={a.attemptNo} className="border-t">
                <td className="px-4 py-2">{a.attemptNo}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatMyt(a.startedAt)}</td>
                <td className="px-4 py-2">{PHASE_LABELS[a.phase]}</td>
                <td className={cn('px-4 py-2 whitespace-nowrap', a.outcome !== 'COMPLETED' && 'text-amber-700 dark:text-amber-300')}>{OUTCOME_LABELS[a.outcome]}</td>
                <td className="px-4 py-2">{a.isUserRetake ? 'Yes' : 'No'}</td>
                {CAPTURE_PHASES.map((p) => (
                  <td key={p} className="px-4 py-2 text-right tabular-nums">
                    {a.phaseScores[p] ?? <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
