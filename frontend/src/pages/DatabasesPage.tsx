import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Chip,
  Link,
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

/** Every database across every connected instance — the same
 *  spans-all-servers listing the storage pages use. */
export default function DatabasesPage() {
  const { data: servers = [] } = useQuery({
    queryKey: ['databaseServers'],
    queryFn: api.listDatabaseServers,
  })
  const { data: databases = [], isLoading } = useQuery({
    queryKey: ['databases'],
    queryFn: () => api.listDatabases(),
    refetchInterval: 30000,
  })

  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? '—'

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Databases
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every database across your connected instances.
      </Typography>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Instance</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Encoding</TableCell>
              <TableCell align="right">Connections</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {databases.map((db) => (
              <TableRow key={`${db.serverId}/${db.name}`} hover>
                <TableCell>
                  {db.name}
                  {db.system && (
                    <Chip
                      label="system"
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18, ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/databases/instances/${db.serverId}`}
                    underline="hover"
                  >
                    {serverName(db.serverId)}
                  </Link>
                </TableCell>
                <TableCell>{db.owner || '—'}</TableCell>
                <TableCell align="right">{db.sizeBytes ? formatBytes(db.sizeBytes) : '—'}</TableCell>
                <TableCell>{db.encoding}</TableCell>
                <TableCell align="right">{db.connections}</TableCell>
              </TableRow>
            ))}
            {databases.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No databases — connect an instance first.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
