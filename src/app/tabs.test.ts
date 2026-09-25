import { describe, expect, it } from 'vitest'
import { routeMetaFor } from './nav'
import { HOME_TAB, MAX_TABS, closeTab, openTab, type Tab } from './tabs'

const t = (key: string, to = key): Tab => ({ key, to, title: key })

describe('openTab', () => {
  it('Given no tabs, then Home is always first', () => {
    expect(openTab([], t('/audit'))).toEqual([HOME_TAB, t('/audit')])
  })

  it('Given the tab is already open, then it is updated in place (remembers the latest filters), not duplicated', () => {
    const tabs = [HOME_TAB, t('/verifications'), t('/audit')]
    expect(openTab(tabs, t('/verifications', '/verifications?status=APPROVED'))).toEqual([HOME_TAB, t('/verifications', '/verifications?status=APPROVED'), t('/audit')])
  })

  it('Given nothing changed, then the same array is returned (no re-render)', () => {
    const tabs = [HOME_TAB, t('/audit')]
    expect(openTab(tabs, t('/audit'))).toBe(tabs)
  })

  it(`Given ${MAX_TABS} tabs, when one more opens, then the oldest page tab is dropped and Home stays`, () => {
    let tabs = [HOME_TAB]
    for (let i = 1; i < MAX_TABS; i++) tabs = openTab(tabs, t(`/p${i}`))
    expect(tabs).toHaveLength(MAX_TABS)
    tabs = openTab(tabs, t('/new'))
    expect(tabs).toHaveLength(MAX_TABS)
    expect(tabs[0]).toBe(HOME_TAB)
    expect(tabs.map((x) => x.key)).not.toContain('/p1')
    expect(tabs.at(-1)!.key).toBe('/new')
  })
})

describe('closeTab', () => {
  const tabs = [HOME_TAB, t('/a'), t('/b'), t('/c')]

  it('Home cannot be closed', () => {
    expect(closeTab(tabs, '/', '/').tabs).toBe(tabs)
  })

  it('Given an inactive tab is closed, then no navigation', () => {
    expect(closeTab(tabs, '/b', '/c')).toEqual({ tabs: [HOME_TAB, t('/a'), t('/c')] })
  })

  it('Given the active tab is closed, then navigate to its left neighbour', () => {
    expect(closeTab(tabs, '/b', '/b')).toEqual({ tabs: [HOME_TAB, t('/a'), t('/c')], navigateTo: '/a' })
  })
})

describe('routeMetaFor', () => {
  it('uses the Reference No as the detail tab title', () => {
    expect(routeMetaFor('/verifications/KYC-260901-900003')).toMatchObject({ title: 'KYC-260901-900003', item: { label: 'Verification Detail' } })
  })

  it('matches menu pages and returns undefined for unknown paths', () => {
    expect(routeMetaFor('/audit')?.title).toBe('Audit Logs')
    expect(routeMetaFor('/manual-review-queue')).toBeUndefined()
  })
})
