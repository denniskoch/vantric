import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MenuItem, TextField } from '@mui/material'
import { api } from '../api/client'
import FormPage from '../components/FormPage'
import { bucketNameError } from '../validation'

export default function CreateBucketPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
  })
  const connected = providers.filter((p) => p.status === 'connected')
  if (!providerId && connected.length > 0) setProviderId(connected[0].id)

  const create = useMutation({
    mutationFn: () =>
      api.createBucket(providerId, { name: name.trim().toLowerCase() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buckets'] })
      navigate('/storage/buckets')
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = bucketNameError(name)
  const valid = Boolean(providerId) && name.trim() !== '' && !nameError

  return (
    <FormPage
      title="Create a bucket"
      backTo="/storage/buckets"
      backLabel="Buckets"
      error={error}
      onDismissError={() => setError(null)}
      notice="A bucket name is checked against S3's rules, not this console's: it reaches DNS, so it has to be lowercase and can't look like an IP address."
      primaryLabel="Create"
      pendingLabel="Creating…"
      primaryDisabled={!valid}
      pending={create.isPending}
      onPrimary={() => create.mutate()}
    >
      <TextField
        label="Store"
        size="small"
        select
        value={providerId}
        onChange={(e) => setProviderId(e.target.value)}
        helperText="Which object store this bucket is created on"
        fullWidth
      >
        {providers.map((p) => (
          <MenuItem key={p.id} value={p.id} disabled={p.status !== 'connected'}>
            {p.name} ({p.status})
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Name"
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={Boolean(nameError)}
        helperText={nameError ?? 'Lowercase letters, digits, dots and hyphens'}
        fullWidth
      />
    </FormPage>
  )
}
