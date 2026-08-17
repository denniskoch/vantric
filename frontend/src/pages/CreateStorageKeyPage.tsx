import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import FormPage from '../components/FormPage'
import SecretField, { generateSecret } from '../components/SecretField'
import { policySummary, policyWarning } from '../storagePolicy'
import { accessKeyError, secretKeyError } from '../validation'

/**
 * Creating an access key on a store.
 *
 * The secret is generated here and shown while you fill the form in,
 * because this is the only moment it exists anywhere you can read it —
 * the store won't give it back and this console doesn't keep a copy.
 * That's the same rule the SSH private key follows: write-only in every
 * direction.
 */
export default function CreateStorageKeyPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState(generateSecret)
  const [policy, setPolicy] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
  })
  const connected = providers.filter((p) => p.status === 'connected')
  if (!providerId && connected.length > 0) setProviderId(connected[0].id)

  const { data: policies = [] } = useQuery({
    queryKey: ['storagePolicies', providerId],
    queryFn: () => api.listStoragePolicies(providerId),
    enabled: Boolean(providerId),
  })

  const create = useMutation({
    mutationFn: () =>
      api.createStorageUser(providerId, {
        accessKey: accessKey.trim(),
        secretKey,
        policy,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storageUsers'] })
      navigate('/storage/keys')
    },
    onError: (e: Error) => setError(e.message),
  })

  const keyError = accessKeyError(accessKey)
  const secretError = secretKeyError(secretKey)
  const valid =
    Boolean(providerId) && accessKey.trim() !== '' && !keyError && Boolean(secretKey) && !secretError

  const chosen = policies.find((p) => p.name === policy)
  const warning = chosen ? policyWarning(chosen) : null

  return (
    <FormPage
      title="Create an access key"
      backTo="/storage/keys"
      backLabel="Access keys"
      error={error}
      onDismissError={() => setError(null)}
      notice="Copy the secret before you save. The store won't show it again and this console doesn't keep a copy — a lost secret means replacing the key, not recovering it."
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
        onChange={(e) => {
          setProviderId(e.target.value)
          // Policies are the other store's names; keeping the selection
          // would submit one that doesn't exist there.
          setPolicy('')
        }}
        helperText="Which object store this key signs against"
        fullWidth
      >
        {providers.map((p) => (
          <MenuItem key={p.id} value={p.id} disabled={p.status !== 'connected'}>
            {p.name} ({p.status})
          </MenuItem>
        ))}
      </TextField>

      <TextField
        label="Access key"
        size="small"
        value={accessKey}
        onChange={(e) => setAccessKey(e.target.value)}
        error={Boolean(keyError)}
        helperText={keyError ?? 'The name the client signs with, e.g. backups or registry'}
        fullWidth
      />

      <SecretField
        label="Secret key"
        value={secretKey}
        onChange={setSecretKey}
        error={secretError}
        helperText="Generated in your browser. Copy it now — this is the only time it's readable."
      />

      <TextField
        label="Policy"
        size="small"
        select
        value={policy}
        onChange={(e) => setPolicy(e.target.value)}
        helperText="What this key is allowed to do. The store's own named policies."
        fullWidth
      >
        {/* A key with no policy is a real, and sometimes deliberate,
            answer — it can sign requests and reach nothing until you
            decide what it should reach. */}
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
      </TextField>

      {warning && <Alert severity="warning">{warning}</Alert>}
    </FormPage>
  )
}
