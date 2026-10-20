import { useEffect, useState } from 'react'
import { devService, type DevUser } from '@/services/devService'

/** Fake users for the dev "Switch user" menu and name lookups. */
export function useUsers(): DevUser[] {
  const [users, setUsers] = useState<DevUser[]>([])
  useEffect(() => {
    void devService.listUsers().then(setUsers)
  }, [])
  return users
}
