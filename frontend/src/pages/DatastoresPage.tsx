import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import UsageBar from '../components/UsageBar'

export default function DatastoresPage() {
  const { data: datastores = [], isLoading } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
    refetchInterval: 10000,
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Datastores" />
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Node</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Content</TableCell>
              <TableCell>Usage</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {datastores.map((ds) => (
              <TableRow key={`${ds.serverId}/${ds.id}`} hover>
                <TableCell>
                  <Tooltip title={ds.active ? 'available' : 'unavailable'}>
                    {ds.active ? (
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
                    ) : (
                      <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell>{ds.name}</TableCell>
                <TableCell>{ds.node}</TableCell>
                <TableCell>{ds.type}</TableCell>
                <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>{ds.content}</TableCell>
                <TableCell>
                  <UsageBar used={ds.usedBytes} total={ds.totalBytes} />
                </TableCell>
                <TableCell>
                  {ds.shared && (
                    <Chip label="shared" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {datastores.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No datastores found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
