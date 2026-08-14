import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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
  Typography,
} from '@mui/material'
import { api } from '../api/client'
import { formatBytes } from '../format'
import { BrandLabel } from '../components/BrandIcon'
import { databaseBrand } from '../brands'

/**
 * Every database across every connected instance — the same
 * spans-all-servers listing the storage pages use.
 *
 * Deliberately no owner column: ownership is a PostgreSQL idea that
 * MySQL answers with grants, so in a mixed list it would be dashes
 * for half the rows. It lives on the instance's own Databases tab,
 * where the engine is known.
 */
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

  const serverFor = (id: string) => servers.find((s) => s.id === id)

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
              <TableCell>Type</TableCell>
              <TableCell>Instance</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Encoding</TableCell>
              <TableCell align="right">Connections</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {databases.map((db) => (
              <TableRow key={`${db.serverId}/${db.name}`} hover>
                <TableCell>{db.name}</TableCell>
                <TableCell>{db.system ? 'System' : 'User'}</TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/databases/instances/${db.serverId}`}
                    underline="hover"
                    sx={{ display: 'block' }}
                  >
                    <BrandLabel
                      icon={databaseBrand(
                        serverFor(db.serverId)?.type ?? '',
                        serverFor(db.serverId)?.info?.version,
                      )}
                      label={serverFor(db.serverId)?.name ?? '—'}
                    />
                  </Link>
                </TableCell>
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
