// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { devService } from '@/services/devService'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, SITI } from '@/test/factories'

beforeEach(async () => {
  await devService.resetDemoData()
  useSession.getState().switchUser(ADMIN)
})
afterEach(cleanup)

describe('Login (mock)', () => {
  it('Given I pick Siti, then I am signed in as her and land on Overview (no Home page)', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/login'] })
    render(<RouterProvider router={router} />)
    fireEvent.click(await screen.findByRole('button', { name: /Siti Aminah Binti Yusof/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(useSession.getState().actor.userId).toBe(SITI.userId)
  })

  it('Given the login page, then users are grouped as Super admin and then by merchant, each with their access', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/login'] })
    render(<RouterProvider router={router} />)
    for (const group of ['Super admin', 'Atoz Software Tech', 'Vantage']) expect(await screen.findByRole('region', { name: group })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Atoz Software Tech' }).textContent).toContain('Reviewer · Default; Viewer · SME app')
  })
})
