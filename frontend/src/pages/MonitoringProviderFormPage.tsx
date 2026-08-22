import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { MonitoringProvider, MonitoringProviderRequest } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe } from '../validation'

const backTo = '/monitoring/settings/service'

function ProviderForm({ editing }: { editing: MonitoringProvider | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<MonitoringProviderRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          baseUrl: editing.baseUrl,
          token: '', // blank keeps the stored token
          insecureTls: editing.insecureTls,
        }
      : { name: '', type: 'zabbix', baseUrl: '', token: '', insecureTls: false },
  )
  const [error, setError] = useState<string | null>(null)

  const { data: types = ['zabbix'] } = useQuery({
    queryKey: ['monitoringProviderTypes'],
    queryFn: api.listMonitoringProviderTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updateMonitoringProvider(editing.id, form)
        : api.createMonitoringProvider(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitoringProviders'] })
      queryClient.invalidateQueries({ queryKey: ['monitoringProblems'] })
      queryClient.invalidateQueries({ queryKey: ['monitoringHosts'] })
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
      title={editing ? `Edit ${editing.name}` : 'Connect monitoring service'}
      backTo={backTo}
      backLabel="Monitoring service"
      error={error}
      onDismissError={() => setError(null)}
      notice="The token is checked by reading the service with it before anything is saved. Zabbix wants an API token from a read-only user whose role allow-lists host.get, problem.get and event.get."
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
        helperText={nameError ?? 'What this console calls it. e.g. zabbix'}
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
        placeholder="https://zabbix.example.com"
        helperText="The server's root. A /zabbix prefix is found automatically"
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

export default function MonitoringProviderFormPage() {
  const { id } = useParams()
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['monitoringProviders'],
    queryFn: api.listMonitoringProviders,
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
