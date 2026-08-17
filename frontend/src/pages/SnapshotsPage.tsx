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
} from '@mui/material'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

export default function SnapshotsPage() {
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.listSnapshots,
    refetchInterval: 10000,
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Snapshots" />
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>VM</TableCell>
              <TableCell>Node</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>RAM</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {snapshots.map((snap) => (
              <TableRow key={`${snap.hypervisorId}/${snap.id}`} hover>
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
                <TableCell>{snap.node}</TableCell>
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
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No snapshots found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
