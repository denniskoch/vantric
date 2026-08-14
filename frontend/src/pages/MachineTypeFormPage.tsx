import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Box, TextField } from '@mui/material'
import { api } from '../api/client'
import type { MachineType } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe } from '../validation'

const backTo = '/compute/settings/machine-types'

export default function MachineTypeFormPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<MachineType>({
    name: '',
    description: '',
    cpus: 1,
    memoryMb: 1024,
  })
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api.createMachineType(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['machineTypes'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const valid = resourceNameRe.test(form.name) && form.cpus >= 1 && form.memoryMb >= 128

  return (
    <FormPage
      title="Create machine type"
      backTo={backTo}
      backLabel="Machine types"
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Create"
      primaryDisabled={!valid}
      pending={create.isPending}
      onPrimary={() => create.mutate()}
    >
      <TextField
        label="Name"
        size="small"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        error={Boolean(nameError)}
        helperText={nameError ?? 'Lowercase letters, numbers, hyphens. e.g. hl-standard-8'}
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
          sx={{ flex: 1 }}
        />
        <TextField
          label="Memory (MB)"
          size="small"
          type="number"
          value={form.memoryMb}
          onChange={(e) => setForm({ ...form, memoryMb: Number(e.target.value) })}
          slotProps={{ htmlInput: { min: 128, step: 128 } }}
          sx={{ flex: 1 }}
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
    </FormPage>
  )
}
