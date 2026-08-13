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
import { formatBytes } from '../format'
import { useServerNames } from '../useServerNames'

// CT templates (LXC root-filesystem tarballs) — the sources containers
// are provisioned from.
export default function CTTemplatesPage() {
  const serverName = useServerNames()
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['ctTemplates'],
    queryFn: api.listCTTemplates,
  })

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        CT templates
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Datastore</TableCell>
              <TableCell>Server</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Uploaded</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.map((tpl) => (
              <TableRow key={`${tpl.serverId}/${tpl.id}`} hover>
                <TableCell>{tpl.name}</TableCell>
                <TableCell>{tpl.storage}</TableCell>
                <TableCell>{serverName(tpl.serverId)}</TableCell>
                <TableCell>{tpl.zone}</TableCell>
                <TableCell align="right">{formatBytes(tpl.sizeBytes)}</TableCell>
                <TableCell>
                  {tpl.createdAt ? new Date(tpl.createdAt * 1000).toLocaleDateString() : '—'}
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No CT templates found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
