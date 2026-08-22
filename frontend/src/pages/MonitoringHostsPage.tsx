import { useMemo } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Link, Typography } from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import EnabledIcon from '../components/EnabledIcon'
import { api } from '../api/client'
import type { MonitoredHost } from '../api/client'

/**
 * What the monitoring service watches, joined to what this console
 * runs.
 *
 * THE JOIN IS INTERFACE IP, and the page says so: a monitoring agent
 * doesn't report SMBIOS, so the UUID join Devices uses isn't available
 * — the address is what both sides hold fresh. Weaker, and honest
 * about it.
 *
 * The finding is the alert above the table: running guests no watched
 * host answers for. Same shape as Devices' unenrolled list — drift
 * neither tool can see alone.
 */
export default function MonitoringHostsPage() {
  const { data: providers = [] } = useQuery({
    queryKey: ['monitoringProviders'],
    queryFn: api.listMonitoringProviders,
  })
  const connected = providers.length > 0
  const { data, isLoading, error } = useQuery({
    queryKey: ['monitoringHosts'],
    queryFn: api.listMonitoringHosts,
    enabled: connected,
    refetchInterval: 60_000,
  })

  const hosts = data?.hosts ?? []
  const unmonitored = data?.unmonitored ?? []

  const columns = useMemo<ColumnDef<MonitoredHost, unknown>[]>(
    () => [
      {
        id: 'enabled',
        header: 'Status',
        meta: { hug: true },
        accessorFn: (h) => (h.enabled ? 'Monitored' : 'Disabled'),
        cell: ({ row }) => (
          <EnabledIcon
            enabled={row.original.enabled}
            on="Monitored"
            off="Disabled in the monitoring service"
          />
        ),
      },
      { id: 'name', header: 'Host', meta: { nowrap: true }, accessorFn: (h) => h.name },
      {
        id: 'addresses',
        header: 'Addresses',
        meta: { nowrap: true },
        accessorFn: (h) => h.addresses.join(' '),
        cell: ({ row }) => row.original.addresses.join(', ') || '—',
      },
      {
        id: 'instance',
        header: 'Instance',
        meta: { nowrap: true },
        accessorFn: (h) => h.instance,
        // A watched machine this console doesn't run is expected — the
        // monitoring service sees switches and metal too. "External",
        // the same word Devices uses for it.
        cell: ({ row }) =>
          row.original.instance ? (
            <Link
              component={RouterLink}
              to={`/compute/instances/${encodeURIComponent(row.original.instance)}`}
              underline="hover"
            >
              {row.original.instance}
            </Link>
          ) : (
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              External
            </Typography>
          ),
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Hosts"
        description="What the monitoring service watches, matched to instances by interface address."
      />

      {!connected && !isLoading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No monitoring service is connected.
        </Alert>
      )}

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      {unmonitored.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {unmonitored.length === 1
            ? `1 running instance isn't monitored: ${unmonitored[0]}.`
            : `${unmonitored.length} running instances aren't monitored: ${unmonitored
                .slice(0, 6)
                .join(', ')}${unmonitored.length > 6 ? `, and ${unmonitored.length - 6} more` : ''}.`}{' '}
          No watched host answers at their address.
        </Alert>
      )}

      {connected && (
        <DataTable
          rows={hosts}
          columns={columns}
          getRowId={(h) => h.id}
          initialSort={[{ id: 'name', desc: false }]}
          filterPlaceholder="Filter by host, address or instance"
          empty={isLoading ? 'Loading…' : 'The service watches no hosts.'}
        />
      )}
    </Box>
  )
}
