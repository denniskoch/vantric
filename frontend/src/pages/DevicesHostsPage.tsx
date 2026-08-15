import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Chip,
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
import PageHeader from '../components/PageHeader'
import { OSIcon } from '../components/OSName'

/**
 * Every machine the inventory service knows — laptops and bare metal
 * as readily as VMs — and which of them this console runs.
 *
 * That last column is the reason this page exists outside Compute.
 * Fleet has never heard of a hypervisor and this console knows nothing
 * about a MacBook, so neither can tell you that an agent is still
 * reporting for a VM somebody deleted, or that a guest has no agent at
 * all. Both directions of that drift are here.
 */
export default function DevicesHostsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['inventoryHosts'],
    queryFn: api.listInventoryHosts,
    refetchInterval: 60000,
  })

  const hosts = data?.hosts ?? []
  const unenrolled = data?.unenrolled ?? []

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Hosts"
        description="Machines your inventory service is tracking. Guests this console runs are matched to them by system UUID; everything else is physical, or somebody else's."
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
              <TableCell>Host</TableCell>
              <TableCell>Operating system</TableCell>
              <TableCell>Managed by</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Serial</TableCell>
              <TableCell align="right">Issues</TableCell>
              <TableCell>Last seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {hosts.map((host) => (
              <TableRow key={host.id} hover>
                <TableCell>{host.hostname || '—'}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 16 }}>
                      <OSIcon name={`${host.osVersion} ${host.platform}`} />
                    </Box>
                    {host.osVersion || host.platform || '—'}
                  </Box>
                </TableCell>
                <TableCell>
                  {host.managed ? (
                    <Link
                      component={RouterLink}
                      to={`/compute/instances/${host.instance}`}
                      underline="hover"
                    >
                      {host.instance}
                    </Link>
                  ) : (
                    // Not a fault: a laptop is supposed to be here and
                    // isn't supposed to be a VM.
                    <Box component="span" sx={{ color: '#5f6368' }}>
                      External
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    label={host.status || 'unknown'}
                    size="small"
                    sx={{
                      fontSize: 11,
                      height: 20,
                      color: host.status === 'online' ? '#188038' : '#5f6368',
                    }}
                  />
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {host.serial || '—'}
                </TableCell>
                <TableCell align="right">
                  {host.issuesFailing > 0 ? (
                    <Box component="span" sx={{ color: '#d93025' }}>
                      {host.issuesFailing}
                    </Box>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell sx={{ color: '#5f6368' }}>
                  {host.seenAt ? new Date(host.seenAt * 1000).toLocaleString() : 'never'}
                </TableCell>
              </TableRow>
            ))}
            {hosts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : data?.configured
                      ? 'The service is connected but tracking no machines yet.'
                      : 'Nothing to show until an inventory service is connected.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {hosts.length > 0 && (
        <Typography sx={{ fontSize: 12, color: '#5f6368', mt: 1 }}>
          {hosts.filter((h) => h.managed).length} of {hosts.length} are guests this console
          runs.
        </Typography>
      )}
    </Box>
  )
}
