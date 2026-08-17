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
import type { Hypervisor, HypervisorType } from '../api/client'
import { BrandLabel } from '../components/BrandIcon'
import PageHeader from '../components/PageHeader'
import { hypervisorBrand } from '../brands'

const typeLabels: Record<HypervisorType, string> = {
  proxmox: 'Proxmox VE',
  mock: 'Mock (development)',
}

function StatusGlyph({ hypervisor }: { hypervisor: Hypervisor }) {
  const icon =
    hypervisor.status === 'connected' ? (
      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
    ) : hypervisor.status === 'unreachable' ? (
      <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
    ) : (
      <HelpIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
    )
  return (
    <Tooltip title={hypervisor.error ? `${hypervisor.status}: ${hypervisor.error}` : hypervisor.status}>
      <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>{icon}</span>
    </Tooltip>
  )
}

export default function HypervisorsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const [pendingRemoval, setPendingRemoval] = useState<Hypervisor | null>(null)

  const { data: hypervisors = [], isLoading } = useQuery({
    queryKey: ['hypervisors'],
    queryFn: api.listHypervisors,
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
  const guestCount = (hypervisorId: string) => ({
    instances: instances.filter((i) => i.hypervisorId === hypervisorId).length,
    containers: containers.filter((c) => c.hypervisorId === hypervisorId).length,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['hypervisors'] })
    queryClient.invalidateQueries({ queryKey: ['instances'] })
    queryClient.invalidateQueries({ queryKey: ['containers'] })
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteHypervisor(id),
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
            <Button variant="contained" size="small" startIcon={<AddBoxIcon />} onClick={() => navigate('/compute/hypervisors/add')}>
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
            {hypervisors.map((hypervisor) => (
              <TableRow key={hypervisor.id} hover>
                <TableCell>
                  <StatusGlyph hypervisor={hypervisor} />
                </TableCell>
                <TableCell>{hypervisor.name}</TableCell>
                <TableCell>
                  <BrandLabel
                    icon={hypervisorBrand(hypervisor.type)}
                    label={typeLabels[hypervisor.type] ?? hypervisor.type}
                  />
                </TableCell>
                <TableCell>{hypervisor.baseUrl || '—'}</TableCell>
                <TableCell align="right">
                  {hypervisor.status === 'connected' ? hypervisor.nodes : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => navigate(`/compute/hypervisors/${hypervisor.id}/edit`)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setPendingRemoval(hypervisor)}
                    disabled={remove.isPending}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {hypervisors.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
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
  return `${guests.join(' and ')} will disappear from this console along with it. They keep running on the hypervisor — nothing is deleted there, and adding this hypervisor back adopts them again.`
}
