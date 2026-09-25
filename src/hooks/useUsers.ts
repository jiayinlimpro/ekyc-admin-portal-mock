import { useEffect, useState } from 'react'
import type { Actor } from '@/domain/types'
import { devService } from '@/services/devService'

/** Fake users for the dev "Switch user" menu and name lookups. */
export function useUsers(): Actor[] {
  const [users, setUsers] = useState<Actor[]>([])
  useEffect(() => {
    void devService.listUsers().then(setUsers)
  }, [])
  return users
}
