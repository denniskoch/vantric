import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import SelectField from '../components/SelectField'

/**
 * A cap on what a caller may spend, or how fast it may ask.
 *
 * BOTH HALVES ARE OPTIONAL AND ONE IS REQUIRED. The gateway hangs a
 * spending budget and a rate limit off the same record, and will take
 * one carrying neither — a rule that caps nothing but looks like a rule
 * is the thing this refuses.
 *
 * THE SCOPE CAN'T BE EDITED. The gateway's update contract has no scope
 * field, and moving a cap from one key to another is a different cap
 * rather than a correction to this one.
 */

// The gateway's own duration vocabulary, offered rather than parsed —
// it is the thing that reads them, and "1M" is a month here.
const periods = [
  { value: '1h', label: 'Every hour' },
  { value: '1d', label: 'Every day' },
  { value: '1w', label: 'Every week' },
  { value: '1M', label: 'Every month' },
]

export default function AIBudgetFormPage() {
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [scopeID, setScopeID] = useState('')
  const [model, setModel] = useState('*')
  const [capSpend, setCapSpend] = useState(true)
  const [max, setMax] = useState('')
  const [period, setPeriod] = useState('1w')
  const [capRate, setCapRate] = useState(false)
  const [maxRequests, setMaxRequests] = useState('')
  const [requestPeriod, setRequestPeriod] = useState('1h')
  const [error, setError] = useState<string | null>(null)

  const { data: existing } = useQuery({
    queryKey: ['aiLimits'],
    queryFn: api.listAILimits,
    enabled: editing,
    select: (all) => all.find((l) => l.id === id),
  })
  const { data: keys } = useQuery({
    queryKey: ['aiVirtualKeys', {}],
    queryFn: () => api.listAIVirtualKeys({}),
    enabled: !editing,
  })

  useEffect(() => {
    if (!existing) return
    setModel(existing.model)
    setCapSpend(Boolean(existing.budget))
    if (existing.budget) {
      setMax(String(existing.budget.max))
      setPeriod(existing.budget.period)
    }
    setCapRate(Boolean(existing.rateLimit?.maxRequests))
    if (existing.rateLimit?.maxRequests != null) {
      setMaxRequests(String(existing.rateLimit.maxRequests))
      setRequestPeriod(existing.rateLimit.requestPeriod || '1h')
    }
  }, [existing])

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        scope: 'virtual_key',
        scopeId: scopeID,
        model,
        provider: '',
        budget: capSpend ? { max: Number(max), period } : null,
        rateLimit: capRate
          ? { maxRequests: Number(maxRequests), requestPeriod }
          : null,
      }
      if (editing) await api.updateAILimit(id!, body)
      else await api.createAILimit(body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiLimits'] })
      navigate('/ai/budgets')
    },
    onError: (e: Error) => setError(e.message),
  })

  const maxError = capSpend && max !== '' && !(Number(max) > 0) ? 'More than zero' : null
  const rateError =
    capRate && maxRequests !== '' && !(Number(maxRequests) > 0) ? 'More than zero' : null
  const complete =
    (editing || scopeID !== '') &&
    (capSpend || capRate) &&
    (!capSpend || (max !== '' && !maxError)) &&
    (!capRate || (maxRequests !== '' && !rateError))

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/ai/budgets')}>
          Budgets
        </Button>
      </Box>
      <PageHeader title={editing ? 'Edit budget' : 'Create budget'} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
        {editing ? (
          <TextField
            label="Applies to"
            size="small"
            fullWidth
            value={existing?.scopeName ?? ''}
            disabled
            helperText="Capping something else is a different budget, not an edit of this one."
          />
        ) : (
          <SelectField
            label="Virtual key"
            size="small"
            fullWidth
            value={scopeID}
            onChange={(e) => setScopeID(e.target.value)}
          >
            <MenuItem value="">Pick one</MenuItem>
            {(keys ?? []).map((k) => (
              <MenuItem key={k.id} value={k.id}>
                {k.name}
              </MenuItem>
            ))}
          </SelectField>
        )}
        <TextField
          label="Models"
          size="small"
          fullWidth
          value={model}
          onChange={(e) => setModel(e.target.value)}
          helperText="* is every model."
        />

        <Box>
          <FormControlLabel
            control={
              <Checkbox checked={capSpend} onChange={(e) => setCapSpend(e.target.checked)} />
            }
            label="Cap spending"
            slotProps={{ typography: { sx: { fontSize: 14 } } }}
          />
          {capSpend && (
            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
              <TextField
                label="Limit"
                size="small"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                error={Boolean(maxError)}
                helperText={maxError ?? 'US dollars.'}
                sx={{ width: 180 }}
              />
              <SelectField
                label="Resets"
                size="small"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                sx={{ minWidth: 180 }}
              >
                {periods.map((p) => (
                  <MenuItem key={p.value} value={p.value}>
                    {p.label}
                  </MenuItem>
                ))}
              </SelectField>
            </Box>
          )}
        </Box>

        <Box>
          <FormControlLabel
            control={<Checkbox checked={capRate} onChange={(e) => setCapRate(e.target.checked)} />}
            label="Cap request rate"
            slotProps={{ typography: { sx: { fontSize: 14 } } }}
          />
          {capRate && (
            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
              <TextField
                label="Requests"
                size="small"
                value={maxRequests}
                onChange={(e) => setMaxRequests(e.target.value)}
                error={Boolean(rateError)}
                helperText={rateError ?? ' '}
                sx={{ width: 180 }}
              />
              <SelectField
                label="Per"
                size="small"
                value={requestPeriod}
                onChange={(e) => setRequestPeriod(e.target.value)}
                sx={{ minWidth: 180 }}
              >
                {periods.map((p) => (
                  <MenuItem key={p.value} value={p.value}>
                    {p.label}
                  </MenuItem>
                ))}
              </SelectField>
            </Box>
          )}
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
        <Button onClick={() => navigate('/ai/budgets')}>Cancel</Button>
        {!complete && (
          <Typography sx={{ alignSelf: 'center', fontSize: 12, color: 'text.secondary' }}>
            {editing ? 'Set a spending cap, a rate cap, or both' : 'Pick a key and set a cap'}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
