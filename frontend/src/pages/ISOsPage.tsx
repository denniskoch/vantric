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

export default function ISOsPage() {
  const serverName = useServerNames()
  const { data: isos = [], isLoading } = useQuery({
    queryKey: ['isos'],
    queryFn: api.listISOs,
  })

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        ISOs
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
            {isos.map((iso) => (
              <TableRow key={`${iso.serverId}/${iso.id}`} hover>
                <TableCell>{iso.name}</TableCell>
                <TableCell>{iso.storage}</TableCell>
                <TableCell>{serverName(iso.serverId)}</TableCell>
                <TableCell>{iso.zone}</TableCell>
                <TableCell align="right">{formatBytes(iso.sizeBytes)}</TableCell>
                <TableCell>
                  {iso.createdAt ? new Date(iso.createdAt * 1000).toLocaleDateString() : '—'}
                </TableCell>
              </TableRow>
            ))}
            {isos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No ISO images found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
