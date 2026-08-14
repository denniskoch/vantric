import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { DNSProvider, DNSProviderRequest, DNSProviderType } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe } from '../validation'

const backTo = '/dns/providers'

function ProviderForm({ editing }: { editing: DNSProvider | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<DNSProviderRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          token: '', // blank keeps the stored token
          accountId: editing.accountId,
        }
      : { name: '', type: 'cloudflare', token: '', accountId: '' },
  )
  const [error, setError] = useState<string | null>(null)

  const { data: types = ['cloudflare' as DNSProviderType] } = useQuery({
    queryKey: ['dnsProviderTypes'],
    queryFn: api.listDNSProviderTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing ? api.updateDNSProvider(editing.id, form) : api.createDNSProvider(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dnsProviders'] })
      queryClient.invalidateQueries({ queryKey: ['dnsZones'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const valid =
    resourceNameRe.test(form.name) && (form.token !== '' || Boolean(editing?.hasToken))

  return (
    <FormPage
      title={editing ? `Edit ${editing.name}` : 'Add DNS provider'}
      backTo={backTo}
      backLabel="Providers"
      error={error}
      onDismissError={() => setError(null)}
      notice="The token is checked against the API before the provider is saved, so a saved provider is one that works. It needs permission to read and edit zones."
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
        helperText={nameError ?? 'What this console calls it. e.g. cloudflare'}
        fullWidth
      />
      <TextField
        label="Type"
        size="small"
        select
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value as DNSProviderType })}
        fullWidth
      >
        {types.map((type) => (
          <MenuItem key={type} value={type}>
            {type}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="API token"
        size="small"
        type="password"
        value={form.token}
        onChange={(e) => setForm({ ...form, token: e.target.value })}
        helperText={editing?.hasToken ? 'Leave blank to keep the current token' : ' '}
        fullWidth
      />
      <TextField
        label="Account ID (optional)"
        size="small"
        value={form.accountId}
        onChange={(e) => setForm({ ...form, accountId: e.target.value })}
        helperText="Which account new zones are created in; blank uses the provider's default"
        fullWidth
      />
    </FormPage>
  )
}

export default function DNSProviderFormPage() {
  const { id } = useParams()
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['dnsProviders'],
    queryFn: api.listDNSProviders,
    enabled: Boolean(id),
  })

  if (id && isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading provider…</Typography>
      </Box>
    )
  }
  return <ProviderForm editing={providers.find((p) => p.id === id) ?? null} />
}
