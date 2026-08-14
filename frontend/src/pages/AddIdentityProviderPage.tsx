import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import type {
  IdentityProvider,
  IdentityProviderRequest,
  IdentityProviderType,
} from '../api/client'
import { providerLabels } from '../identity'
import { resourceNameError, resourceNameRe, urlError } from '../validation'

const emptyForm: IdentityProviderRequest = {
  name: '',
  type: 'authentik',
  baseUrl: '',
  token: '',
  insecureTls: false,
}

function ProviderForm({ editing }: { editing: IdentityProvider | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<IdentityProviderRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          baseUrl: editing.baseUrl,
          token: '', // blank keeps the stored one
          insecureTls: editing.insecureTls,
        }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)

  const { data: types = ['authentik' as IdentityProviderType] } = useQuery({
    queryKey: ['identityProviderTypes'],
    queryFn: api.listIdentityProviderTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updateIdentityProvider(editing.id, form)
        : api.createIdentityProvider(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identityProviders'] })
      navigate('/identity/providers')
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const baseUrlError = urlError(form.baseUrl)
  const valid =
    resourceNameRe.test(form.name) &&
    form.baseUrl !== '' &&
    !baseUrlError &&
    (form.token !== '' || Boolean(editing?.hasToken))

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/identity/providers')}
        >
          Providers
        </Button>
        <Typography variant="h5">
          {editing ? `Edit ${editing.name}` : 'Add identity provider'}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2, maxWidth: 680 }}>
          {error}
        </Alert>
      )}
      <Alert severity="info" sx={{ mb: 2, maxWidth: 680 }}>
        The token is checked against the API before the provider is saved. In
        authentik, create one under Directory → Tokens with an account that can
        administer users — a token that can only read itself won't do.
      </Alert>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 680 }}>
        <TextField
          label="Name"
          size="small"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={Boolean(nameError)}
          helperText={nameError ?? 'What this console calls it. e.g. authentik'}
          fullWidth
        />
        <TextField
          label="Type"
          size="small"
          select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as IdentityProviderType })}
          fullWidth
        >
          {types.map((type) => (
            <MenuItem key={type} value={type}>
              {providerLabels[type] ?? type}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="URL"
          size="small"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          placeholder="https://auth.example.com"
          error={Boolean(baseUrlError)}
          helperText={baseUrlError ?? "The root, not the API path — /api/v3 is added for you"}
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
              checked={form.insecureTls}
              onChange={(e) => setForm({ ...form, insecureTls: e.target.checked })}
            />
          }
          label="Allow self-signed TLS certificate"
        />
      </Box>

      {/* Persistent action bar, GCP-style */}
      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 3, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Connecting…' : editing ? 'Save' : 'Connect'}
        </Button>
        <Button onClick={() => navigate('/identity/providers')}>Cancel</Button>
      </Box>
    </Box>
  )
}

export default function AddIdentityProviderPage() {
  const { id } = useParams()
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['identityProviders'],
    queryFn: api.listIdentityProviders,
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
