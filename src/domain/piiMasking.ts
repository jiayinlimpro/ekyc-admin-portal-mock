// REQ: DEC-99 — the masked case view for platform staff without "See unmasked ID data". Pure: the service applies it.
// Kept: full name, gender, nationality, document type, statuses and scores. Masked: ID numbers (last 4), date of birth
// (year), address, email, client IP. Hidden: the images.
import type { VerificationDetail } from './types'

const DOT = '•'
const keepLast = (s: string | undefined, n: number) => (s ? `${s.slice(0, -n).replace(/[A-Za-z0-9]/g, DOT)}${s.slice(-n)}` : s)

export function maskEmail(email: string | undefined): string | undefined {
  if (!email) return email
  const [user, domain] = email.split('@')
  return `${user.slice(0, 1)}${DOT.repeat(3)}@${domain ?? ''}`
}

export function maskIp(ip: string): string {
  const parts = ip.split('.')
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${DOT.repeat(3)}.${DOT.repeat(3)}` : DOT.repeat(6)
}

export function maskDetail(v: VerificationDetail): VerificationDetail {
  const p = v.pii
  return {
    ...v,
    masked: true,
    pii: {
      ...p,
      nric: keepLast(p.nric, 4),
      passportNo: keepLast(p.passportNo, 3),
      dob: `${p.dob.slice(0, 4)}-${DOT}${DOT}-${DOT}${DOT}`,
      address: `${DOT.repeat(4)} (hidden)`,
      email: maskEmail(p.email),
      religion: p.religion && DOT.repeat(4),
      licenceValidUntil: p.licenceValidUntil && `${p.licenceValidUntil.slice(0, 4)}-${DOT}${DOT}-${DOT}${DOT}`,
    },
    clientMetadata: { ...v.clientMetadata, ip: maskIp(v.clientMetadata.ip), geo: v.clientMetadata.geo && DOT.repeat(4) },
    images: { docFront: { ...v.images.docFront, url: '' }, selfie: { ...v.images.selfie, url: '' } },
  }
}
