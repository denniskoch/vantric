import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import UsageBar from '../components/UsageBar'
import { formatPercent, formatUptime } from '../format'
import { useServerNames } from '../useServerNames'

/**
 * The hosts everything else runs on.
 *
 * Every other page in Compute shows something running ON a zone; this
 * one shows the zone. The usage here costs no extra call — a host
 * listing reports it alongside the name, and this app read only the
 * name for as long as zones were a dropdown and nothing more.
 */
export default function ZonesPage() {
  const serverName = useServerNames()
  const { data: zones = [], isLoading } = useQuery({
    queryKey: ['zones'],
    queryFn: () => api.listZones(),
    refetchInterval: 10000,
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Zones"
        description="The virtualization hosts your instances and containers run on."
      />
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Server</TableCell>
              <TableCell align="right">vCPUs</TableCell>
              <TableCell>CPU</TableCell>
              <TableCell>Memory</TableCell>
              <TableCell>Root filesystem</TableCell>
              <TableCell>Uptime</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {zones.map((zone) => (
              <TableRow key={`${zone.serverId}/${zone.id}`} hover>
                <TableCell>
                  <Tooltip title={zone.status || 'unknown'}>
                    {zone.status === 'online' ? (
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
                    ) : (
                      <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/compute/zones/${zone.serverId}/${encodeURIComponent(zone.id)}`}
                    underline="hover"
                  >
                    {zone.name}
                  </Link>
                </TableCell>
                <TableCell>{serverName(zone.serverId)}</TableCell>
                <TableCell align="right">{zone.cpus || '—'}</TableCell>
                <TableCell>
                  {/* CPU is a rate, not an occupancy, so it reads as a
                      percentage of the host's cores rather than a
                      used-of-total the way memory and disk do. */}
                  <UsageBar
                    used={zone.cpuPercent}
                    total={100}
                    minWidth={120}
                    format={formatPercent}
                  />
                </TableCell>
                <TableCell>
                  <UsageBar used={zone.memoryUsedBytes} total={zone.memoryTotalBytes} />
                </TableCell>
                <TableCell>
                  <UsageBar used={zone.diskUsedBytes} total={zone.diskTotalBytes} />
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {zone.uptimeSeconds ? formatUptime(zone.uptimeSeconds) : '—'}
                </TableCell>
              </TableRow>
            ))}
            {zones.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No zones found. Add a hypervisor to see its hosts.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
