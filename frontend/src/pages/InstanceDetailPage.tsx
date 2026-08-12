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
import { useProject } from '../project'
import StatusIcon from '../components/StatusIcon'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ color: '#5f6368', width: 220, border: 0 }}>{label}</TableCell>
      <TableCell sx={{ border: 0 }}>{value}</TableCell>
    </TableRow>
  )
}

export default function InstanceDetailPage() {
  const { name } = useParams<{ name: string }>()
  const { current } = useProject()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const project = current?.name
  const { data: inst } = useQuery({
    queryKey: ['instance', project, name],
    queryFn: () => api.getInstance(project!, name!),
    enabled: Boolean(project && name),
    refetchInterval: 3000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['instance', project, name] })
    queryClient.invalidateQueries({ queryKey: ['instances', project] })
  }

  const action = useMutation({
    mutationFn: (act: 'start' | 'stop' | 'reset') => api.instanceAction(project!, name!, act),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteInstance(project!, name!),
    onSuccess: () => navigate('/compute/instances'),
    onError: (e: Error) => setError(e.message),
  })

  if (!inst) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading instance…</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, maxWidth: 860 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/compute/instances')}>
          VM instances
        </Button>
        <StatusIcon status={inst.status} />
        <Typography variant="h5">{inst.name}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<PlayArrowIcon />}
          disabled={inst.status !== 'TERMINATED' || action.isPending}
          onClick={() => action.mutate('start')}
        >
          Start
        </Button>
        <Button
          size="small"
          startIcon={<StopIcon />}
          disabled={inst.status !== 'RUNNING' || action.isPending}
          onClick={() => action.mutate('stop')}
        >
          Stop
        </Button>
        <Button
          size="small"
          startIcon={<RestartAltIcon />}
          disabled={inst.status !== 'RUNNING' || action.isPending}
          onClick={() => action.mutate('reset')}
        >
          Reset
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
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
            <Row label="Status" value={inst.status} />
            <Row label="Zone" value={inst.zone} />
            <Row
              label="Machine type"
              value={`${inst.machineType || 'custom'} (${inst.cpus} vCPU, ${inst.memoryMb} MB memory)`}
            />
            <Row label="Boot disk" value={`${inst.diskGb} GB (image ${inst.imageId})`} />
            <Row label="Created" value={new Date(inst.createdAt).toLocaleString()} />
          </TableBody>
        </Table>
        <Divider sx={{ my: 2 }} />
        <Typography variant="h6" sx={{ mb: 1 }}>
          Network interfaces
        </Typography>
        <Table size="small">
          <TableBody>
            <Row label="Internal IP" value={inst.internalIp || '—'} />
            <Row label="External IP" value={inst.externalIp || '—'} />
          </TableBody>
        </Table>
        <Divider sx={{ my: 2 }} />
        <Typography variant="h6" sx={{ mb: 1 }}>
          Backend
        </Typography>
        <Table size="small">
          <TableBody>
            <Row label="Hypervisor driver" value={inst.driver} />
            <Row label="Driver instance ID" value={inst.driverId} />
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}
