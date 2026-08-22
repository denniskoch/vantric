import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteIcon from '@mui/icons-material/Delete'
import { useState } from 'react'
import { api } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import StatusIcon from '../components/StatusIcon'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ color: 'text.secondary', width: 220, border: 0 }}>{label}</TableCell>
      <TableCell sx={{ border: 0 }}>{value}</TableCell>
    </TableRow>
  )
}

export default function ContainerDetailPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { data: ct } = useQuery({
    queryKey: ['container', name],
    queryFn: () => api.getContainer(name!),
    enabled: Boolean(name),
    refetchInterval: 3000,
  })
  const { data: hypervisors = [] } = useQuery({ queryKey: ['hypervisors'], queryFn: api.listHypervisors })
  const hypervisor = hypervisors.find((s) => s.id === ct?.hypervisorId)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['container', name] })
    queryClient.invalidateQueries({ queryKey: ['containers'] })
  }

  // A power action starts an operation, so the bell should turn now
  // rather than at the end of its next three-second poll.
  const started = () => {
    invalidate()
    queryClient.invalidateQueries({ queryKey: ['operations'] })
  }

  const action = useMutation({
    mutationFn: (act: 'start' | 'stop' | 'reset') => api.containerAction(name!, act),
    onSuccess: started,
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteContainer(name!),
    onSuccess: () => navigate('/compute/containers'),
    onError: (e: Error) => {
      setDeleting(false)
      setError(e.message)
    },
  })

  const protect = useMutation({
    mutationFn: (flag: boolean) => api.setContainerProtection(name!, flag),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  if (!ct) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading container…</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, maxWidth: 860 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/compute/containers')}>
          Container instances
        </Button>
        <StatusIcon status={ct.status} />
        <Typography variant="h5">{ct.name}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<PlayArrowIcon />}
          disabled={ct.status !== 'TERMINATED' || action.isPending}
          onClick={() => action.mutate('start')}
        >
          Start
        </Button>
        <Button
          size="small"
          startIcon={<StopIcon />}
          disabled={ct.status !== 'RUNNING' || action.isPending}
          onClick={() => action.mutate('stop')}
        >
          Stop
        </Button>
        <Button
          size="small"
          startIcon={<RestartAltIcon />}
          disabled={ct.status !== 'RUNNING' || action.isPending}
          onClick={() => action.mutate('reset')}
        >
          Restart
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          disabled={remove.isPending || ct.protected}
          onClick={() => setDeleting(true)}
        >
          Delete
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Basic information
        </Typography>
        <Table size="small">
          <TableBody>
            <Row label="Status" value={ct.status} />
            <Row label="Node" value={ct.node} />
            <Row label="Resources" value={`${ct.cpus} vCPU, ${ct.memoryMb} MB memory`} />
            <Row label="Root disk" value={`${ct.diskGb} GB`} />
            {ct.description && <Row label="Description" value={ct.description} />}
            <Row
              label="Deletion protection"
              value={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {ct.protected ? 'Enabled' : 'Disabled'}
                  <Button
                    size="small"
                    disabled={protect.isPending}
                    onClick={() => protect.mutate(!ct.protected)}
                  >
                    {ct.protected ? 'Disable' : 'Enable'}
                  </Button>
                </Box>
              }
            />
            <Row label="Created" value={new Date(ct.createdAt).toLocaleString()} />
          </TableBody>
        </Table>
        <Divider sx={{ my: 2 }} />
        <Typography variant="h6" sx={{ mb: 1 }}>
          Network
        </Typography>
        <Table size="small">
          <TableBody>
            <Row label="IP address" value={ct.internalIp || '—'} />
          </TableBody>
        </Table>
        <Divider sx={{ my: 2 }} />
        <Typography variant="h6" sx={{ mb: 1 }}>
          Backend
        </Typography>
        <Table size="small">
          <TableBody>
            <Row label="Hypervisor" value={hypervisor ? `${hypervisor.name} (${hypervisor.type})` : ct.hypervisorId} />
            <Row label="Driver container ID" value={ct.driverId} />
          </TableBody>
        </Table>
      </Paper>

      <ConfirmDeleteDialog
        open={deleting}
        title={`Delete ${ct.name}?`}
        body={
          <>
            This destroys the container and its root filesystem. Backups taken of it\n            are not removed, but nothing else brings it back.
          </>
        }
        confirmPhrase={ct.name}
        confirmLabel="to delete it"
        pending={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </Box>
  )
}
