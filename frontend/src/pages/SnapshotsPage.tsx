import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Chip,
  Link,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { api } from '../api/client'

export default function SnapshotsPage() {
  const [serverId, setServerId] = useState('')

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['snapshots', serverId],
    queryFn: () => api.listSnapshots(serverId),
    enabled: Boolean(serverId),
    refetchInterval: 10000,
  })

  const connected = servers.filter((s) => s.status === 'connected')
  if (!serverId && connected.length > 0) {
    setServerId(connected[0].id)
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h5">Snapshots</Typography>
        <TextField
          label="Server"
          size="small"
          select
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          {servers.map((s) => (
            <MenuItem key={s.id} value={s.id} disabled={s.status !== 'connected'}>
              {s.name} ({s.status})
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>VM</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>RAM</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {snapshots.map((snap) => (
              <TableRow key={snap.id} hover>
                <TableCell>{snap.name}</TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/compute/instances/${snap.vmName}`}
                    underline="hover"
                  >
                    {snap.vmName}
                  </Link>
                </TableCell>
                <TableCell>{snap.zone}</TableCell>
                <TableCell>{snap.description || '—'}</TableCell>
                <TableCell>
                  {snap.createdAt ? new Date(snap.createdAt * 1000).toLocaleString() : '—'}
                </TableCell>
                <TableCell>
                  {snap.includesRam && (
                    <Chip label="RAM" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {snapshots.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {!serverId
                    ? 'No connected servers — add one under Bare Metal Solution → Servers.'
                    : isLoading
                      ? 'Loading…'
                      : 'No snapshots found on this server.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
