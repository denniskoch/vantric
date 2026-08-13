import { useQuery } from '@tanstack/react-query'
import {
  Box,
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
import { useServerNames } from '../useServerNames'

// VM templates (Proxmox template VMs) — the sources "create instance"
// clones from.
export default function VMTemplatesPage() {
  const serverName = useServerNames()
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['images'],
    queryFn: () => api.listImages(),
  })

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        VM templates
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>ID</TableCell>
              <TableCell>Server</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell>Description</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.map((tpl) => (
              <TableRow key={`${tpl.serverId}/${tpl.id}`} hover>
                <TableCell>{tpl.name}</TableCell>
                <TableCell>{tpl.id}</TableCell>
                <TableCell>{serverName(tpl.serverId)}</TableCell>
                <TableCell>{tpl.zone || '—'}</TableCell>
                <TableCell>{tpl.description || '—'}</TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No VM templates found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
