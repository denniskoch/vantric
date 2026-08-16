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
import { timeAgo } from '../format'
import PageHeader from '../components/PageHeader'
import { OSIcon } from '../components/OSName'
import StatusIcon from '../components/StatusIcon'

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
        description="Machines your inventory service is tracking, matched to instances by system UUID."
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
              <TableCell>Operating system</TableCell>
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
                  <Link
                    component={RouterLink}
                    to={`/devices/hosts/${host.id}`}
                    underline="hover"
                  >
                    {host.hostname || 'Unnamed host'}
                  </Link>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 16 }}>
                      <OSIcon name={`${host.osVersion} ${host.platform}`} />
                    </Box>
                    {host.osVersion || host.platform || '—'}
                  </Box>
                </TableCell>
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
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
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
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
          {hosts.filter((h) => h.managed).length} of {hosts.length} are guests this console
          runs.
        </Typography>
      )}
    </Box>
  )
}
