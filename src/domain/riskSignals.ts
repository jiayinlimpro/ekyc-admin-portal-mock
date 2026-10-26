// REQ: DEC-105 — the risk engine's four categories, scored as the engine does: EXIF analysis (points), image noise analysis
// (ELA and wavelet peak values), email validity (base 50 ± points) and OSINT social presence (0–10). One score per
// category, with what made it up; no reason codes. How they combine into the overall risk score and level is OQ-25.
import type { EmailSignals, ExifSignals } from './types'

/** +1 point each when present. */
export const EXIF_STRONG_TAGS = ['Aperture', 'ApertureValue', 'BrightnessValue', 'ExposureCompensation', 'LightValue', 'ShutterSpeedValue', 'SubSecTimeOriginal', 'SubSecTimeDigitized', 'ISO'] as const
/** +0.5 point each when present. */
export const EXIF_MODERATE_TAGS = ['Make', 'Model', 'DateTimeOriginal', 'FileModifyDate', 'OffsetTimeOriginal'] as const

/** Makers still making camera smartphones (GSMArena list): +5. */
export const MODERN_PHONE_MAKERS: readonly string[] = [
  'alcatel', 'allview', 'amazon', 'apple', 'archos', 'asus', 'benq', 'blackberry', 'blackview', 'blu', 'bq', 'cat', 'celkon', 'coolpad', 'cubot', 'dell', 'doogee',
  'energizer', 'fairphone', 'gigabyte', 'google', 'hmd', 'haier', 'gionee', 'hp', 'htc', 'icemobile', 'infinix', 'intex', 'itel', 'jolla', 'karbonn', 'kyocera', 'lava',
  'leeco', 'lenovo', 'lg', 'maxwest', 'meizu', 'micromax', 'microsoft', 'motorola', 'nokia', 'niu', 'nothing', 'nvidia', 'oneplus', 'oppo', 'oscal', 'orange', 'oukitel',
  'palm', 'panasonic', 'pantech', 'philips', 'parla', 'plum', 'prestigio', 'posh', 'qmobile', 'razer', 'rugone', 'sharp', 'sonim', 'sony', 'tcl', 't-mobile', 'tecno',
  'thuraya', 'toshiba', 'ulefone', 'umidigi', 'unnecto', 'vertu', 'verykool', 'vivo', 'vodafone', 'wiko', 'xolo', 'yezz', 'yota', 'yu', 'zte',
]
/** Obsolete makers (number-pad or no-browser phones): −2. */
export const OBSOLETE_PHONE_MAKERS: readonly string[] = [
  'amoi', 'bosch', 'casio', 'at&t', 'benefon', 'bird', 'chea', 'emporia', 'ericsson', 'eten', 'garmin', 'i-mate', 'i-mobile', 'innostream', 'inq', 'maxon', 'mitac',
  'mitsubishi', 'modu', 'mwg', 'neonode', 'o2', 'qtek', 'sagem', 'sendo', 'sewon', 'siemens', 'spice', 'tel.me', 'telit', 'vk', 'wnd', 'xcute',
]

export const EXIF_POINTS = {
  strongTag: 1,
  moderateTag: 0.5,
  modernMaker: 5,
  obsoleteMaker: -2,
  megapixelsMin: 4,
  megapixelsOk: 2,
  megapixelsLow: -2,
  modifyWithinSec: 60,
  modifyOk: 2,
  modifyLate: -4,
  aiGenerator: 'ChatGPT',
  aiPenalty: -30,
} as const
export const EXIF_MAX = EXIF_STRONG_TAGS.length * EXIF_POINTS.strongTag + EXIF_MODERATE_TAGS.length * EXIF_POINTS.moderateTag + EXIF_POINTS.modernMaker + EXIF_POINTS.megapixelsOk + EXIF_POINTS.modifyOk

/** Fixed engine parameters (shown on the case page; no pass marks yet, OQ-25). */
export const NOISE_PARAMS = { ela: { quality: 89, scale: 151 }, wavelet: { lowerPerc: 92, upperPerc: 100, wavelet: 'sym4', level: 6 } } as const

export const EMAIL_POINTS = { base: 50, mx: 15, a: 15, disposable: -50, newDomain: -10, newDomainDays: 30, gibberish: -5, gibberishConsonants: 5 } as const
export const EMAIL_MAX = EMAIL_POINTS.base + EMAIL_POINTS.mx + EMAIL_POINTS.a

export const OSINT_MAX = 10

export interface ScoreLine {
  label: string
  value: string
  points: number
}
export interface CategoryScore {
  score: number
  lines: ScoreLine[]
}

const total = (lines: ScoreLine[], base = 0) => ({ score: Math.round((base + lines.reduce((s, l) => s + l.points, 0)) * 10) / 10, lines })

export function makerClass(make: string | undefined): 'MODERN' | 'OBSOLETE' | 'OTHER' | undefined {
  if (!make) return undefined
  const m = make.trim().toLowerCase()
  return MODERN_PHONE_MAKERS.includes(m) ? 'MODERN' : OBSOLETE_PHONE_MAKERS.includes(m) ? 'OBSOLETE' : 'OTHER'
}

// REQ: DEC-105 — EXIF analysis as specified; a missing megapixel value scores 0 and missing dates score as "differ" (OQ-33).
export function exifScore(e: ExifSignals): CategoryScore {
  const strong = EXIF_STRONG_TAGS.filter((t) => e.tagsPresent.includes(t)).length
  const moderate = EXIF_MODERATE_TAGS.filter((t) => e.tagsPresent.includes(t)).length
  const maker = makerClass(e.make)
  const p = EXIF_POINTS
  return total([
    { label: 'Strong tags', value: `${strong} of ${EXIF_STRONG_TAGS.length}`, points: strong * p.strongTag },
    { label: 'Moderate tags', value: `${moderate} of ${EXIF_MODERATE_TAGS.length}`, points: moderate * p.moderateTag },
    {
      label: 'Phone maker',
      value: !e.make ? 'Not recorded' : `${e.make} (${maker === 'MODERN' ? 'modern' : maker === 'OBSOLETE' ? 'obsolete' : 'not on either list'})`,
      points: maker === 'MODERN' ? p.modernMaker : maker === 'OBSOLETE' ? p.obsoleteMaker : 0,
    },
    {
      label: 'Megapixels',
      value: e.megapixels === undefined ? 'Not recorded' : e.megapixels.toFixed(1),
      points: e.megapixels === undefined ? 0 : e.megapixels >= p.megapixelsMin ? p.megapixelsOk : p.megapixelsLow,
    },
    {
      label: 'Taken vs modified',
      value: e.modifyDiffSec === undefined ? 'Not recorded' : `${e.modifyDiffSec.toLocaleString('en-MY')} s apart`,
      points: e.modifyDiffSec !== undefined && e.modifyDiffSec < p.modifyWithinSec ? p.modifyOk : p.modifyLate,
    },
    { label: 'AI generator watermark', value: e.claimGenerator ?? 'None', points: e.claimGenerator === p.aiGenerator ? p.aiPenalty : 0 },
  ])
}

/** Five consonants in a row in the part before "@". */
export const isGibberish = (email: string) => new RegExp(`[bcdfghjklmnpqrstvwxyz]{${EMAIL_POINTS.gibberishConsonants}}`, 'i').test(email.split('@')[0])

// REQ: DEC-105 — email validity as specified: base 50, MX +15, A +15, disposable −50, new domain (< 30 days) −10, gibberish −5.
export function emailScore(email: string, s: EmailSignals): CategoryScore {
  const p = EMAIL_POINTS
  const yes = (b: boolean) => (b ? 'Yes' : 'No')
  const newDomain = s.domainAgeDays !== undefined && s.domainAgeDays < p.newDomainDays
  return total(
    [
      { label: 'MX record', value: yes(s.mxRecord), points: s.mxRecord ? p.mx : 0 },
      { label: 'A record', value: yes(s.aRecord), points: s.aRecord ? p.a : 0 },
      { label: 'Disposable domain', value: yes(s.disposable), points: s.disposable ? p.disposable : 0 },
      { label: `New domain (< ${p.newDomainDays} days)`, value: s.domainAgeDays === undefined ? 'Unknown' : `${yes(newDomain)} (${s.domainAgeDays.toLocaleString('en-MY')} days)`, points: newDomain ? p.newDomain : 0 },
      { label: 'Gibberish username', value: yes(isGibberish(email)), points: isGibberish(email) ? p.gibberish : 0 },
    ],
    p.base,
  )
}
