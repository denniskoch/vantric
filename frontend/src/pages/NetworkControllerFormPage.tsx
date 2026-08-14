import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Box, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { NetworkProvider, NetworkProviderRequest, NetworkProviderType } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe, urlError } from '../validation'

const backTo = '/network/controllers'

const emptyForm: NetworkProviderRequest = {
  name: '',
  type: 'unifi',
  baseUrl: '',
  site: 'default',
  apiKey: '',
  username: '',
  password: '',
  insecureTls: true,
}

function ControllerForm({ editing }: { editing: NetworkProvider | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<NetworkProviderRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          baseUrl: editing.baseUrl,
          site: editing.site,
          apiKey: '', // blank keeps what's stored
          username: editing.username,
          password: '',
          insecureTls: editing.insecureTls,
        }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)

  const { data: types = ['unifi' as NetworkProviderType] } = useQuery({
    queryKey: ['networkProviderTypes'],
    queryFn: api.listNetworkProviderTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updateNetworkProvider(editing.id, form)
        : api.createNetworkProvider(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networkProviders'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const baseUrlError = urlError(form.baseUrl)
  const hasCredentials =
    form.apiKey !== '' || form.password !== '' || Boolean(editing?.hasCredentials)
  const valid =
    resourceNameRe.test(form.name) && form.baseUrl !== '' && !baseUrlError && hasCredentials

  return (
    <FormPage
      title={editing ? `Edit ${editing.name}` : 'Add network controller'}
      backTo={backTo}
      backLabel="Controllers"
      error={error}
      onDismissError={() => setError(null)}
      notice={
        <>
          Credentials are checked against the controller before it's saved, and
          a read-only account is enough — this console only reads. A
          self-hosted Network Application usually wants a local account and
          lives on <code>:8443</code>; a UniFi OS console (Dream Machine, Cloud
          Key) can issue a local API key under Control Plane → Integrations. A
          key from <code>unifi.ui.com</code> is for the cloud Site Manager API
          and won't authenticate here.
        </>
      }
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
        helperText={nameError ?? 'What this console calls it. e.g. unifi'}
        fullWidth
      />
      <TextField
        label="Type"
        size="small"
        select
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value as NetworkProviderType })}
        fullWidth
      >
        {types.map((type) => (
          <MenuItem key={type} value={type}>
            {type === 'unifi' ? 'UniFi Network' : type}
          </MenuItem>
        ))}
      </TextField>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Controller URL"
          size="small"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          placeholder="https://192.168.1.1"
          error={Boolean(baseUrlError)}
          helperText={baseUrlError ?? 'Self-hosted is usually https://host:8443'}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Site"
          size="small"
          value={form.site}
          onChange={(e) => setForm({ ...form, site: e.target.value })}
          helperText="'default' unless renamed"
          sx={{ width: 180 }}
        />
      </Box>

      <TextField
        label="API key"
        size="small"
        type="password"
        value={form.apiKey}
        onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        helperText={
          editing?.hasCredentials
            ? 'Leave blank to keep what is stored'
            : 'UniFi OS consoles only. Self-hosted installs use the account below.'
        }
        fullWidth
      />
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Username"
          size="small"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          helperText="Local controller account, read-only is enough"
          sx={{ flex: 1 }}
        />
        <TextField
          label="Password"
          size="small"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          helperText={editing?.hasCredentials ? 'Leave blank to keep the current one' : ' '}
          sx={{ flex: 1 }}
        />
      </Box>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={form.insecureTls}
            onChange={(e) => setForm({ ...form, insecureTls: e.target.checked })}
          />
        }
        label="Allow self-signed TLS certificate (controllers ship with one)"
      />
    </FormPage>
  )
}

export default function NetworkControllerFormPage() {
  const { id } = useParams()
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['networkProviders'],
    queryFn: api.listNetworkProviders,
    enabled: Boolean(id),
  })

  if (id && isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading controller…</Typography>
      </Box>
    )
  }
  return <ControllerForm editing={providers.find((p) => p.id === id) ?? null} />
}
