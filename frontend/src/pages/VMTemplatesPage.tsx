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

// VM templates (Proxmox template VMs) — the sources "create instance"
// clones from.
export default function VMTemplatesPage() {
  const [serverId, setServerId] = useState('')

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: images = [], isLoading } = useQuery({
    queryKey: ['images', serverId],
    queryFn: () => api.listImages(serverId),
    enabled: Boolean(serverId),
  })

  // Default to the first connected server.
  const connected = servers.filter((s) => s.status === 'connected')
  if (!serverId && connected.length > 0) {
    setServerId(connected[0].id)
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h5">VM templates</Typography>
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
              <TableCell>ID</TableCell>
              <TableCell>Description</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {images.map((img) => (
              <TableRow key={img.id} hover>
                <TableCell>{img.name}</TableCell>
                <TableCell>{img.id}</TableCell>
                <TableCell>{img.description}</TableCell>
              </TableRow>
            ))}
            {images.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {!serverId
                    ? 'No connected servers — add one under Bare Metal Solution → Servers.'
                    : isLoading
                      ? 'Loading…'
                      : 'No VM templates found on this server.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
