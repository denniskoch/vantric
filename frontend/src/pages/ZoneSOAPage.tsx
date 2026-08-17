import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Divider, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import type { ZoneSOA } from '../api/client'
import FormPage from '../components/FormPage'

/**
 * Editing the start of authority.
 *
 * Its own page with named fields, rather than a row in the record-set
 * editor, because the wire form is seven values in one string: the
 * difference between a negative TTL of 3600 and 604800 is a typo you
 * cannot see there, and a week of everyone caching a name that doesn't
 * exist is the result.
 */
const timers: {
  key: 'refresh' | 'retry' | 'expire' | 'negativeTtl'
  label: string
  hint: string
}[] = [
  {
    key: 'refresh',
    label: 'Refresh',
    hint: 'How often a secondary checks this zone for a new serial',
  },
  {
    key: 'retry',
    label: 'Retry',
    hint: 'How soon it tries again after a failed check',
  },
  {
    key: 'expire',
    label: 'Expire',
    hint: 'How long a secondary keeps serving the zone while it can’t reach the primary',
  },
  {
    key: 'negativeTtl',
    label: 'Negative TTL',
    hint: 'How long resolvers cache "no such name" — the one that keeps a new record hidden after you add it',
  },
]

function SOAForm({ soa, providerId, zoneId }: { soa: ZoneSOA; providerId: string; zoneId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ZoneSOA>(soa)
  const [error, setError] = useState<string | null>(null)

  const zonePath = `/dns/zones/${providerId}/${zoneId}`

  const save = useMutation({
    mutationFn: () => api.saveZoneSOA(providerId, zoneId, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dnsSOA', providerId, zoneId] })
      queryClient.invalidateQueries({ queryKey: ['dnsRecords', providerId, zoneId] })
      navigate(zonePath)
    },
    onError: (e: Error) => setError(e.message),
  })

  const num = (key: keyof ZoneSOA, value: string) =>
    setForm({ ...form, [key]: value === '' ? 0 : Number(value) })

  const hostError =
    form.hostmaster.trim() !== '' && !form.hostmaster.includes('@')
      ? 'An email address — the record stores it with the @ as a dot'
      : null
  const nsError = /\.invalid$/i.test(form.primaryNs.trim())
    ? 'That is a placeholder, not a nameserver'
    : null
  // A secondary that has given up before it would next retry can never
  // recover on its own, so this pair is checked together.
  const expireError =
    form.expire <= form.refresh ? 'Expire must be longer than refresh' : null
  const serialError =
    form.serial < soa.serial
      ? `Must not go below ${soa.serial} — secondaries ignore a zone whose serial has decreased`
      : null

  const valid =
    form.primaryNs.trim() !== '' &&
    !nsError &&
    !hostError &&
    form.hostmaster.trim() !== '' &&
    !expireError &&
    !serialError

  return (
    <FormPage
      title="Start of authority"
      backTo={zonePath}
      backLabel="Zone"
      error={error}
      onDismissError={() => setError(null)}
      notice="These values govern how secondaries follow this zone and how long resolvers cache a miss. They are the zone's, not any one record's."
      primaryLabel="Save"
      pendingLabel="Saving…"
      primaryDisabled={!valid}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <TextField
        label="Primary nameserver"
        size="small"
        value={form.primaryNs}
        onChange={(e) => setForm({ ...form, primaryNs: e.target.value })}
        error={Boolean(nsError)}
        helperText={nsError ?? 'The server holding the master copy of this zone'}
        fullWidth
      />
      <TextField
        label="Hostmaster"
        size="small"
        value={form.hostmaster}
        onChange={(e) => setForm({ ...form, hostmaster: e.target.value })}
        error={Boolean(hostError)}
        helperText={
          hostError ?? 'An email address. DNS stores it with the @ written as a dot.'
        }
        fullWidth
      />

      <Divider textAlign="left">Serial</Divider>

      <TextField
        label="Serial"
        size="small"
        type="number"
        value={form.serial}
        onChange={(e) => num('serial', e.target.value)}
        error={Boolean(serialError)}
        helperText={
          serialError ??
          'Secondaries only re-read the zone when this rises. Your server may bump it itself on the next change.'
        }
        fullWidth
      />

      <Divider textAlign="left">Timers (seconds)</Divider>

      {timers.map((timer) => (
        <TextField
          key={timer.key}
          label={timer.label}
          size="small"
          type="number"
          value={form[timer.key]}
          onChange={(e) => num(timer.key, e.target.value)}
          error={timer.key === 'expire' && Boolean(expireError)}
          helperText={(timer.key === 'expire' && expireError) || timer.hint}
          fullWidth
        />
      ))}
    </FormPage>
  )
}

export default function ZoneSOAPage() {
  const { providerId = '', zoneId = '' } = useParams()
  const navigate = useNavigate()
  const {
    data: soa,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['dnsSOA', providerId, zoneId],
    queryFn: () => api.getZoneSOA(providerId, zoneId),
    enabled: Boolean(providerId && zoneId),
    retry: false,
  })

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    )
  }
  if (error || !soa) {
    return (
      <Box sx={{ p: 3 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/dns/zones/${providerId}/${zoneId}`)}
        >
          Zone
        </Button>
        <Alert severity="info" sx={{ mt: 2, maxWidth: 680 }}>
          {(error as Error)?.message ?? 'This zone has no SOA record to edit.'}
        </Alert>
      </Box>
    )
  }
  return <SOAForm soa={soa} providerId={providerId} zoneId={zoneId} />
}
