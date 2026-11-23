// Chart colour tokens (dataviz reference palette). Hex values per theme; charts never pick raw colours themselves.
import { useUi } from '@/stores/uiStore'
import type { VerificationStatus } from '@/domain/types'

export interface VizTokens {
  surface: string
  grid: string
  axis: string
  muted: string
  textSecondary: string
  series1: string
  hover: string
  /** Reserved status colours — only for statuses, always with icon + label. */
  status: Record<VerificationStatus, string>
}

const LIGHT: VizTokens = {
  surface: '#ffffff',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  textSecondary: '#52514e',
  series1: '#2a78d6',
  hover: 'rgba(11,11,11,0.05)',
  status: { APPROVED: '#0ca30c', PENDING_REVIEW: '#fab219', REJECTED: '#d03b3b', PROCESSING: '#898781', UNSUCCESSFUL: '#ec835a' }, // UNSUCCESSFUL = status "serious"
}

const DARK: VizTokens = {
  surface: '#171717',
  grid: '#2c2c2a',
  axis: '#383835',
  muted: '#898781',
  textSecondary: '#c3c2b7',
  series1: '#3987e5',
  hover: 'rgba(255,255,255,0.06)',
  status: { APPROVED: '#0ca30c', PENDING_REVIEW: '#fab219', REJECTED: '#d03b3b', PROCESSING: '#898781', UNSUCCESSFUL: '#ec835a' }, // UNSUCCESSFUL = status "serious"
}

/**
 * Stack / legend order for statuses. Validated (dataviz validate_palette.js, both modes): adjacent CVD ΔE ≥ 9.1,
 * normal-vision ≥ 15.7 (Rejected ↔ Unsuccessful). Approved (green) and Rejected (red) must never be adjacent — they collapse
 * under deuteranopia; Unsuccessful (orange) must not sit next to Approved or Pending Review (CVD 5.6, normal 13.6). REQ: DEC-112
 */
export const STATUS_STACK: readonly VerificationStatus[] = ['APPROVED', 'PENDING_REVIEW', 'PROCESSING', 'REJECTED', 'UNSUCCESSFUL']

export function useVizTokens(): VizTokens {
  return useUi((s) => s.theme) === 'dark' ? DARK : LIGHT
}
