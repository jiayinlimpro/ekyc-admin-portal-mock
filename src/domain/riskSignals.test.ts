import { describe, expect, it } from 'vitest'
import { EMAIL_MAX, emailScore, EXIF_MAX, exifScore, isGibberish, makerClass } from './riskSignals'
import type { EmailSignals, ExifSignals } from './types'

const ALL_TAGS = ['Aperture', 'ApertureValue', 'BrightnessValue', 'ExposureCompensation', 'LightValue', 'ShutterSpeedValue', 'SubSecTimeOriginal', 'SubSecTimeDigitized', 'ISO', 'Make', 'Model', 'DateTimeOriginal', 'FileModifyDate', 'OffsetTimeOriginal']
const GENUINE: ExifSignals = { tagsPresent: ALL_TAGS, make: 'Apple', megapixels: 12, modifyDiffSec: 3 }
const points = (e: ExifSignals) => Object.fromEntries(exifScore(e).lines.map((l) => [l.label, l.points]))

describe('EXIF analysis (DEC-105)', () => {
  it('Given every tag, a modern maker, ≥ 4 MP and dates under 60 s apart, then the maximum 20.5', () => {
    expect(EXIF_MAX).toBe(20.5)
    expect(exifScore(GENUINE).score).toBe(20.5)
    expect(points(GENUINE)).toEqual({ 'Strong tags': 9, 'Moderate tags': 2.5, 'Phone maker': 5, Megapixels: 2, 'Taken vs modified': 2, 'AI generator watermark': 0 })
  })

  it('Given an obsolete maker, < 4 MP, dates 60 s or more apart and a ChatGPT watermark, then −2, −2, −4 and −30', () => {
    const p = points({ ...GENUINE, make: 'Siemens', megapixels: 3.9, modifyDiffSec: 60, claimGenerator: 'ChatGPT' })
    expect([p['Phone maker'], p.Megapixels, p['Taken vs modified'], p['AI generator watermark']]).toEqual([-2, -2, -4, -30])
  })

  it('Given no metadata, then tags score 0, a missing date counts as "differ" (−4) and missing megapixels 0 (OQ-33)', () => {
    expect(exifScore({ tagsPresent: [] }).score).toBe(-4)
  })

  it('Given a maker on neither list (e.g. Samsung, Xiaomi), then 0 points; the lists match ignoring case', () => {
    expect([makerClass('samsung'), makerClass('Xiaomi'), makerClass('OPPO'), makerClass('AT&T'), makerClass(undefined)]).toEqual(['OTHER', 'OTHER', 'MODERN', 'OBSOLETE', undefined])
  })
})

describe('Email validity (DEC-105)', () => {
  const OK: EmailSignals = { mxRecord: true, aRecord: true, disposable: false, domainAgeDays: 900 }
  it('Given MX and A records on an old, non-disposable domain, then 50 + 15 + 15 = 80', () => {
    expect(EMAIL_MAX).toBe(80)
    expect(emailScore('aisyah.rahman@mail.example', OK).score).toBe(80)
  })

  it('Given a disposable domain under 30 days old and a gibberish username, then −50, −10 and −5', () => {
    expect(emailScore('xkcdqwrt@temp.example', { ...OK, disposable: true, domainAgeDays: 29 }).score).toBe(15)
    expect(emailScore('a@x.example', { mxRecord: false, aRecord: false, disposable: true, domainAgeDays: 1 }).score).toBe(-10)
  })

  it('Given five consonants in a row before "@", then gibberish; four, or consonants only after "@", then not', () => {
    expect(isGibberish('jsmthk@mail.example')).toBe(true)
    expect(isGibberish('lim.wkdt@mail.example')).toBe(false)
    expect(isGibberish('ali@bcdfgh.example')).toBe(false)
  })
})
