import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { AIAccount, AIAccountRequest } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe } from '../validation'

const backTo = '/ai/accounts'

/** What kind of key each provider wants, since it is not the one you
 *  already gave the gateway. */
const keyHelp: Record<string, string> = {
  openrouter:
    'A MANAGEMENT key from openrouter.ai/settings/management-keys — not your sk-or-v1 inference key, which this endpoint refuses.',
}

function AccountForm({ editing }: { editing: AIAccount | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AIAccountRequest>(
    editing
      ? { name: editing.name, type: editing.type, key: '' }
      : { name: '', type: 'openrouter', key: '' },
  )
  const [error, setError] = useState<string | null>(null)

  const { data: types = ['openrouter'] } = useQuery({
    queryKey: ['aiAccountTypes'],
    queryFn: api.listAIAccountTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing ? api.updateAIAccount(editing.id, form) : api.createAIAccount(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiAccounts'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const valid =
    resourceNameRe.test(form.name) && (Boolean(form.key) || Boolean(editing?.hasKey))

  return (
    <FormPage
      title={editing ? `Edit ${editing.name}` : 'Add provider account'}
      backTo={backTo}
      backLabel="Provider accounts"
      error={error}
      onDismissError={() => setError(null)}
      notice="The key is checked by reading the balance with it, so a saved account is one that answers."
      primaryLabel={editing ? 'Save' : 'Add'}
      pendingLabel="Checking…"
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
        helperText={nameError ?? 'What this console calls it. e.g. openrouter'}
        fullWidth
      />
      <TextField
        label="Provider"
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
        label="API key"
        size="small"
        type="password"
        value={form.key}
        onChange={(e) => setForm({ ...form, key: e.target.value })}
        helperText={
          editing?.hasKey
            ? 'Leave blank to keep the current key'
            : (keyHelp[form.type ?? ''] ?? ' ')
        }
        fullWidth
      />
    </FormPage>
  )
}

export default function AIAccountFormPage() {
  const { id } = useParams()
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['aiAccounts'],
    queryFn: api.listAIAccounts,
    enabled: Boolean(id),
  })

  if (id && isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading account…</Typography>
      </Box>
    )
  }
  return <AccountForm editing={accounts.find((a) => a.id === id) ?? null} />
}
