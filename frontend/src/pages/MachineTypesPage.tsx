import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { MachineType } from '../api/client'

const emptyForm: MachineType = { name: '', description: '', cpus: 1, memoryMb: 1024 }

export default function MachineTypesPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<MachineType>(emptyForm)
  const [error, setError] = useState<string | null>(null)

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['machineTypes'],
    queryFn: api.listMachineTypes,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['machineTypes'] })

  const create = useMutation({
    mutationFn: () => api.createMachineType(form),
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      setForm(emptyForm)
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (name: string) => api.deleteMachineType(name),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const validName = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(form.name)

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
        <Typography variant="h5">Machine types</Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddBoxIcon />}
          onClick={() => setDialogOpen(true)}
        >
          Create machine type
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Sizing presets offered when creating an instance. Deleting a type
        doesn't affect existing instances.
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
              <TableCell>Name</TableCell>
              <TableCell align="right">vCPUs</TableCell>
              <TableCell align="right">Memory (MB)</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {types.map((mt) => (
              <TableRow key={mt.name} hover>
                <TableCell>{mt.name}</TableCell>
                <TableCell align="right">{mt.cpus}</TableCell>
                <TableCell align="right">{mt.memoryMb}</TableCell>
                <TableCell>{mt.description}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={() => remove.mutate(mt.name)}
                    disabled={remove.isPending}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {types.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No machine types configured.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Create machine type</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          <TextField
            label="Name"
            size="small"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            helperText="Lowercase letters, numbers, hyphens. e.g. hl-standard-8"
            fullWidth
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="vCPUs"
              size="small"
              type="number"
              value={form.cpus}
              onChange={(e) => setForm({ ...form, cpus: Number(e.target.value) })}
              slotProps={{ htmlInput: { min: 1, max: 128 } }}
            />
            <TextField
              label="Memory (MB)"
              size="small"
              type="number"
              value={form.memoryMb}
              onChange={(e) => setForm({ ...form, memoryMb: Number(e.target.value) })}
              slotProps={{ htmlInput: { min: 128, step: 128 } }}
            />
          </Box>
          <TextField
            label="Description (optional)"
            size="small"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            helperText="Defaults to a summary like '2 vCPU, 2 GB'"
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!validName || form.cpus < 1 || form.memoryMb < 128 || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
