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

export function ClientMetadataCard({ v }: { v: VerificationDetail }) {
  const m = v.clientMetadata
  return (
    <Section title="Client metadata">
      <Fields
        items={[
          ['SDK', m.sdk],
          ['OS', m.os],
          ['Device / browser', m.device],
          ['IP address', <span key="ip" className="font-mono">{m.ip}</span>],
          ['Location', m.geo],
        ]}
      />
    </Section>
  )
}
