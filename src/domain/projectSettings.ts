// Project Settings rules (DEC-53, DEC-54). Pure: no React, no stores.
import type { Project, RuleError, SettingChange } from './types'

export const LANGUAGES = { en: 'English', ms: 'Bahasa Melayu' } as const
export type Language = keyof typeof LANGUAGES

/** A new project inherits branding and language from the merchant (blank). */
export const PROJECT_SETTING_DEFAULTS: Pick<Project, 'branding' | 'language' | 'decisionReasons'> = {
  branding: {},
  language: undefined,
  decisionReasons: { disabledSystemCodes: [], custom: [] }, // REQ: DEC-106 — every System Default reason on
}

export type GeneralSettings = Pick<Project, 'branding' | 'language'>

const HEX = /^#[0-9a-f]{6}$/i

const httpsUrl = (s: string) => {
  try {
    return new URL(s).protocol === 'https:'
  } catch {
    return false
  }
}

export function validateGeneral(g: GeneralSettings): RuleError[] {
  const errors: RuleError[] = []
  if (g.branding.primaryColor && !HEX.test(g.branding.primaryColor)) errors.push({ field: 'primaryColor', message: 'Use a hex colour, e.g. #1D4ED8' })
  if (g.branding.logoUrl && !httpsUrl(g.branding.logoUrl)) errors.push({ field: 'logoUrl', message: 'Logo URL must start with https://' })
  if (g.language && !(g.language in LANGUAGES)) errors.push({ field: 'language', message: 'Unknown language' })
  return errors
}

// REQ: DEC-53 — the API takes seconds, at least 60; the screen sends whole minutes × 60.
export function claimTimeoutError(sec: number): string | undefined {
  return Number.isInteger(sec) && sec >= 60 ? undefined : 'Claim timeout must be at least 1 minute (60 seconds), in whole seconds.'
}

/** The screen's minutes field: a whole number of minutes, at least 1; returns the seconds to send, or the message. */
export function claimTimeoutFromMinutes(input: string): { sec: number } | { error: string } {
  const min = Number(input)
  if (!input.trim() || !Number.isInteger(min) || min < 1) return { error: 'Enter a whole number of minutes, at least 1.' }
  return { sec: min * 60 }
}

// REQ: DEC-55 / DEC-117 — a flow's webhook is HTTPS.
export function webhookUrlError(url: string): string | undefined {
  return httpsUrl(url) ? undefined : 'Webhook URL must start with https://'
}

/** Old and new values for PROJECT_SETTING_CHANGED (DEC-42, DEC-54). */
export function diffSettings(before: Partial<Project>, after: Partial<Project>): SettingChange[] {
  const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') || '—' : v === undefined || v === '' ? '—' : String(v))
  const out: SettingChange[] = []
  const push = (field: string, a: unknown, b: unknown) => show(a) !== show(b) && out.push({ field, from: show(a), to: show(b) })
  if ('branding' in after) {
    push('Primary colour', before.branding?.primaryColor, after.branding?.primaryColor)
    push('Logo URL', before.branding?.logoUrl, after.branding?.logoUrl)
  }
  if ('language' in after) push('Language', before.language && LANGUAGES[before.language], after.language && LANGUAGES[after.language])
  if ('claimTimeoutSec' in after) push('Claim timeout (seconds)', before.claimTimeoutSec, after.claimTimeoutSec)
  return out
}
