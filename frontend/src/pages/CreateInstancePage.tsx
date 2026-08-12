import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import { useProject } from '../project'

export default function CreateInstancePage() {
  const { current } = useProject()
  const navigate = useNavigate()

  const { data: zones = [] } = useQuery({ queryKey: ['zones'], queryFn: api.listZones })
  const { data: images = [] } = useQuery({ queryKey: ['images'], queryFn: api.listImages })
  const { data: machineTypes = [] } = useQuery({
    queryKey: ['machineTypes'],
    queryFn: api.listMachineTypes,
  })

  const [name, setName] = useState('')
  const [zone, setZone] = useState('')
  const [machineType, setMachineType] = useState('hl-standard-2')
  const [cpus, setCpus] = useState(2)
  const [memoryMb, setMemoryMb] = useState(2048)
  const [diskGb, setDiskGb] = useState(10)
  const [imageId, setImageId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () =>
      api.createInstance(current!.name, {
        name,
        zone,
        machineType,
        cpus: machineType === 'custom' ? cpus : undefined,
        memoryMb: machineType === 'custom' ? memoryMb : undefined,
        diskGb,
        imageId,
      }),
    onSuccess: () => navigate('/compute/instances'),
    onError: (e: Error) => setError(e.message),
  })

  const valid = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(name) && zone && imageId

  return (
    <Box sx={{ p: 3, maxWidth: 640 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/compute/instances')}
        >
          Back
        </Button>
        <Typography variant="h5">Create an instance</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <TextField
          label="Name"
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          helperText="Lowercase letters, numbers, hyphens. Must start with a letter."
          fullWidth
        />
        <TextField
          label="Zone"
          size="small"
          select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          fullWidth
        >
          {zones.map((z) => (
            <MenuItem key={z.id} value={z.id}>
              {z.name} ({z.status})
            </MenuItem>
          ))}
        </TextField>

        <Divider textAlign="left">Machine configuration</Divider>
        <TextField
          label="Machine type"
          size="small"
          select
          value={machineType}
          onChange={(e) => setMachineType(e.target.value)}
          fullWidth
        >
          {machineTypes.map((mt) => (
            <MenuItem key={mt.name} value={mt.name}>
              {mt.name} — {mt.description}
            </MenuItem>
          ))}
          <MenuItem value="custom">custom — choose vCPU and memory</MenuItem>
        </TextField>
        {machineType === 'custom' && (
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="vCPUs"
              size="small"
              type="number"
              value={cpus}
              onChange={(e) => setCpus(Number(e.target.value))}
              slotProps={{ htmlInput: { min: 1, max: 64 } }}
            />
            <TextField
              label="Memory (MB)"
              size="small"
              type="number"
              value={memoryMb}
              onChange={(e) => setMemoryMb(Number(e.target.value))}
              slotProps={{ htmlInput: { min: 128, step: 128 } }}
            />
          </Box>
        )}

        <Divider textAlign="left">Boot disk</Divider>
        <TextField
          label="Image"
          size="small"
          select
          value={imageId}
          onChange={(e) => setImageId(e.target.value)}
          helperText={images.length === 0 ? 'No templates found on the hypervisor' : undefined}
          fullWidth
        >
          {images.map((img) => (
            <MenuItem key={img.id} value={img.id}>
              {img.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Disk size (GB)"
          size="small"
          type="number"
          value={diskGb}
          onChange={(e) => setDiskGb(Number(e.target.value))}
          slotProps={{ htmlInput: { min: 1 } }}
          sx={{ maxWidth: 200 }}
        />

        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Button
            variant="contained"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
          <Button onClick={() => navigate('/compute/instances')}>Cancel</Button>
        </Box>
      </Paper>
    </Box>
  )
}
