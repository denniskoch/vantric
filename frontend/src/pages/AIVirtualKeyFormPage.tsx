import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { api } from '../api/client'
import type { AIIssuedVirtualKey } from '../api/client'
import PageHeader from '../components/PageHeader'
import SelectField from '../components/SelectField'

/**
 * Issuing a caller's credential, or changing what it may reach.
 *
 * ACCESS IS PER PROVIDER, which is the gateway's own model: a key names
 * the providers it may use and the models within each, and "*" is the
 * gateway's word for all of them. A key naming no provider reaches
 * nothing, so the form starts with one row rather than none.
 */
export default function AIVirtualKeyFormPage() {
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [active, setActive] = useState(true)
  const [access, setAccess] = useState<{ provider: string; models: string }[]>([
    { provider: '', models: '*' },
  ])
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<AIIssuedVirtualKey | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: existing } = useQuery({
    queryKey: ['aiVirtualKeys', {}],
    queryFn: () => api.listAIVirtualKeys({}),
    enabled: editing,
    select: (all) => all.find((k) => k.id === id),
  })

  // The providers the gateway actually has, so this is a picker rather
  // than a field where a typo produces a key that reaches nothing.
  const { data: providers } = useQuery({
    queryKey: ['aiGatewayProviders'],
    queryFn: api.listAIGatewayProviders,
  })

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setActive(existing.active)
    setAccess(
      existing.access.length > 0
        ? existing.access.map((a) => ({ provider: a.provider, models: a.models.join(', ') }))
        : [{ provider: '', models: '*' }],
    )
  }, [existing])

  const body = () => ({
    name,
    description,
    active,
    access: access
      .filter((a) => a.provider !== '')
      .map((a) => ({
        provider: a.provider,
        models: a.models
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
      })),
  })

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await api.updateAIVirtualKey(id!, body())
        return null
      }
      return api.createAIVirtualKey(body())
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['aiVirtualKeys'] })
      // A new key's secret exists in this response and nowhere else, so
      // the page stops here and shows it instead of navigating away.
      if (result) setIssued(result)
      else navigate('/ai/virtual-keys')
    },
    onError: (e: Error) => setError(e.message),
  })

  const complete = name.trim() !== '' && access.some((a) => a.provider !== '')

  if (issued) {
    return (
      <Box sx={{ p: 3, maxWidth: 720 }}>
        <PageHeader title={`${issued.key.name} is ready`} />
        <Alert severity="warning" sx={{ mb: 2 }}>
          This is the only time the console will show this key. Copy it now — after you
          leave this page it can only be read in the gateway.
        </Alert>
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="code"
            sx={{ flex: 1, fontFamily: 'monospace', fontSize: 13, overflowWrap: 'anywhere' }}
          >
            {issued.secret}
          </Box>
          <Button
            size="small"
            startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
            onClick={() => {
              void navigator.clipboard.writeText(issued.secret)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Paper>
        <Box sx={{ pt: 2, mt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button variant="contained" onClick={() => navigate('/ai/virtual-keys')}>
            Done
          </Button>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/ai/virtual-keys')}
        >
          Virtual keys
        </Button>
      </Box>
      <PageHeader title={editing ? 'Edit virtual key' : 'Create virtual key'} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
        <TextField
          label="Name"
          size="small"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          helperText="What the request log shows as the caller."
        />
        {!editing && (
          <TextField
            label="Description"
            size="small"
            fullWidth
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            helperText="Optional."
          />
        )}
        <FormControlLabel
          control={<Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />}
          label="Active"
          slotProps={{ typography: { sx: { fontSize: 14 } } }}
        />

        <Box>
          <Typography sx={{ fontSize: 13, mb: 1 }}>Allowed providers</Typography>
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {access.map((row, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <SelectField
                  label="Provider"
                  size="small"
                  value={row.provider}
                  onChange={(e) =>
                    setAccess((a) =>
                      a.map((r, j) => (i === j ? { ...r, provider: e.target.value } : r)),
                    )
                  }
                  sx={{ minWidth: 200 }}
                >
                  <MenuItem value="">Pick one</MenuItem>
                  {(providers ?? []).map((p) => (
                    <MenuItem key={p.name} value={p.name}>
                      {p.name}
                    </MenuItem>
                  ))}
                </SelectField>
                <TextField
                  label="Models"
                  size="small"
                  value={row.models}
                  onChange={(e) =>
                    setAccess((a) =>
                      a.map((r, j) => (i === j ? { ...r, models: e.target.value } : r)),
                    )
                  }
                  sx={{ flex: 1 }}
                  helperText="Comma separated. * is every model."
                />
                <IconButton
                  size="small"
                  aria-label="Remove provider"
                  disabled={access.length === 1}
                  onClick={() => setAccess((a) => a.filter((_, j) => j !== i))}
                  sx={{ mt: 0.5 }}
                >
                  <DeleteIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
          <Button
            size="small"
            startIcon={<AddIcon />}
            sx={{ mt: 1 }}
            onClick={() => setAccess((a) => [...a, { provider: '', models: '*' }])}
          >
            Add provider
          </Button>
        </Box>
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
          {editing ? 'Save' : 'Create'}
        </Button>
        <Button onClick={() => navigate('/ai/virtual-keys')}>Cancel</Button>
        {!complete && (
          <Typography sx={{ alignSelf: 'center', fontSize: 12, color: 'text.secondary' }}>
            A name and at least one provider are required
          </Typography>
        )}
      </Box>
    </Box>
  )
}
