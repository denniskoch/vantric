import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { InventoryProvider, InventoryProviderRequest } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe } from '../validation'

const backTo = '/devices/settings/inventory'

function ProviderForm({ editing }: { editing: InventoryProvider | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<InventoryProviderRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          baseUrl: editing.baseUrl,
          token: '', // blank keeps the stored token
          insecureTls: editing.insecureTls,
        }
      : { name: '', type: 'fleet', baseUrl: '', token: '', insecureTls: false },
  )
  const [error, setError] = useState<string | null>(null)

  const { data: types = ['fleet'] } = useQuery({
    queryKey: ['inventoryProviderTypes'],
    queryFn: api.listInventoryProviderTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updateInventoryProvider(editing.id, form)
        : api.createInventoryProvider(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryProviders'] })
      // Every guest's OS Info tab depends on this connection.
      queryClient.invalidateQueries({ queryKey: ['instanceInventory'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const valid =
    resourceNameRe.test(form.name) &&
    /^https?:\/\/\S+$/.test(form.baseUrl) &&
    (form.token !== '' || Boolean(editing?.hasToken))

  return (
    <FormPage
      title={editing ? `Edit ${editing.name}` : 'Connect inventory service'}
      backTo={backTo}
      backLabel="Inventory"
      error={error}
      onDismissError={() => setError(null)}
      notice="The token is checked against the API before the service is saved, so a saved one works. Fleet needs the token of an API-only user; a token copied from a browser session is refused."
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
        helperText={nameError ?? 'What this console calls it. e.g. fleet'}
        fullWidth
      />
      <TextField
        label="Type"
        size="small"
        select
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value })}
        fullWidth
      >
        {types.map((type) => (
          <MenuItem key={type} value={type}>
            {type}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Base URL"
        size="small"
        value={form.baseUrl}
        onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
        placeholder="https://fleet.example.com"
        helperText="The service's root, without /api"
        fullWidth
      />
      <TextField
        label="API token"
        size="small"
        type="password"
        value={form.token}
        onChange={(e) => setForm({ ...form, token: e.target.value })}
        helperText={editing?.hasToken ? 'Leave blank to keep the current token' : ' '}
        fullWidth
      />
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={form.insecureTls ?? false}
            onChange={(e) => setForm({ ...form, insecureTls: e.target.checked })}
          />
        }
        label="Allow a self-signed certificate"
      />
    </FormPage>
  )
}

export default function InventoryProviderFormPage() {
  const { id } = useParams()
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['inventoryProviders'],
    queryFn: api.listInventoryProviders,
    enabled: Boolean(id),
  })

  if (id && isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading service…</Typography>
      </Box>
    )
  }
  return <ProviderForm editing={providers.find((p) => p.id === id) ?? null} />
}
