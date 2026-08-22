import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Link,
  Tooltip,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import UsageBar from '../components/UsageBar'
import { formatUptime } from '../format'
import { useHypervisorNames } from '../useHypervisorNames'

/**
 * The hosts everything else runs on.
 *
 * Every other page in Compute shows something running ON a node; this
 * one shows the node. The usage here costs no extra call — a host
 * listing reports it alongside the name, and this app read only the
 * name for as long as nodes were a dropdown and nothing more.
 */
export default function NodesPage() {
  const hypervisorName = useHypervisorNames()
  const { data: nodes = [], isLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.listNodes(),
    refetchInterval: 10000,
  })

  const columns = useMemo<ColumnDef<(typeof nodes)[number], unknown>[]>(
    () => [
      {
        id: 'status',
        header: 'Status',
        accessorFn: (node) => node.status,
        cell: ({ row }) => (
          <Tooltip title={row.original.status || 'unknown'}>
            {row.original.status === 'online' ? (
              <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
            ) : (
              <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
            )}
          </Tooltip>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (node) => node.name,
        cell: ({ row }) => (
          <Link
            component={RouterLink}
            to={`/compute/nodes/${row.original.hypervisorId}/${encodeURIComponent(row.original.id)}`}
            underline="hover"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'hypervisor',
        header: 'Hypervisor',
        accessorFn: (node) => hypervisorName(node.hypervisorId),
      },
      {
        id: 'cpus',
        header: 'vCPUs',
        accessorFn: (node) => node.cpus,
        meta: { align: 'right' },
        cell: ({ row }) => row.original.cpus || '—',
      },
      {
        id: 'cpuPercent',
        header: 'CPU',
        accessorFn: (node) => node.cpuPercent,
        cell: ({ row }) => (
          <UsageBar used={row.original.cpuPercent} total={100} minWidth={110} showValues={false} />
        ),
      },
      {
        id: 'memory',
        header: 'Memory',
        accessorFn: (node) =>
          node.memoryTotalBytes > 0 ? node.memoryUsedBytes / node.memoryTotalBytes : undefined,
        cell: ({ row }) => (
          <UsageBar used={row.original.memoryUsedBytes} total={row.original.memoryTotalBytes} />
        ),
      },
      {
        id: 'disk',
        header: 'Root filesystem',
        accessorFn: (node) =>
          node.diskTotalBytes > 0 ? node.diskUsedBytes / node.diskTotalBytes : undefined,
        cell: ({ row }) => (
          <UsageBar used={row.original.diskUsedBytes} total={row.original.diskTotalBytes} />
        ),
      },
      {
        id: 'uptime',
        header: 'Uptime',
        accessorFn: (node) => node.uptimeSeconds,
        cell: ({ row }) => (
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {row.original.uptimeSeconds ? formatUptime(row.original.uptimeSeconds) : '—'}
          </Box>
        ),
      },
    ],
    [hypervisorName],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Nodes"
        description="The virtualization hosts your instances and containers run on."
      />
      <DataTable
        rows={nodes}
        columns={columns}
        getRowId={(node) => `${node.hypervisorId}/${node.id}`}
        initialSort={[{ id: 'name', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No nodes found. Add a hypervisor to see its hosts.'}
      />
    </Box>
  )
}
