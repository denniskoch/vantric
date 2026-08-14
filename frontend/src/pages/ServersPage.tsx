import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HelpIcon from '@mui/icons-material/Help'
import { api } from '../api/client'
import type { Server, ServerType } from '../api/client'
import { BrandLabel } from '../components/BrandIcon'
import { hypervisorBrand } from '../brands'

const typeLabels: Record<ServerType, string> = {
  proxmox: 'Proxmox VE',
  mock: 'Mock (development)',
}

function StatusGlyph({ server }: { server: Server }) {
  const icon =
    server.status === 'connected' ? (
      <CheckCircleIcon sx={{ color: '#188038', fontSize: 18 }} />
    ) : server.status === 'unreachable' ? (
      <ErrorIcon sx={{ color: '#d93025', fontSize: 18 }} />
    ) : (
      <HelpIcon sx={{ color: '#5f6368', fontSize: 18 }} />
    )
  return (
    <Tooltip title={server.error ? `${server.status}: ${server.error}` : server.status}>
      <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>{icon}</span>
    </Tooltip>
  )
}

export default function ServersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data: servers = [], isLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: api.listServers,
    refetchInterval: 10000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['servers'] })
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteServer(id),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
        <Typography variant="h5">Hypervisors</Typography>
        <Button variant="contained" size="small" startIcon={<AddBoxIcon />} onClick={() => navigate('/compute/settings/hypervisors/add')}>
          Add hypervisor
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Virtualization hosts that back your instances. Each one provides
        zones (its nodes) and images (its templates).
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Endpoint</TableCell>
              <TableCell align="right">Nodes</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {servers.map((server) => (
              <TableRow key={server.id} hover>
                <TableCell>
                  <StatusGlyph server={server} />
                </TableCell>
                <TableCell>{server.name}</TableCell>
                <TableCell>
                  <BrandLabel
                    icon={hypervisorBrand(server.type)}
                    label={typeLabels[server.type] ?? server.type}
                  />
                </TableCell>
                <TableCell>{server.baseUrl || '—'}</TableCell>
                <TableCell align="right">
                  {server.status === 'connected' ? server.nodes : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => navigate(`/compute/settings/hypervisors/${server.id}/edit`)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => remove.mutate(server.id)}
                    disabled={remove.isPending}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {servers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No hypervisors registered. Click "Add hypervisor" to connect one.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

    </Box>
  )
}
