import { useMemo } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Link,
} from '@mui/material'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

export default function DisksPage() {
  const { data: disks = [], isLoading } = useQuery({
    queryKey: ['disks'],
    queryFn: api.listDisks,
    refetchInterval: 10000,
  })

  const columns = useMemo<ColumnDef<(typeof disks)[number], unknown>[]>(
    () => [
      { id: 'name', header: 'Name', accessorFn: (disk) => disk.name },
      {
        id: 'inUseBy',
        header: 'In use by',
        accessorFn: (disk) => disk.inUseBy,
        cell: ({ row }) =>
          row.original.inUseBy ? (
            <Link
              component={RouterLink}
              to={`/compute/instances/${row.original.inUseBy}`}
              underline="hover"
            >
              {row.original.inUseBy}
            </Link>
          ) : (
            '—'
          ),
      },
      { id: 'node', header: 'Node', accessorFn: (disk) => disk.node },
      { id: 'storage', header: 'Storage pool', accessorFn: (disk) => disk.storage },
      {
        id: 'sizeGb',
        header: 'Size (GB)',
        accessorFn: (disk) => disk.sizeGb,
        meta: { align: 'right' },
        cell: ({ row }) => row.original.sizeGb || '—',
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Disks" />
      <DataTable
        rows={disks}
        columns={columns}
        filterPlaceholder="Filter by name, guest, node or storage pool"
        getRowId={(disk) => `${disk.hypervisorId}/${disk.id}`}
        initialSort={[{ id: 'name', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No disks found on your servers.'}
      />
    </Box>
  )
}
