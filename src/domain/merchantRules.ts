// Merchant profile and status rules (DEC-98, [FRS] Merchant Management). Pure: the services apply them.
import type { Merchant, MerchantStatus, RuleError } from './types'

// REQ: DEC-98 — allowed status changes. Terminated is final; merchants are never deleted.
export const MERCHANT_TRANSITIONS: Record<MerchantStatus, readonly MerchantStatus[]> = {
  ONBOARDING: ['ACTIVE', 'TERMINATED'], // go live, or drop the deal
  ACTIVE: ['SUSPENDED', 'TERMINATED'], // freeze, or close the account
  SUSPENDED: ['ACTIVE', 'TERMINATED'], // lift the freeze, or close the account
  TERMINATED: [],
}

/** Users may sign in while the merchant is Onboarding (sandbox) or Active; Suspended and Terminated block them (DEC-98). */
export const merchantAllowsSignIn = (status: MerchantStatus) => status === 'ONBOARDING' || status === 'ACTIVE'

/** What the merchant's API keys can do now (DEC-98): live calls only when Active. */
export function apiAccess(status: MerchantStatus): 'LIVE' | 'SANDBOX_ONLY' | 'STOPPED' {
  if (status === 'ACTIVE') return 'LIVE'
  return status === 'ONBOARDING' ? 'SANDBOX_ONLY' : 'STOPPED'
}

export function statusChangeErrors(from: MerchantStatus, to: MerchantStatus, reason: string): RuleError[] {
  if (from === to) return [{ field: 'status', message: 'The merchant already has this status.' }]
  if (!MERCHANT_TRANSITIONS[from].includes(to)) return [{ field: 'status', message: `A ${from.toLowerCase()} merchant can’t be set to ${to.toLowerCase()}.` }]
  if (reason.trim().length < 10) return [{ field: 'reason', message: 'Give a reason for the change (at least 10 characters).' }]
  return []
}

export interface MerchantProfileInput {
  name: string
  registrationNo: string
  country: string
  contactName: string
  contactEmail: string
  contactPhone: string
}

const NAME = /^[\p{L}\p{N} &.,'()\-/@+]+$/u
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// REQ: DEC-98 — SSM format since 11 Oct 2019: 4-digit year, 2-digit entity type, 6-digit running number.
const SSM = /^\d{4}0[1-6]\d{6}$/

/** Registration numbers are compared without spaces or dashes; Malaysian ones are digits only. */
export function normalizeRegistrationNo(country: string, raw: string): string {
  const s = raw.trim().toUpperCase()
  return country === 'MY' ? s.replace(/[\s-]/g, '') : s.replace(/\s+/g, ' ')
}

export const nameError = (name: string): string | undefined => {
  const n = name.trim()
  if (!n) return 'Company name cannot be empty'
  if (!NAME.test(n)) return 'Invalid characters detected'
  return undefined
}

export const phoneError = (phone: string): string | undefined => {
  const p = phone.trim()
  if (!p) return undefined
  const digits = p.replace(/\D/g, '').length
  return /^\+?[\d\s()-]+$/.test(p) && digits >= 7 && digits <= 15 ? undefined : 'Phone number format is invalid'
}

/**
 * REQ: DEC-98 — the FRS "Create" field rules. `others`: existing merchants; `emailInUse`: whether the contact email already
 * belongs to a user (it becomes the first Merchant Owner).
 */
export function validateMerchantProfile(input: MerchantProfileInput, others: readonly Pick<Merchant, 'registrationNo' | 'country'>[], emailInUse: boolean, isCountry: (code: string) => boolean): RuleError[] {
  const errors: RuleError[] = []
  const name = nameError(input.name)
  if (name) errors.push({ field: 'name', message: name })
  if (!input.country || !isCountry(input.country)) errors.push({ field: 'country', message: 'Please select a valid base jurisdiction' })
  const reg = normalizeRegistrationNo(input.country, input.registrationNo)
  if (!reg) errors.push({ field: 'registrationNo', message: 'Business registration number is required' })
  else if (input.country === 'MY' && !SSM.test(reg)) errors.push({ field: 'registrationNo', message: 'Malaysian registration numbers have 12 digits, e.g. 201901000005' })
  else if (others.some((m) => m.country === input.country && normalizeRegistrationNo(m.country, m.registrationNo) === reg)) errors.push({ field: 'registrationNo', message: 'Registration number already exists' })
  if (input.contactName.trim().length < 3) errors.push({ field: 'contactName', message: 'Full name must be at least 3 characters' })
  if (!EMAIL.test(input.contactEmail.trim())) errors.push({ field: 'contactEmail', message: 'Email format is incorrect' })
  else if (emailInUse) errors.push({ field: 'contactEmail', message: 'Email address already active in system user directories' })
  const phone = phoneError(input.contactPhone)
  if (phone) errors.push({ field: 'contactPhone', message: phone })
  return errors
}
