import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { api } from '../api/client'
import type { InventoryHostView } from '../api/client'
import { timeAgo } from '../format'
import PageHeader from '../components/PageHeader'
import { OSIcon } from '../components/OSName'
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
/**
 * A serial, or nothing — where "nothing" includes the placeholders a
 * board vendor ships and never fills in.
 *
 * Both MSI machines here report "To be filled by O.E.M.", which is DMI's
 * way of saying the field was left blank. It looks like data and is
 * not, which is the same trap as a VM's unset SMBIOS serial: the whole
 * point of the column is identifying a specific machine, and a string
 * six of them could share identifies nothing. A dash says "not set",
 * which is true and shorter.
 */
const dmiPlaceholders = [
  'to be filled by o.e.m.',
  'system serial number',
  'default string',
  'not specified',
  'not applicable',
  'none',
  'n/a',
  '0',
]

function realSerial(serial: string): string | null {
  const value = serial.trim()
  if (!value || dmiPlaceholders.includes(value.toLowerCase())) return null
  return value
}

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

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Host</TableCell>
              {/* The identifying column, and it differs by kind: a VM is
                  which instance it is, a laptop is which machine it is. */}
              <TableCell>{virtual ? 'Instance' : 'Model'}</TableCell>
              <TableCell>Operating system</TableCell>
              {!virtual && <TableCell>Serial</TableCell>}
              <TableCell align="right">Issues</TableCell>
              <TableCell>Last seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {hosts.map((host) => (
              <TableRow key={host.id} hover>
                <TableCell>
                  {/* The same glyph the instance lists use: an agent
                      that's checked in recently is running, one that
                      hasn't is stopped. */}
                  <StatusIcon status={host.status === 'online' ? 'RUNNING' : 'TERMINATED'} />
                </TableCell>
                <TableCell>
                  <Link component={RouterLink} to={`/devices/hosts/${host.id}`} underline="hover">
                    {host.name || host.hostname || 'Unnamed host'}
                  </Link>
                </TableCell>
                <TableCell>{virtual ? <InstanceCell host={host} /> : host.model || '—'}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 16 }}>
                      <OSIcon name={`${host.osVersion} ${host.platform}`} />
                    </Box>
                    {host.osVersion || host.platform || '—'}
                  </Box>
                </TableCell>
                {/* Only on the physical list: every machine there reports
                    a real serial, and almost no guest does — the
                    hypervisor sets one for nobody. */}
                {!virtual && (
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {realSerial(host.serial) ?? (
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        —
                      </Box>
                    )}
                  </TableCell>
                )}
                <TableCell align="right">
                  {host.issuesFailing > 0 ? (
                    <Box component="span" sx={{ color: 'error.main' }}>
                      {host.issuesFailing}
                    </Box>
                  ) : (
                    '—'
                  )}
                </TableCell>
                {/* Coarse on purpose: minutes or days is the answer;
                    the clock time is arithmetic for the reader. */}
                <TableCell sx={{ color: 'text.secondary' }}>{timeAgo(host.seenAt)}</TableCell>
              </TableRow>
            ))}
            {hosts.length === 0 && (
              <TableRow>
                <TableCell colSpan={virtual ? 6 : 7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading
                    ? 'Loading…'
                    : !data?.configured
                      ? 'Nothing to show until an inventory service is connected.'
                      : virtual
                        ? 'No guest is reporting to your inventory service yet.'
                        : 'Every machine reporting in is a guest this console runs.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

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
