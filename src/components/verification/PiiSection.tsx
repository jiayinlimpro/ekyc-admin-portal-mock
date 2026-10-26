import { Eye } from 'lucide-react'
import type { VerificationDetail } from '@/domain/types'
import { formatDate } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { Fields, Section } from './Section'

// REQ: DEC-41 / DEC-105 — extracted data: full unmasked PII on the detail page only; opening it wrote a
// SENSITIVE_PII_VIEW audit entry. The images are in Evidence and Attempts.
export function PiiSection({ v }: { v: VerificationDetail }) {
  const p = v.pii
  const passport = v.documentType === 'PASSPORT'
  const licence = v.documentType === 'DRIVING_LICENSE'
  const fields: [string, React.ReactNode][] = licence
    ? [
        ['Full Name', p.fullName],
        ['IC', <span key="ic" className="font-mono">{p.nric}</span>],
        ['Licence class', p.licenceClass],
        ['Valid until', p.licenceValidUntil && formatDate(p.licenceValidUntil)],
        ['Nationality', p.nationality],
        ['Address', p.address],
      ]
    : passport
    ? [
        ['Full Name', p.fullName],
        ['Passport No', <span key="passport" className="font-mono">{p.passportNo}</span>],
        ['Nationality', p.nationality],
        ['Gender', p.gender],
        ['Date of Birth', formatDate(p.dob)],
        ['Address (MY)', p.address],
      ]
    : [
        ['Full Name', p.fullName],
        ['NRIC', <span key="nric" className="font-mono">{p.nric}</span>],
        ['Gender', p.gender],
        ['Date of Birth', formatDate(p.dob)],
        ['Nationality', p.nationality],
        ['Religion', p.religion],
        ['Address', p.address],
      ]
  return (
    <Section
      title={`Extracted data · ${DOCUMENT_TYPE_LABELS[v.documentType]}`}
      id="sec-extracted-data"
      aside={
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Eye className="size-3.5" aria-hidden />
          Your view is logged
        </span>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">Read from the document (OCR){p.email ? '; email entered by the user' : ''}</p>
      <Fields items={p.email ? [...fields, ['Email', p.email]] : fields} />
    </Section>
  )
}

/** REQ: DEC-41 / DEC-105 — the device and network the session came from, compact, at the top right of the case page. */
export function ClientMetadataCard({ v }: { v: VerificationDetail }) {
  const m = v.clientMetadata
  const items: [string, React.ReactNode][] = [
    ['SDK', m.sdk],
    ['OS', m.os],
    ['Device', m.device],
    ['IP address', <span key="ip" className="font-mono">{m.ip}</span>],
    ['Location', m.geo],
  ]
  return (
    <section aria-labelledby="sec-client-metadata" className="w-full shrink-0 rounded-lg border bg-card px-3 py-2 sm:w-auto sm:min-w-[22rem]">
      <h2 id="sec-client-metadata" className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Client metadata
      </h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate" title={typeof value === 'string' ? value : undefined}>
              {value ?? <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
