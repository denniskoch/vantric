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
import { formatUptime } from '../format'
import { useServerNames } from '../useServerNames'

/**
 * The hosts everything else runs on.
 *
 * Every other page in Compute shows something running ON a node; this
 * one shows the node. The usage here costs no extra call — a host
 * listing reports it alongside the name, and this app read only the
 * name for as long as nodes were a dropdown and nothing more.
 */
export default function NodesPage() {
  const serverName = useServerNames()
  const { data: nodes = [], isLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.listNodes(),
    refetchInterval: 10000,
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Nodes"
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
            {nodes.map((node) => (
              <TableRow key={`${node.serverId}/${node.id}`} hover>
                <TableCell>
                  <Tooltip title={node.status || 'unknown'}>
                    {node.status === 'online' ? (
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
                    ) : (
                      <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/compute/nodes/${node.serverId}/${encodeURIComponent(node.id)}`}
                    underline="hover"
                  >
                    {node.name}
                  </Link>
                </TableCell>
                <TableCell>{serverName(node.serverId)}</TableCell>
                <TableCell align="right">{node.cpus || '—'}</TableCell>
                <TableCell>
                  {/* A rate, not an occupancy: the bar shows how hard
                      the host is working, with no used-of-total pair
                      the way memory and disk have. */}
                  <UsageBar used={node.cpuPercent} total={100} minWidth={110} showValues={false} />
                </TableCell>
                <TableCell>
                  <UsageBar used={node.memoryUsedBytes} total={node.memoryTotalBytes} />
                </TableCell>
                <TableCell>
                  <UsageBar used={node.diskUsedBytes} total={node.diskTotalBytes} />
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {node.uptimeSeconds ? formatUptime(node.uptimeSeconds) : '—'}
                </TableCell>
              </TableRow>
            ))}
            {nodes.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No nodes found. Add a hypervisor to see its hosts.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
