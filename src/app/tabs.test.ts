import { describe, expect, it } from 'vitest'
import { routeMetaFor } from './nav'
import { LANDING_TAB, MAX_TABS, closeTab, openTab, type Tab } from './tabs'

const t = (key: string, to = key): Tab => ({ key, to, title: key })

describe('openTab', () => {
  it('Given no tabs, then the landing tab (Overview) is always first', () => {
    expect(openTab([], t('/audit'))).toEqual([LANDING_TAB, t('/audit')])
  })

  it('Given the tab is already open, then it is updated in place (remembers the latest filters), not duplicated', () => {
    const tabs = [LANDING_TAB, t('/verifications'), t('/audit')]
    expect(openTab(tabs, t('/verifications', '/verifications?status=APPROVED'))).toEqual([LANDING_TAB, t('/verifications', '/verifications?status=APPROVED'), t('/audit')])
  })

  it('Given nothing changed, then the same array is returned (no re-render)', () => {
    const tabs = [LANDING_TAB, t('/audit')]
    expect(openTab(tabs, t('/audit'))).toBe(tabs)
  })

  it(`Given ${MAX_TABS} tabs, when one more opens, then the oldest page tab is dropped and the landing tab stays`, () => {
    let tabs = [LANDING_TAB]
    for (let i = 1; i < MAX_TABS; i++) tabs = openTab(tabs, t(`/p${i}`))
    expect(tabs).toHaveLength(MAX_TABS)
    tabs = openTab(tabs, t('/new'))
    expect(tabs).toHaveLength(MAX_TABS)
    expect(tabs[0]).toBe(LANDING_TAB)
    expect(tabs.map((x) => x.key)).not.toContain('/p1')
    expect(tabs.at(-1)!.key).toBe('/new')
  })
})

describe('closeTab', () => {
  const tabs = [LANDING_TAB, t('/a'), t('/b'), t('/c')]

  it('The landing tab cannot be closed', () => {
    expect(closeTab(tabs, LANDING_TAB.key, LANDING_TAB.key).tabs).toBe(tabs)
  })

  it('Given an inactive tab is closed, then no navigation', () => {
    expect(closeTab(tabs, '/b', '/c')).toEqual({ tabs: [LANDING_TAB, t('/a'), t('/c')] })
  })

  it('Given the active tab is closed, then navigate to its left neighbour', () => {
    expect(closeTab(tabs, '/b', '/b')).toEqual({ tabs: [LANDING_TAB, t('/a'), t('/c')], navigateTo: '/a' })
  })
})

describe('routeMetaFor', () => {
  it('matches a case URL by its case ID; the page renames the tab to the Reference ID once loaded (DEC-97)', () => {
    expect(routeMetaFor('/verifications/ver_abc')).toMatchObject({ title: 'Verification Detail', item: { label: 'Verification Detail' } })
  })

  it('matches menu pages and returns undefined for unknown paths', () => {
    expect(routeMetaFor('/audit')?.title).toBe('Audit Logs')
    expect(routeMetaFor('/manual-review-queue')).toBeUndefined()
  })
})
