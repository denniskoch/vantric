import { useMemo } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Chip,
  Link,
} from '@mui/material'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

export default function SnapshotsPage() {
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.listSnapshots,
    refetchInterval: 10000,
  })

  const columns = useMemo<ColumnDef<(typeof snapshots)[number], unknown>[]>(
    () => [
      {
        id: 'vmName',
        header: 'VM',
        accessorFn: (snap) => snap.vmName,
        cell: ({ row }) => (
          <Link
            component={RouterLink}
            to={`/compute/instances/${row.original.vmName}`}
            underline="hover"
          >
            {row.original.vmName}
          </Link>
        ),
      },
      { id: 'name', header: 'Name', accessorFn: (snap) => snap.name },
      { id: 'node', header: 'Node', accessorFn: (snap) => snap.node },
      {
        id: 'description',
        header: 'Description',
        accessorFn: (snap) => snap.description,
        cell: ({ row }) => row.original.description || '—',
      },
      {
        id: 'createdAt',
        header: 'Created',
        meta: { nowrap: true },
        accessorFn: (snap) => snap.createdAt,
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt * 1000).toLocaleString()
            : '—',
      },
      {
        id: 'includesRam',
        header: 'RAM',
        accessorFn: (snap) => snap.includesRam,
        cell: ({ row }) =>
          row.original.includesRam ? (
            <Chip label="RAM" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
          ) : null,
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Snapshots" />
      <DataTable
        rows={snapshots}
        columns={columns}
        getRowId={(snap) => `${snap.hypervisorId}/${snap.id}`}
        initialSort={[{ id: 'vmName', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No snapshots found on your servers.'}
      />
    </Box>
  )
}
