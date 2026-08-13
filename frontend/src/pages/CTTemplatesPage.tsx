import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
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
import { formatBytes } from '../format'

// CT templates (LXC root-filesystem tarballs) — the sources containers
// are provisioned from.
export default function CTTemplatesPage() {
  const [serverId, setServerId] = useState('')

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['ctTemplates', serverId],
    queryFn: () => api.listCTTemplates(serverId),
    enabled: Boolean(serverId),
  })

  const connected = servers.filter((s) => s.status === 'connected')
  if (!serverId && connected.length > 0) {
    setServerId(connected[0].id)
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h5">CT templates</Typography>
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
              <TableCell>Datastore</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Uploaded</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.map((tpl) => (
              <TableRow key={tpl.id} hover>
                <TableCell>{tpl.name}</TableCell>
                <TableCell>{tpl.storage}</TableCell>
                <TableCell>{tpl.zone}</TableCell>
                <TableCell align="right">{formatBytes(tpl.sizeBytes)}</TableCell>
                <TableCell>
                  {tpl.createdAt ? new Date(tpl.createdAt * 1000).toLocaleDateString() : '—'}
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {!serverId
                    ? 'No connected servers — add one under Bare Metal Solution → Servers.'
                    : isLoading
                      ? 'Loading…'
                      : 'No CT templates found on this server.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
