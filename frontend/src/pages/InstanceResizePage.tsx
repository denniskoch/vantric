import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, TextField, Typography } from '@mui/material'
import FormPage from '../components/FormPage'
import { api } from '../api/client'

/**
 * Changing an instance's vCPU and memory.
 *
 * Only while it's stopped, and the page says so rather than failing at
 * submit: Proxmox accepts a core change on a running guest and applies
 * it at the next boot, which would let this report success over a
 * machine still running the old shape.
 */
export default function InstanceResizePage() {
  const { name = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cpus, setCpus] = useState(0)
  const [memoryMb, setMemoryMb] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const { data: instance } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name),
    enabled: Boolean(name),
  })

  // Start from what it has, once it's known.
  useEffect(() => {
    if (!instance) return
    setCpus((c) => (c === 0 ? instance.cpus : c))
    setMemoryMb((m) => (m === 0 ? instance.memoryMb : m))
  }, [instance])

  const running = instance ? instance.status !== 'TERMINATED' : false
  const resize = useMutation({
    mutationFn: () => api.resizeInstance(name, { cpus, memoryMb }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance', name] })
      queryClient.invalidateQueries({ queryKey: ['instanceDetail', name] })
      navigate(`/compute/instances/${encodeURIComponent(name)}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  // Only once the instance has loaded. Both fields start at zero while
  // the fetch is in flight, so validating before then paints the form
  // red on arrival and tells somebody off for nothing — the opposite of
  // what showing validation is for.
  const loaded = Boolean(instance)
  const cpuError = loaded && cpus < 1 ? 'At least one vCPU' : ''
  const memoryError = loaded && memoryMb < 128 ? 'At least 128 MB' : ''

  return (
    <FormPage
      title={`Resize ${name}`}
      backTo={`/compute/instances/${encodeURIComponent(name)}`}
      backLabel={name}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Resize"
      primaryDisabled={!loaded || running || Boolean(cpuError) || Boolean(memoryError)}
      pending={resize.isPending}
      onPrimary={() => {
        setError(null)
        resize.mutate()
      }}
    >
      {running && (
        <Alert severity="info">
          {name} is {instance?.status.toLowerCase()}. Stop it before changing its CPU
          or memory — a running guest would accept the change and keep running on
          the old shape until something restarted it.
        </Alert>
      )}
      <TextField
        label="vCPUs"
        type="number"
        value={cpus || ''}
        onChange={(e) => setCpus(Number(e.target.value))}
        error={Boolean(cpuError)}
        helperText={cpuError || ' '}
        disabled={running}
        slotProps={{ htmlInput: { min: 1 } }}
        sx={{ width: 160 }}
      />
      <TextField
        label="Memory (MB)"
        type="number"
        value={memoryMb || ''}
        onChange={(e) => setMemoryMb(Number(e.target.value))}
        error={Boolean(memoryError)}
        helperText={memoryError || ' '}
        disabled={running}
        slotProps={{ htmlInput: { min: 128, step: 128 } }}
        sx={{ width: 200 }}
      />
      <Typography variant="body2" color="text.secondary">
        The guest sees the new sizing when it next starts.
      </Typography>
    </FormPage>
  )
}
