import { useQuery } from '@tanstack/react-query'
import { api } from './api/client'

/**
 * Resolves a server id to its display name. Catalog listings span all
 * servers and carry only the id, the same way instance rows do.
 */
export function useServerNames() {
  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  return (id: string) => servers.find((s) => s.id === id)?.name ?? '—'
}
