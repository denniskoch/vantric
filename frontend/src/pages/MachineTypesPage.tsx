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
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

export default function MachineTypesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['machineTypes'],
    queryFn: api.listMachineTypes,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['machineTypes'] })

  const remove = useMutation({
    mutationFn: (name: string) => api.deleteMachineType(name),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Machine types"
        actions={
          <>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
              onClick={() => navigate('/compute/settings/machine-types/create')}
            >
              Create machine type
            </Button>
          </>
        }
        description={
          <>
                Sizing presets offered when creating an instance. Deleting a type
            doesn't affect existing instances.
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

    </Box>
  )
}
