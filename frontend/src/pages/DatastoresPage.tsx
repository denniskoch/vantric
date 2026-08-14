import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Chip,
  LinearProgress,
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
import { formatBytes } from '../format'
import { useServerNames } from '../useServerNames'

function UsageBar({ used, total }: { used: number; total: number }) {
  if (!total) return <>—</>
  const pct = Math.min(100, (used / total) * 100)
  return (
    <Box sx={{ minWidth: 180 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, mb: 0.3 }}>
        <span>
          {formatBytes(used)} / {formatBytes(total)}
        </span>
        <span style={{ color: '#5f6368' }}>{pct.toFixed(0)}%</span>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 4,
          borderRadius: 2,
          bgcolor: '#e8eaed',
          '& .MuiLinearProgress-bar': {
            bgcolor: pct > 90 ? '#d93025' : pct > 75 ? '#f29900' : '#1a73e8',
          },
        }}
      />
    </Box>
  )
}

export default function DatastoresPage() {
  const serverName = useServerNames()
  const { data: datastores = [], isLoading } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
    refetchInterval: 10000,
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Datastores" />
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Server</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Content</TableCell>
              <TableCell>Usage</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {datastores.map((ds) => (
              <TableRow key={`${ds.serverId}/${ds.id}`} hover>
                <TableCell>
                  <Tooltip title={ds.active ? 'available' : 'unavailable'}>
                    {ds.active ? (
                      <CheckCircleIcon sx={{ color: '#188038', fontSize: 18 }} />
                    ) : (
                      <ErrorIcon sx={{ color: '#d93025', fontSize: 18 }} />
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell>{ds.name}</TableCell>
                <TableCell>{serverName(ds.serverId)}</TableCell>
                <TableCell>{ds.zone}</TableCell>
                <TableCell>{ds.type}</TableCell>
                <TableCell sx={{ color: '#5f6368', fontSize: 12 }}>{ds.content}</TableCell>
                <TableCell>
                  <UsageBar used={ds.usedBytes} total={ds.totalBytes} />
                </TableCell>
                <TableCell>
                  {ds.shared && (
                    <Chip label="shared" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {datastores.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No datastores found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
