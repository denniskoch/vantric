import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { AIGateway, AIGatewayRequest } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe } from '../validation'

const backTo = '/ai/connection'

function GatewayForm({ editing }: { editing: AIGateway | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AIGatewayRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          baseUrl: editing.baseUrl,
          token: '', // blank keeps the stored token
          insecureTls: editing.insecureTls,
        }
      : { name: '', type: 'bifrost', baseUrl: '', token: '', insecureTls: false },
  )
  const [error, setError] = useState<string | null>(null)

  const { data: types = ['bifrost'] } = useQuery({
    queryKey: ['aiGatewayTypes'],
    queryFn: api.listAIGatewayTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing ? api.updateAIGateway(editing.id, form) : api.createAIGateway(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiGateways'] })
      queryClient.invalidateQueries({ queryKey: ['aiRequests'] })
      queryClient.invalidateQueries({ queryKey: ['aiFilters'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  // No token in the test, unlike every other backend form here: a
  // gateway with its management API open is the ordinary case.
  const valid = resourceNameRe.test(form.name) && /^https?:\/\/\S+$/.test(form.baseUrl)

  return (
    <FormPage
      title={editing ? `Edit ${editing.name}` : 'Connect AI gateway'}
      backTo={backTo}
      backLabel="Connection"
      error={error}
      onDismissError={() => setError(null)}
      notice="The gateway is checked before it's saved. Bifrost's management API is open unless you've turned auth on, so a credential is usually not needed."
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
        helperText={nameError ?? 'What this console calls it. e.g. bifrost'}
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
        placeholder="https://bifrost.example.com"
        helperText="The gateway's root, without /api"
        fullWidth
      />
      <TextField
        label="Credential"
        size="small"
        type="password"
        value={form.token}
        onChange={(e) => setForm({ ...form, token: e.target.value })}
        helperText={
          editing?.hasToken
            ? 'Leave blank to keep the current credential'
            : 'Only if auth is enabled. The admin account as user:password — a virtual key signs inference, not this API.'
        }
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

export default function AIGatewayFormPage() {
  const { id } = useParams()
  const { data: gateways = [], isLoading } = useQuery({
    queryKey: ['aiGateways'],
    queryFn: api.listAIGateways,
    enabled: Boolean(id),
  })

  if (id && isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading gateway…</Typography>
      </Box>
    )
  }
  return <GatewayForm editing={gateways.find((g) => g.id === id) ?? null} />
}
