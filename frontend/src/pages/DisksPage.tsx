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
} from '@mui/material'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

export default function DisksPage() {
  const { data: disks = [], isLoading } = useQuery({
    queryKey: ['disks'],
    queryFn: api.listDisks,
    refetchInterval: 10000,
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Disks" />
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>In use by</TableCell>
              <TableCell>Node</TableCell>
              <TableCell>Storage pool</TableCell>
              <TableCell align="right">Size (GB)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {disks.map((disk) => (
              <TableRow key={`${disk.serverId}/${disk.id}`} hover>
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
                <TableCell>{disk.node}</TableCell>
                <TableCell>{disk.storage}</TableCell>
                <TableCell align="right">{disk.sizeGb || '—'}</TableCell>
              </TableRow>
            ))}
            {disks.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No disks found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
