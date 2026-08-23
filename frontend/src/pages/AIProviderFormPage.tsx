import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  TextField,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import SelectField from '../components/SelectField'
import ProviderName from '../components/ProviderName'

/**
 * Connecting an upstream provider, or changing one of its keys.
 *
 * ONE PAGE, THREE JOBS, because they are the same three fields: a new
 * provider is a vendor plus its first credential, and everything else
 * you can change about a provider IS a credential. The gateway's own
 * provider record holds network timeouts and concurrency pools, which
 * is the deep configuration this console leaves where it lives.
 *
 * SELF-HOSTED PROVIDERS TAKE AN ADDRESS, NOT AN ACCOUNT. ollama, vllm
 * and sgl are a URL — a key means nothing to them, and offering the
 * wrong field is how somebody spends an afternoon on a provider that
 * was never going to answer.
 */

const selfHosted = ['ollama', 'vllm', 'sgl']

export default function AIProviderFormPage() {
  const { provider, keyId } = useParams<{ provider?: string; keyId?: string }>()
  const [search] = useSearchParams()
  // Three modes off one route: no provider is a new one, a provider
  // with a key id edits that key, and a provider without adds one.
  const addingProvider = !provider
  const editingKey = Boolean(keyId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [url, setURL] = useState('')
  const [models, setModels] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: types } = useQuery({
    queryKey: ['aiProviderTypes'],
    queryFn: api.aiProviderTypes,
    enabled: addingProvider,
  })
  const { data: providers } = useQuery({
    queryKey: ['aiGatewayProviders'],
    queryFn: api.listAIGatewayProviders,
  })

  const target = addingProvider ? name : provider!
  const isSelfHosted = selfHosted.includes(target)

  const existingKey = providers
    ?.find((p) => p.name === provider)
    ?.keys.find((k) => k.id === keyId)

  useEffect(() => {
    if (!existingKey) return
    setModels(existingKey.models.filter((m) => m !== '*').join(', '))
    setEnabled(existingKey.enabled)
  }, [existingKey])

  // A vendor already connected can't be added twice, so it isn't
  // offered — the gateway would refuse it and the list already shows it.
  const connected = new Set((providers ?? []).map((p) => p.name))
  const available = (types ?? []).filter((t) => !connected.has(t))

  const back = () => navigate('/ai/providers')

  const save = useMutation({
    mutationFn: async () => {
      const key = {
        value,
        url,
        models: models
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
        enabled,
      }
      if (addingProvider) await api.createAIGatewayProvider({ name, key })
      else if (editingKey) await api.updateAIGatewayKey(provider!, keyId!, key)
      else await api.addAIGatewayKey(provider!, key)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiGatewayProviders'] })
      back()
    },
    onError: (e: Error) => setError(e.message),
  })

  const credentialOK = isSelfHosted
    ? url.trim() !== ''
    : editingKey || value.trim() !== ''
  const complete = (!addingProvider || name !== '') && credentialOK

  const title = addingProvider
    ? 'Connect provider'
    : editingKey
      ? `Edit key on ${provider}`
      : `Add key to ${provider}`

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={back}>
          Providers
        </Button>
      </Box>
      <PageHeader title={title} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
        {addingProvider && (
          <SelectField
            label="Provider"
            size="small"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText={
              search.get('all') ? undefined : 'Providers already connected are not listed.'
            }
          >
            <MenuItem value="">Pick one</MenuItem>
            {available.map((t) => (
              <MenuItem key={t} value={t}>
                <ProviderName name={t} />
              </MenuItem>
            ))}
          </SelectField>
        )}

        {isSelfHosted ? (
          <TextField
            label="Address"
            size="small"
            fullWidth
            value={url}
            onChange={(e) => setURL(e.target.value)}
            helperText={`${target} is reached at an address rather than with a key.`}
          />
        ) : (
          <TextField
            label="API key"
            size="small"
            fullWidth
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            helperText={
              editingKey
                ? `Leave blank to keep ${existingKey?.masked ?? 'the stored key'}.`
                : "The vendor's key. It is stored by the gateway, not by this console."
            }
          />
        )}

        <TextField
          label="Models"
          size="small"
          fullWidth
          value={models}
          onChange={(e) => setModels(e.target.value)}
          helperText="Comma separated. Blank is every model this provider serves."
        />
        <FormControlLabel
          control={<Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
          label="Enabled"
          slotProps={{ typography: { sx: { fontSize: 14 } } }}
        />
      </Paper>

      <Box
        sx={{
          display: 'flex',
          gap: 1,
          pt: 2,
          mt: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Button
          variant="contained"
          disabled={!complete || save.isPending}
          onClick={() => save.mutate()}
        >
          {addingProvider ? 'Connect' : editingKey ? 'Save' : 'Add'}
        </Button>
        <Button onClick={back}>Cancel</Button>
      </Box>
    </Box>
  )
}
