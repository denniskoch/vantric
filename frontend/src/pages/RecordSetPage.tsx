import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import { api } from '../api/client'
import type { DNSZone } from '../api/client'
import {
  editableTypes,
  hasPriority,
  proxyableTypes,
  relativeName,
  toRecordSets,
  valueExamples,
  valueLabels,
} from '../dnsRecords'
import type { RecordSet } from '../dnsRecords'
import { recordNameError, recordValueError, ttlError } from '../validation'

const ttlUnits: Record<string, number> = { seconds: 1, minutes: 60, hours: 3600 }

/** Show a stored TTL in the largest unit that divides it evenly. */
function splitTTL(seconds: number): { value: number; unit: string } {
  if (seconds >= 3600 && seconds % 3600 === 0) return { value: seconds / 3600, unit: 'hours' }
  if (seconds >= 60 && seconds % 60 === 0) return { value: seconds / 60, unit: 'minutes' }
  return { value: seconds, unit: 'seconds' }
}

interface FormValue {
  content: string
  priority: string
}

/** The form itself, mounted only once its zone and records are loaded
 *  so the fields can start from the set being edited. */
function RecordSetForm({
  zone,
  sets,
  editing,
}: {
  zone: DNSZone
  sets: RecordSet[]
  editing: RecordSet | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(editing ? relativeName(editing.name, zone.name) : '')
  const [type, setType] = useState(editing?.type ?? 'A')
  const [values, setValues] = useState<FormValue[]>(
    editing
      ? editing.records.map((r) => ({ content: r.content, priority: String(r.priority) }))
      : [{ content: '', priority: '10' }],
  )
  const [automatic, setAutomatic] = useState(editing ? editing.ttl <= 1 : true)
  const initialTTL = splitTTL(editing && editing.ttl > 1 ? editing.ttl : 300)
  const [ttlValue, setTtlValue] = useState(String(initialTTL.value))
  const [ttlUnit, setTtlUnit] = useState(initialTTL.unit)
  const [proxied, setProxied] = useState(editing?.proxied ?? false)
  const [error, setError] = useState<string | null>(null)

  const zonePath = `/dns/zones/${zone.providerId}/${zone.id}`
  const fullName =
    name.trim() && name.trim() !== '@' ? `${name.trim().toLowerCase()}.${zone.name}` : zone.name
  const proxyable = proxyableTypes.includes(type)
  // Cloudflare serves proxied records on its own TTL, so the field
  // would be a lie if it stayed editable.
  const ttlAutomatic = automatic || (proxyable && proxied)
  const ttlSeconds = ttlAutomatic ? 1 : Number(ttlValue) * ttlUnits[ttlUnit]

  const collision = !editing && sets.some((s) => s.name === fullName && s.type === type)
  const cnameConflict =
    !editing &&
    sets.some(
      (s) => s.name === fullName && s.type !== type && (s.type === 'CNAME' || type === 'CNAME'),
    )

  const nameError =
    recordNameError(name) ??
    (collision
      ? 'A record set with this DNS name and type already exists. Edit it to add another value.'
      : cnameConflict
        ? 'A name may have either one CNAME record set or record sets of other types, but not both.'
        : null)
  const ttlFieldError = ttlAutomatic ? null : ttlError(ttlSeconds)
  const valueErrors = values.map((v) => recordValueError(type, v.content))

  const valid =
    !nameError &&
    !ttlFieldError &&
    values.length > 0 &&
    values.every((v, i) => v.content.trim() !== '' && !valueErrors[i])

  const save = useMutation({
    mutationFn: () =>
      api.saveDNSRecordSet(zone.providerId, zone.id, {
        name: fullName,
        type,
        ttl: ttlSeconds,
        proxied: proxyable && proxied,
        values: values.map((v) => ({
          content: v.content.trim(),
          priority: hasPriority(type) ? Number(v.priority) || 0 : 0,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dnsRecords', zone.providerId, zone.id] })
      navigate(zonePath)
    },
    onError: (e: Error) => setError(e.message),
  })

  const setValue = (index: number, patch: Partial<FormValue>) =>
    setValues(values.map((v, i) => (i === index ? { ...v, ...patch } : v)))

  const label = valueLabels[type] ?? 'Value'

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate(zonePath)}>
          {zone.name}
        </Button>
        <Typography variant="h5">{editing ? 'Edit record set' : 'Create record set'}</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 680 }}>
        <TextField
          label="DNS name"
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={Boolean(editing)}
          error={Boolean(nameError)}
          helperText={nameError ?? 'Leave blank for the domain itself'}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end" sx={{ color: '#5f6368' }}>
                  .{zone.name}.
                </InputAdornment>
              ),
            },
          }}
          fullWidth
        />

        <TextField
          label="Resource record type"
          size="small"
          select
          value={type}
          onChange={(e) => {
            setType(e.target.value)
            // CNAME holds exactly one value; drop the extras rather
            // than silently discarding them on save.
            if (e.target.value === 'CNAME') setValues(values.slice(0, 1))
          }}
          disabled={Boolean(editing)}
          helperText={editing ? "A set's name and type are fixed — delete it to change them" : ' '}
          fullWidth
        >
          {editableTypes.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>

        {proxyable && (
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={proxied}
                onChange={(e) => setProxied(e.target.checked)}
              />
            }
            label="Proxy through the provider (hides the origin address)"
          />
        )}

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <TextField
            label="TTL"
            size="small"
            type="number"
            value={ttlValue}
            onChange={(e) => setTtlValue(e.target.value)}
            disabled={ttlAutomatic}
            error={Boolean(ttlFieldError)}
            helperText={ttlFieldError ?? ' '}
            sx={{ width: 160 }}
          />
          <TextField
            label="TTL unit"
            size="small"
            select
            value={ttlUnit}
            onChange={(e) => setTtlUnit(e.target.value)}
            disabled={ttlAutomatic}
            sx={{ width: 160 }}
          >
            {Object.keys(ttlUnits).map((unit) => (
              <MenuItem key={unit} value={unit}>
                {unit}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            sx={{ mt: 0.5 }}
            control={
              <Checkbox
                size="small"
                checked={ttlAutomatic}
                disabled={proxyable && proxied}
                onChange={(e) => setAutomatic(e.target.checked)}
              />
            }
            label={proxyable && proxied ? 'Automatic (required when proxied)' : 'Automatic'}
          />
        </Box>

        <Box>
          <Typography sx={{ fontSize: 16, color: '#202124', mb: 1.5 }}>{label}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {values.map((value, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                {hasPriority(type) && (
                  <TextField
                    label="Priority"
                    size="small"
                    type="number"
                    value={value.priority}
                    onChange={(e) => setValue(i, { priority: e.target.value })}
                    helperText=" "
                    sx={{ width: 120 }}
                  />
                )}
                <TextField
                  label={`${label} ${i + 1}`}
                  size="small"
                  value={value.content}
                  onChange={(e) => setValue(i, { content: e.target.value })}
                  error={Boolean(valueErrors[i])}
                  helperText={valueErrors[i] ?? `Example: ${valueExamples[type] ?? ''}`}
                  fullWidth
                />
                {values.length > 1 && (
                  <IconButton
                    size="small"
                    sx={{ mt: 0.5 }}
                    onClick={() => setValues(values.filter((_, j) => j !== i))}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            ))}
          </Box>
          <Button
            size="small"
            startIcon={<AddIcon />}
            sx={{ mt: 1 }}
            disabled={type === 'CNAME'}
            onClick={() => setValues([...values, { content: '', priority: '10' }])}
          >
            Add item
          </Button>
          {type === 'CNAME' && (
            <Typography sx={{ fontSize: 12, color: '#5f6368', mt: 1 }}>
              A CNAME record set holds a single value.
            </Typography>
          )}
        </Box>
      </Box>

      {/* Persistent action bar, GCP-style */}
      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 3, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate()}
        >
          {editing ? 'Save' : 'Create'}
        </Button>
        <Button onClick={() => navigate(zonePath)}>Cancel</Button>
      </Box>
    </Box>
  )
}

export default function RecordSetPage() {
  const { providerId = '', zoneId = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const editingName = params.get('name')
  const editingType = params.get('type')

  const { data: zone, error: zoneError } = useQuery({
    queryKey: ['dnsZone', providerId, zoneId],
    queryFn: () => api.getDNSZone(providerId, zoneId),
  })
  const { data: records, error: recordsError } = useQuery({
    queryKey: ['dnsRecords', providerId, zoneId],
    queryFn: () => api.listDNSRecords(providerId, zoneId),
  })

  const failure = (zoneError ?? recordsError) as Error | undefined
  if (failure) {
    return (
      <Box sx={{ p: 3 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/dns/zones/${providerId}/${zoneId}`)}
        >
          Back
        </Button>
        <Alert severity="error" sx={{ mt: 2 }}>
          {failure.message}
        </Alert>
      </Box>
    )
  }

  if (!zone || !records) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading zone…</Typography>
      </Box>
    )
  }

  const sets = toRecordSets(records)
  const editing = editingName
    ? (sets.find((s) => s.name === editingName && s.type === editingType) ?? null)
    : null

  if (editingName && !editing) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="warning"
          action={
            <Button size="small" onClick={() => navigate(`/dns/zones/${providerId}/${zoneId}`)}>
              Back to zone
            </Button>
          }
        >
          No {editingType} record set for {editingName} — it may have been deleted.
        </Alert>
      </Box>
    )
  }

  return <RecordSetForm zone={zone} sets={sets} editing={editing} />
}
