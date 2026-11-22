// REQ: DEC-97 — internal IDs: a type prefix and a cuid2-shaped body (24 characters, lowercase letters and digits, starting
// with a letter), e.g. "prj_k3x9…". The real backend uses the cuid2 library; the mock makes the same shape itself.
// IDs are not time-ordered: lists sort by created time.

export const ID_PREFIXES = ['mer', 'prj', 'flw', 'rev', 'vrf', 'att', 'file', 'usr', 'rol', 'asg', 'inv', 'key', 'whk', 'wfv', 'evt'] as const
export type IdPrefix = (typeof ID_PREFIXES)[number]

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const CHARS = `${LETTERS}0123456789`
const BODY_LENGTH = 24

function body(next: () => number): string {
  let s = LETTERS[Math.floor(next() * LETTERS.length)]
  while (s.length < BODY_LENGTH) s += CHARS[Math.floor(next() * CHARS.length)]
  return s
}

/** A new random ID for a record created at run time. */
export function newId(prefix: IdPrefix): string {
  const bytes = new Uint32Array(BODY_LENGTH)
  crypto.getRandomValues(bytes)
  let i = 0
  return `${prefix}_${body(() => bytes[i++] / 2 ** 32)}`
}

// Small deterministic PRNG (sfc32) seeded from a string hash (cyrb128): the same handle always gives the same ID.
function seeded(text: string): () => number {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  let [a, b, c, d] = [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    const t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    const r = (t + d) | 0
    c = (c + r) | 0
    return (r >>> 0) / 4294967296
  }
}

/** A stable ID for a seeded record, from its readable fixture handle (MOCK-05). */
export function stableId(prefix: IdPrefix, handle: string): string {
  return `${prefix}_${body(seeded(`${prefix}:${handle}`))}`
}

const HANDLE_PREFIX: Record<string, IdPrefix> = { MER: 'mer', PRJ: 'prj', FLW: 'flw', USR: 'usr', ROL: 'rol', ASG: 'asg' }

/**
 * The internal ID of a seeded record named by its fixture handle: "PRJ-0001", "FLW-0004", "USR-2026-0012", "ROL-2026-0003".
 * Handles keep fixtures and tests readable; they are never stored or shown.
 */
export function fx(handle: string): string {
  const prefix = HANDLE_PREFIX[handle.split('-')[0]]
  if (!prefix) throw new Error(`Unknown fixture handle: ${handle}`)
  return stableId(prefix, handle)
}

/** The Verification ID of a seeded case, from its Reference ID (each seeded Reference ID belongs to one case). */
export const verificationIdOf = (referenceId: string) => stableId('vrf', referenceId)

/**
 * REQ: DEC-97 — a form may show the new record's ID before saving (Role ID, User ID). The service keeps that drafted ID
 * if it is well-formed and unused; otherwise it makes a new one, so an ID is never reused.
 */
export function adoptDraftId(prefix: IdPrefix, drafted: string | undefined, taken: (id: string) => boolean): string {
  return drafted && isId(prefix, drafted) && !taken(drafted) ? drafted : newId(prefix)
}

export const isId = (prefix: IdPrefix, value: string) => new RegExp(`^${prefix}_[a-z][a-z0-9]{${BODY_LENGTH - 1}}$`).test(value)
