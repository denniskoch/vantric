import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
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
import PageHeader from '../components/PageHeader'
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

  const [pendingRemoval, setPendingRemoval] = useState<Server | null>(null)

  const { data: servers = [], isLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: api.listServers,
    refetchInterval: 10000,
  })

  // What disappears from the console when this hypervisor does. The
  // guests keep running; only the records go.
  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: api.listInstances,
  })
  const { data: containers = [] } = useQuery({
    queryKey: ['containers'],
    queryFn: api.listContainers,
  })
  const guestCount = (serverId: string) => ({
    instances: instances.filter((i) => i.serverId === serverId).length,
    containers: containers.filter((c) => c.serverId === serverId).length,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['servers'] })
    queryClient.invalidateQueries({ queryKey: ['instances'] })
    queryClient.invalidateQueries({ queryKey: ['containers'] })
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteServer(id),
    onSuccess: () => {
      setPendingRemoval(null)
      invalidate()
    },
    onError: (e: Error) => {
      setPendingRemoval(null)
      setError(e.message)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Hypervisors"
        actions={
          <>
            <Button variant="contained" size="small" startIcon={<AddBoxIcon />} onClick={() => navigate('/compute/settings/hypervisors/add')}>
              Add hypervisor
            </Button>
          </>
        }
        description={
          <>
            Virtualization hosts that back your instances.
          </>
        }
      />

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
                    onClick={() => setPendingRemoval(server)}
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

      <Dialog open={Boolean(pendingRemoval)} onClose={() => setPendingRemoval(null)}>
        <DialogTitle>Remove {pendingRemoval?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pendingRemoval && describeRemoval(guestCount(pendingRemoval.id))}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingRemoval(null)}>Cancel</Button>
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={() => pendingRemoval && remove.mutate(pendingRemoval.id)}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

/**
 * Removing a hypervisor is a disconnect, not a deletion — the guests
 * keep running and come back if it's added again. Say both halves:
 * what vanishes from the console, and what doesn't happen to the lab.
 */
function describeRemoval({ instances, containers }: { instances: number; containers: number }) {
  const guests = [
    instances && `${instances} instance${instances === 1 ? '' : 's'}`,
    containers && `${containers} container${containers === 1 ? '' : 's'}`,
  ].filter(Boolean)

  if (guests.length === 0) {
    return 'Its credentials are forgotten and it disappears from the catalogs. Nothing on the hypervisor changes.'
  }
  return `${guests.join(' and ')} will disappear from this console along with it. They keep running on the hypervisor — nothing is deleted there, and adding this server back adopts them again.`
}
