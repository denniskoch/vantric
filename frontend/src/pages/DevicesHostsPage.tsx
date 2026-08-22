import { useMemo } from 'react'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Link,
  Typography,
} from '@mui/material'
import { api } from '../api/client'
import type { InventoryHostView } from '../api/client'
import { timeAgo } from '../format'
import PageHeader from '../components/PageHeader'
import { OSIcon } from '../components/OSName'
import { realSerial } from '../serial'
import StatusIcon from '../components/StatusIcon'

/**
 * Machines the inventory service tracks, split into the two kinds that
 * ask different questions.
 *
 * SPLIT RATHER THAN FILTERED, for the reason VM instances and container
 * instances are separate nav items: they list differently. A physical
 * machine is identified by its serial — every one of them reports a
 * real one — and has no instance to open. A guest is identified by the
 * VM it is, which the hostname will not tell you (this lab has a guest
 * called "debian" that is the WireGuard VM, and one called
 * "ci-agent-lnx-01" that is woodpecker-runner-1), and the only thing
 * that connects the two is the system UUID. One table holding both
 * would spend half its columns on dashes.
 *
 * Both halves come from one request. The endpoint returns every host
 * and the console does the dividing, because that is one cheap call
 * either way and the split is a property of the data rather than a
 * question to ask the service.
 */
function HostsPage({ virtual }: { virtual: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['inventoryHosts'],
    queryFn: api.listInventoryHosts,
    refetchInterval: 60000,
  })

  const all = data?.hosts ?? []
  const hosts = all.filter((h) => h.virtual === virtual)
  // Instances with no agent are guests, so they are the virtual page's
  // business and would be noise on the physical one.
  const unenrolled = virtual ? (data?.unenrolled ?? []) : []

  const columns = useMemo<ColumnDef<InventoryHostView, unknown>[]>(() => {
    const defs: ColumnDef<InventoryHostView, unknown>[] = [
      {
        id: 'status',
        header: 'Status',
        meta: { hug: true },
        accessorFn: (host) => host.status,
        // The same glyph the instance lists use: an agent that's checked
        // in recently is running, one that hasn't is stopped.
        cell: ({ row }) => (
          <StatusIcon status={row.original.status === 'online' ? 'RUNNING' : 'TERMINATED'} />
        ),
      },
      {
        id: 'name',
        header: 'Host',
        // Sorts and searches on the DISPLAY name, which is the one
        // somebody chose — "Diane's MacBook Air", not mac.localdomain.
        accessorFn: (host) => host.name || host.hostname,
        cell: ({ row }) => (
          <Link component={RouterLink} to={`/devices/hosts/${row.original.id}`} underline="hover">
            {row.original.name || row.original.hostname || 'Unnamed host'}
          </Link>
        ),
      },
      {
        // The identifying column, and it differs by kind: a VM is which
        // instance it is, a laptop is which machine it is.
        id: virtual ? 'instance' : 'model',
        header: virtual ? 'Instance' : 'Model',
        accessorFn: (host) => (virtual ? (host.managed ? host.instance : undefined) : host.model),
        cell: ({ row }) =>
          virtual ? <InstanceCell host={row.original} /> : row.original.model || '—',
      },
      {
        id: 'os',
        header: 'Operating system',
        // "macOS 26.2" and "Debian GNU/Linux 13 (trixie)" are one value
        // each, and breaking them after the icon leaves a stray version
        // on its own line.
        meta: { nowrap: true },
        accessorFn: (host) => host.osVersion || host.platform,
        cell: ({ row }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 16 }}>
              <OSIcon name={`${row.original.osVersion} ${row.original.platform}`} />
            </Box>
            {row.original.osVersion || row.original.platform || '—'}
          </Box>
        ),
      },
    ]
    // Only on the physical list: every machine there reports a real
    // serial, and almost no guest does — the hypervisor sets one for
    // nobody.
    if (!virtual) {
      defs.push({
        id: 'serial',
        header: 'Serial',
        meta: { nowrap: true },
        // realSerial, so the DMI placeholders every MSI board reports
        // sort and search as the absence they are rather than as six
        // machines sharing a serial.
        accessorFn: (host) => realSerial(host.serial) ?? undefined,
        cell: ({ row }) =>
          realSerial(row.original.serial) ? (
            <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
              {realSerial(row.original.serial)}
            </Box>
          ) : (
            <Box component="span" sx={{ color: 'text.secondary' }}>—</Box>
          ),
      })
    }
    defs.push({
      id: 'issues',
      header: 'Issues',
      meta: { align: 'right' },
      accessorFn: (host) => host.issuesFailing || undefined,
      cell: ({ row }) =>
        row.original.issuesFailing > 0 ? (
          <Box component="span" sx={{ color: 'error.main' }}>
            {row.original.issuesFailing}
          </Box>
        ) : (
          '—'
        ),
    })
    defs.push({
      id: 'seenAt',
      header: 'Last seen',
      meta: { nowrap: true, filterText: (host) => timeAgo(host.seenAt) },
      // Sorts on the timestamp, reads as "3 hours ago" — coarse on
      // purpose, since minutes or days is the answer and the clock time
      // is arithmetic for the reader.
      accessorFn: (host) => host.seenAt,
      cell: ({ row }) => (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {timeAgo(row.original.seenAt)}
        </Box>
      ),
    })
    return defs
  }, [virtual])

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title={virtual ? 'Virtual hosts' : 'Physical hosts'}
        description={
          virtual
            ? 'Guests running an inventory agent, matched to the instances this console runs by system UUID.'
            : 'Laptops, desktops and bare metal — the machines this console does not run, and that nothing else here can show you.'
        }
      />

      {data && !data.configured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No inventory service is connected.{' '}
          <Link component={RouterLink} to="/devices/settings/inventory" underline="hover">
            Connect one
          </Link>{' '}
          to see every machine it tracks, and which of your guests are missing an agent.
        </Alert>
      )}

      {data?.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {data.error}
        </Alert>
      )}

      {/* The drift that matters most, because it's the one somebody has
          to act on: a machine this console runs that nothing reports. */}
      {unenrolled.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {unenrolled.length === 1
            ? `${unenrolled[0]} isn't reporting to your inventory service.`
            : `${unenrolled.length} instances aren't reporting to your inventory service: ${unenrolled
                .slice(0, 6)
                .join(', ')}${unenrolled.length > 6 ? `, and ${unenrolled.length - 6} more` : ''}.`}{' '}
          They have no agent installed, or it has never checked in.
        </Alert>
      )}

      <DataTable
        rows={hosts}
        columns={columns}
        getRowId={(host) => host.id}
        initialSort={[{ id: 'name', desc: false }]}
        filterPlaceholder={
          virtual
            ? 'Filter by host, instance or operating system'
            : 'Filter by host, model, operating system or serial'
        }
        empty={
          isLoading
            ? 'Loading…'
            : !data?.configured
              ? 'Nothing to show until an inventory service is connected.'
              : virtual
                ? 'No guest is reporting to your inventory service yet.'
                : 'Every machine reporting in is a guest this console runs.'
        }
      />

      {virtual && hosts.length > 0 && (
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
          {hosts.filter((h) => h.managed).length} of {hosts.length} are guests this console runs.
        </Typography>
      )}
    </Box>
  )
}

/**
 * Which VM a guest is — the column the hostname can't answer.
 *
 * No match gets a dash, not a label. This column asks "which instance
 * is this", and for a machine that isn't one, "none" is the whole
 * answer; "External" was the console editorialising about a machine
 * that is just as much the owner's as the VM beside it.
 */
function InstanceCell({ host }: { host: InventoryHostView }) {
  if (!host.managed) {
    return <Box component="span" sx={{ color: 'text.secondary' }}>—</Box>
  }
  return (
    <Link
      component={RouterLink}
      to={`/compute/instances/${host.instance}`}
      underline="hover"
    >
      {host.instance}
    </Link>
  )
}

export function DevicesVirtualHostsPage() {
  return <HostsPage virtual />
}

export function DevicesPhysicalHostsPage() {
  return <HostsPage virtual={false} />
}
