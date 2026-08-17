import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, MenuItem, TextField, Typography } from '@mui/material'
import SelectField from '../components/SelectField'
import { api } from '../api/client'
import FormPage from '../components/FormPage'
import { policySummary, policyWarning } from '../storagePolicy'

/**
 * Editing one access key: what it may do, and whether it works at all.
 *
 * The secret isn't here. Replacing it is its own page because it's a
 * different decision with a different consequence — this page can be
 * saved without anything stopping working, and that one can't.
 */
export default function StorageKeyPage() {
  const { providerId = '', accessKey = '' } = useParams()
  const key = decodeURIComponent(accessKey)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [policy, setPolicy] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['storageUsers'],
    queryFn: () => api.listStorageUsers(),
  })
  const { data: policies = [] } = useQuery({
    queryKey: ['storagePolicies', providerId],
    queryFn: () => api.listStoragePolicies(providerId),
    enabled: Boolean(providerId),
  })
  const { data: providers = [] } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
  })

  const user = users.find((u) => u.providerId === providerId && u.accessKey === key)
  const storeName = providers.find((p) => p.id === providerId)?.name ?? providerId

  // Seeded once from what the store says, then left alone: the list
  // behind this page polls, and re-reading every render would overwrite
  // a selection mid-edit.
  if (user && policy === null) setPolicy(user.policy)
  if (user && enabled === null) setEnabled(user.enabled)

  const save = useMutation({
    mutationFn: async () => {
      if (policy !== user!.policy) {
        await api.setStorageUserPolicy(providerId, key, policy ?? '')
      }
      if (enabled !== user!.enabled) {
        await api.setStorageUserStatus(providerId, key, enabled ?? true)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storageUsers'] })
      navigate('/storage/keys')
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!user && !isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">No access key named {key} on this store.</Alert>
      </Box>
    )
  }

  const chosen = policies.find((p) => p.name === policy)
  const warning = chosen ? policyWarning(chosen) : null
  const dirty = Boolean(user) && (policy !== user!.policy || enabled !== user!.enabled)

  return (
    <FormPage
      title={key}
      backTo="/storage/keys"
      backLabel="Access keys"
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Save"
      pendingLabel="Saving…"
      primaryDisabled={!dirty}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <TextField label="Store" size="small" value={storeName} fullWidth disabled />

      <TextField
        label="Status"
        size="small"
        select
        value={enabled === null ? '' : enabled ? 'enabled' : 'disabled'}
        onChange={(e) => setEnabled(e.target.value === 'enabled')}
        helperText="A disabled key is refused by the store without being deleted — the way to stop something without losing the ability to start it again."
        fullWidth
      >
        <MenuItem value="enabled">Enabled</MenuItem>
        <MenuItem value="disabled">Disabled</MenuItem>
      </TextField>

      <SelectField
        label="Policy"
        size="small"
        value={policy ?? ''}
        onChange={(e) => setPolicy(e.target.value)}
        helperText="Attaching a policy replaces the one that's there, so lowering access is a real reduction."
        fullWidth
      >
        <MenuItem value="">
          <em>None — no access until a policy is attached</em>
        </MenuItem>
        {policies.map((p) => (
          <MenuItem key={p.name} value={p.name}>
            <Box>
              <Typography variant="body2">{p.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {policySummary(p)}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </SelectField>

      {warning && <Alert severity="warning">{warning}</Alert>}
    </FormPage>
  )
}
