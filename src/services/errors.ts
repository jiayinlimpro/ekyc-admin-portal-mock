import type { ClaimErrorCode } from '@/domain/claimRules'

export type ServiceErrorCode = ClaimErrorCode | 'NOT_FOUND' | 'SIMULATED'

/** HTTP status the real API is expected to return for each error (draft contract for engineering). */
export const HTTP_STATUS: Record<ServiceErrorCode, number> = {
  VALIDATION: 422,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_CLAIMABLE: 409,
  ALREADY_CLAIMED: 409,
  NOT_CLAIM_OWNER: 409,
  OWNERSHIP_CONFLICT: 409,
  SIMULATED: 503,
}

export class ServiceError extends Error {
  readonly code: ServiceErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ServiceErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    this.status = HTTP_STATUS[code]
    this.details = details
  }
}

export const isServiceError = (e: unknown): e is ServiceError => e instanceof ServiceError
