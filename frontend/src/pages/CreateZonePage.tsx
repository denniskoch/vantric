import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import { domainError, domainRe } from '../validation'

export default function CreateZonePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState('')
  const [zoneType, setZoneType] = useState('full')
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['dnsProviders'],
    queryFn: api.listDNSProviders,
  })

  const connected = providers.filter((p) => p.status === 'connected')
  if (!providerId && connected.length > 0) setProviderId(connected[0].id)

  // Accounts come from the provider, so zones land in the right one.
  const { data: accounts = [] } = useQuery({
    queryKey: ['dnsAccounts', providerId],
    queryFn: () => api.listDNSAccounts(providerId),
    enabled: Boolean(providerId),
  })
  // Pick the first account rather than leaving the field blank; a
  // provider that reports none keeps the "provider default" choice.
  if (!accountId && accounts.length > 0) setAccountId(accounts[0].id)

  const create = useMutation({
    mutationFn: () =>
      api.createDNSZone(providerId, {
        name: name.trim().toLowerCase(),
        accountId: accountId || undefined,
        type: zoneType,
      }),
    onSuccess: (zone) => {
      queryClient.invalidateQueries({ queryKey: ['dnsZones'] })
      navigate(`/dns/zones/${providerId}/${zone.id}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = domainError(name)
  const valid = domainRe.test(name.trim().toLowerCase()) && Boolean(providerId)

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/dns/zones')}>
          Zones
        </Button>
        <Typography variant="h5">Create zone</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {!isLoading && connected.length === 0 && (
        <Alert
          severity="info"
          sx={{ mb: 2, maxWidth: 680 }}
          action={
            <Button size="small" onClick={() => navigate('/dns/providers')}>
              Add provider
            </Button>
          }
        >
          No DNS provider is connected, so there's nowhere to create a zone.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 680 }}>
        <TextField
          label="Provider"
          size="small"
          select
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value)
            setAccountId('')
          }}
          helperText="Where the zone is hosted"
          fullWidth
        >
          {providers.map((p) => (
            <MenuItem key={p.id} value={p.id} disabled={p.status !== 'connected'}>
              {p.name} ({p.status})
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Domain"
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="example.com"
          error={Boolean(nameError)}
          helperText={nameError ?? 'The apex domain, without a scheme or trailing dot'}
          fullWidth
        />

        <TextField
          label="Account"
          size="small"
          select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          helperText={
            accounts.length === 0
              ? "Uses the provider's default account"
              : 'Which account the zone is created in'
          }
          fullWidth
        >
          {accounts.length === 0 && (
            <MenuItem value="">
              <em>Provider default</em>
            </MenuItem>
          )}
          {accounts.map((a) => (
            <MenuItem key={a.id} value={a.id}>
              {a.name}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Setup"
          size="small"
          select
          value={zoneType}
          onChange={(e) => setZoneType(e.target.value)}
          helperText="Full points the whole domain here by changing its nameservers at the registrar; partial leaves the domain where it is."
          fullWidth
        >
          <MenuItem value="full">Full — this provider answers for the domain</MenuItem>
          <MenuItem value="partial">Partial — keep the current nameservers</MenuItem>
        </TextField>
      </Box>

      {/* Persistent action bar, GCP-style */}
      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 3, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={!valid || create.isPending}
          onClick={() => create.mutate()}
        >
          Create
        </Button>
        <Button onClick={() => navigate('/dns/zones')}>Cancel</Button>
      </Box>
    </Box>
  )
}
