import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { StorageProvider, StorageProviderRequest, StorageProviderType } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe, urlError } from '../validation'

const backTo = '/storage/instances'
const typeLabels: Record<string, string> = { rustfs: 'RustFS' }

function InstanceForm({ editing }: { editing: StorageProvider | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<StorageProviderRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          baseUrl: editing.baseUrl,
          accessKey: editing.accessKey,
          secretKey: '', // blank keeps the stored key
          region: editing.region,
          insecureTls: editing.insecureTls,
        }
      : {
          name: '',
          type: 'rustfs',
          baseUrl: '',
          accessKey: '',
          secretKey: '',
          region: '',
          insecureTls: false,
        },
  )
  const [error, setError] = useState<string | null>(null)

  const { data: types = ['rustfs' as StorageProviderType] } = useQuery({
    queryKey: ['storageProviderTypes'],
    queryFn: api.listStorageProviderTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updateStorageProvider(editing.id, form)
        : api.createStorageProvider(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storageProviders'] })
      queryClient.invalidateQueries({ queryKey: ['buckets'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const endpointError = form.baseUrl ? urlError(form.baseUrl) : null
  const valid =
    resourceNameRe.test(form.name) &&
    form.baseUrl.trim() !== '' &&
    !endpointError &&
    form.accessKey.trim() !== '' &&
    (form.secretKey !== '' || Boolean(editing?.hasSecret))

  return (
    <FormPage
      title={editing ? `Edit ${editing.name}` : 'Add an object store'}
      backTo={backTo}
      backLabel="Object stores"
      error={error}
      onDismissError={() => setError(null)}
      notice="The keys are checked against the store before it's saved, so a saved store is one that works. The secret key is never shown again."
      primaryLabel={editing ? 'Save' : 'Connect'}
      pendingLabel="Connecting…"
      primaryDisabled={!valid}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <TextField
        label="Name"
        size="small"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        error={Boolean(nameError)}
        helperText={nameError ?? 'What this console calls it'}
        fullWidth
      />
      <TextField
        label="Type"
        size="small"
        select
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value as StorageProviderType })}
        fullWidth
      >
        {types.map((t) => (
          <MenuItem key={t} value={t}>
            {typeLabels[t] ?? t}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Endpoint"
        size="small"
        value={form.baseUrl}
        onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
        placeholder="http://192.168.1.10:9000"
        error={Boolean(endpointError)}
        helperText={endpointError ?? 'The S3 API address — not the web console port'}
        fullWidth
      />
      <TextField
        label="Access key"
        size="small"
        value={form.accessKey}
        onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
        fullWidth
      />
      <TextField
        label="Secret key"
        size="small"
        type="password"
        value={form.secretKey}
        onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
        helperText={editing?.hasSecret ? 'Leave blank to keep the current key' : ' '}
        fullWidth
      />
      <TextField
        label="Region (optional)"
        size="small"
        value={form.region}
        onChange={(e) => setForm({ ...form, region: e.target.value })}
        helperText="Blank uses us-east-1. A store outside a cloud has no region, but the signature needs one."
        fullWidth
      />
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={form.insecureTls}
            onChange={(e) => setForm({ ...form, insecureTls: e.target.checked })}
          />
        }
        label="Accept a self-signed certificate"
      />
    </FormPage>
  )
}

export default function StorageInstanceFormPage() {
  const { id } = useParams()
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
    enabled: Boolean(id),
  })
  if (id && isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    )
  }
  return <InstanceForm editing={providers.find((p) => p.id === id) ?? null} />
}
