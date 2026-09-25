import { useEffect, useState } from 'react'
import type { UserRecord } from '@/domain/types'
import { devService } from '@/services/devService'

/** Fake users for the dev "Switch user" menu and name lookups. */
export function useUsers(): UserRecord[] {
  const [users, setUsers] = useState<UserRecord[]>([])
  useEffect(() => {
    void devService.listUsers().then(setUsers)
  }, [])
  return users
}
