import { Eye } from 'lucide-react'
import type { VerificationDetail } from '@/domain/types'
import { formatDate } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { Fields, Section } from './Section'

// REQ: DEC-41 — full unmasked PII on the detail page only; opening it wrote a SENSITIVE_PII_VIEW audit entry.
export function PiiSection({ v }: { v: VerificationDetail }) {
  const p = v.pii
  const passport = v.documentType === 'PASSPORT'
  const fields: [string, React.ReactNode][] = passport
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
      title={`Identity document · ${DOCUMENT_TYPE_LABELS[v.documentType]} (OCR)`}
      aside={
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Eye className="size-3.5" aria-hidden />
          Unmasked · your view is logged
        </span>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid grid-cols-2 gap-3">
          <figure>
            <img src={v.images.docFront} alt={`${DOCUMENT_TYPE_LABELS[v.documentType]} front (sample image, not real)`} className="w-full rounded-md border" />
            <figcaption className="mt-1 text-xs text-muted-foreground">Document front</figcaption>
          </figure>
          <figure>
            <img src={v.images.selfie} alt="Selfie (sample image, not real)" className="w-full rounded-md border" />
            <figcaption className="mt-1 text-xs text-muted-foreground">Selfie</figcaption>
          </figure>
        </div>
        <Fields items={fields} />
      </div>
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
