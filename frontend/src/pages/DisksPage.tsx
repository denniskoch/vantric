import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
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

export default function DisksPage() {
  const [serverId, setServerId] = useState('')

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: disks = [], isLoading } = useQuery({
    queryKey: ['disks', serverId],
    queryFn: () => api.listDisks(serverId),
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
        <Typography variant="h5">Disks</Typography>
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
              <TableCell>In use by</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell>Storage pool</TableCell>
              <TableCell align="right">Size (GB)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {disks.map((disk) => (
              <TableRow key={disk.id} hover>
                <TableCell>{disk.name}</TableCell>
                <TableCell>
                  {disk.inUseBy ? (
                    <Link
                      component={RouterLink}
                      to={`/compute/instances/${disk.inUseBy}`}
                      underline="hover"
                    >
                      {disk.inUseBy}
                    </Link>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>{disk.zone}</TableCell>
                <TableCell>{disk.storage}</TableCell>
                <TableCell align="right">{disk.sizeGb || '—'}</TableCell>
              </TableRow>
            ))}
            {disks.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {!serverId
                    ? 'No connected servers — add one under Bare Metal Solution → Servers.'
                    : isLoading
                      ? 'Loading…'
                      : 'No disks found on this server.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
