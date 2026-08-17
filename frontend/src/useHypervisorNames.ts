import { useQuery } from '@tanstack/react-query'
import { api } from './api/client'

/**
 * Resolves a hypervisor id to its display name. Catalog listings span
 * every hypervisor and carry only the id, the same way instance rows do.
 */
export function useHypervisorNames() {
  const { data: hypervisors = [] } = useQuery({
    queryKey: ['hypervisors'],
    queryFn: api.listHypervisors,
  })
  return (id: string) => hypervisors.find((h) => h.id === id)?.name ?? '—'
}
