import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Box,
  Chip,
  Tooltip,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import UsageBar from '../components/UsageBar'

export default function DatastoresPage() {
  const { data: datastores = [], isLoading } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
    refetchInterval: 10000,
  })

  const columns = useMemo<ColumnDef<(typeof datastores)[number], unknown>[]>(
    () => [
      {
        id: 'active',
        header: 'Status',
        meta: { hug: true },
        accessorFn: (ds) => ds.active,
        cell: ({ row }) => (
          <Tooltip title={row.original.active ? 'available' : 'unavailable'}>
            {row.original.active ? (
              <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
            ) : (
              <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
            )}
          </Tooltip>
        ),
      },
      { id: 'name', header: 'Name', accessorFn: (ds) => ds.name },
      { id: 'node', header: 'Node', accessorFn: (ds) => ds.node },
      { id: 'type', header: 'Type', accessorFn: (ds) => ds.type },
      {
        id: 'content',
        header: 'Content',
        accessorFn: (ds) => ds.content,
        cell: ({ row }) => (
          <Box component="span" sx={{ color: 'text.secondary', fontSize: 12 }}>
            {row.original.content}
          </Box>
        ),
      },
      {
        id: 'usage',
        header: 'Usage',
        // Sorts on the FRACTION, which is the question a usage column
        // answers — a 90%-full 100 GB pool needs attention before a
        // 10%-full 10 TB one.
        accessorFn: (ds) => (ds.totalBytes > 0 ? ds.usedBytes / ds.totalBytes : undefined),
        cell: ({ row }) => (
          <UsageBar used={row.original.usedBytes} total={row.original.totalBytes} />
        ),
      },
      {
        id: 'shared',
        header: '',
        accessorFn: (ds) => ds.shared,
        cell: ({ row }) =>
          row.original.shared ? (
            <Chip label="shared" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
          ) : null,
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Datastores" />
      <DataTable
        rows={datastores}
        columns={columns}
        filterPlaceholder="Filter by name, node, type or content"
        getRowId={(ds) => `${ds.hypervisorId}/${ds.id}`}
        initialSort={[{ id: 'name', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No datastores found on your servers.'}
      />
    </Box>
  )
}
