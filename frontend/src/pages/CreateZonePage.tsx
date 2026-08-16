import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CircleIcon from '@mui/icons-material/Circle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import { domainError, domainRe } from '../validation'
import { providerLabel, usesZoneModes } from '../dnsProviders'
import { reverseSuffixes } from '../reverseDns'

type SectionID = 'zone' | 'delegation'

type Lookup = 'forward' | 'reverse'

export default function CreateZonePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [section, setSection] = useState<SectionID>('zone')
  const [providerId, setProviderId] = useState('')
  const [lookup, setLookup] = useState<Lookup>('forward')
  const [name, setName] = useState('')
  const [suffix, setSuffix] = useState(reverseSuffixes[0].value)
  const [accountId, setAccountId] = useState('')
  const [zoneType, setZoneType] = useState('full')
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['dnsProviders'],
    queryFn: api.listDNSProviders,
  })

  const connected = providers.filter((p) => p.status === 'connected')
  if (!providerId && connected.length > 0) setProviderId(connected[0].id)
  const provider = providers.find((p) => p.id === providerId)

  const { data: accounts = [] } = useQuery({
    queryKey: ['dnsAccounts', providerId],
    queryFn: () => api.listDNSAccounts(providerId),
    enabled: Boolean(providerId),
  })
  if (!accountId && accounts.length > 0) setAccountId(accounts[0].id)

  // The name a reverse zone gets is the labels typed plus the tree they
  // belong to. The suffix is offered rather than derived from a mask:
  // whoever is creating the zone already knows which one they want, and
  // a form that works it out from a prefix has to have opinions about
  // delegation that belong to whoever holds it.
  const typed = name.trim().toLowerCase().replace(/\.$/, '')
  const zoneName = lookup === 'reverse' ? (typed ? `${typed}.${suffix}` : '') : typed

  const modes = usesZoneModes(provider?.type)

  const create = useMutation({
    mutationFn: () =>
      api.createDNSZone(providerId, {
        name: zoneName,
        accountId: accountId || undefined,
        type: modes ? zoneType : undefined,
      }),
    onSuccess: (zone) => {
      queryClient.invalidateQueries({ queryKey: ['dnsZones'] })
      navigate(`/dns/zones/${providerId}/${zone.id}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError =
    lookup === 'reverse'
      ? typed && !domainRe.test(zoneName)
        ? 'Enter the labels before the suffix, e.g. 80.168.192'
        : null
      : domainError(name)
  const zoneValid = Boolean(providerId) && domainRe.test(zoneName) && !nameError

  const sections: { id: SectionID; label: string; summary: string; invalid?: boolean }[] = [
    {
      id: 'zone',
      label: 'Zone',
      summary: zoneValid
        ? `${lookup === 'reverse' ? 'Reverse' : 'Forward'} — ${zoneName}`
        : 'Provider, lookup type, name',
      invalid: !zoneValid,
    },
    {
      id: 'delegation',
      label: 'Delegation',
      summary: [
        accounts.length > 0 ? (accounts.find((a) => a.id === accountId)?.name ?? 'Default') : null,
        modes ? zoneType : null,
      ]
        .filter(Boolean)
        .join(', ') || 'Nothing to set for this provider',
    },
  ]

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

      <Box sx={{ display: 'flex', gap: 3 }}>
        <Paper variant="outlined" sx={{ width: 260, flexShrink: 0, alignSelf: 'flex-start' }}>
          <List dense disablePadding>
            {sections.map((sec) => (
              <ListItemButton
                key={sec.id}
                selected={section === sec.id}
                onClick={() => setSection(sec.id)}
                sx={{
                  py: 1.2,
                  borderLeft:
                    section === sec.id ? '3px solid #1a73e8' : '3px solid transparent',
                }}
              >
                {sec.invalid ? (
                  <ErrorIcon sx={{ fontSize: 14, color: 'error.main', mr: 1.5 }} />
                ) : (
                  <CircleIcon sx={{ fontSize: 8, color: 'text.secondary', mr: 2.2, ml: 0.4 }} />
                )}
                <ListItemText
                  primary={sec.label}
                  secondary={sec.summary}
                  slotProps={{
                    primary: { sx: { fontWeight: section === sec.id ? 500 : 400 } },
                    secondary: { sx: { fontSize: 11 } },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            flex: 1,
            maxWidth: 640,
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            alignSelf: 'flex-start',
          }}
        >
          {section === 'zone' && (
            <>
              <Typography variant="h6">Zone</Typography>

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
                    {p.name} — {providerLabel(p.type)} ({p.status})
                  </MenuItem>
                ))}
              </TextField>

              <Divider textAlign="left">Lookup</Divider>

              <TextField
                label="Lookup type"
                size="small"
                select
                value={lookup}
                onChange={(e) => setLookup(e.target.value as Lookup)}
                helperText="Forward maps names to addresses; reverse maps addresses back to names"
                fullWidth
              >
                <MenuItem value="forward">Forward — a domain</MenuItem>
                <MenuItem value="reverse">Reverse — an address range</MenuItem>
              </TextField>

              {lookup === 'forward' ? (
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
              ) : (
                <>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <TextField
                      label="Zone"
                      size="small"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="80.168.192"
                      error={Boolean(nameError)}
                      slotProps={{
                        input: {
                          endAdornment: (
                            <InputAdornment position="end" sx={{ color: 'text.secondary' }}>
                              .{suffix}
                            </InputAdornment>
                          ),
                        },
                      }}
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      label="Tree"
                      size="small"
                      select
                      value={suffix}
                      onChange={(e) => setSuffix(e.target.value)}
                      sx={{ width: 180 }}
                    >
                      {reverseSuffixes.map((s) => (
                        <MenuItem key={s.value} value={s.value}>
                          {s.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: -1.5 }}>
                    {nameError ??
                      reverseSuffixes.find((s) => s.value === suffix)?.hint}
                  </Typography>
                </>
              )}
            </>
          )}

          {section === 'delegation' && (
            <>
              <Typography variant="h6">Delegation</Typography>

              {/* Nothing here is universal. A provider with one estate
                  has no account to choose and a server you run has no
                  zone mode, so a section of inert controls is worse
                  than a sentence saying there's nothing to decide. */}
              {accounts.length === 0 && !modes && (
                <Typography sx={{ color: 'text.secondary' }}>
                  {provider ? providerLabel(provider.type) : 'This provider'} has no accounts to
                  file zones under and no hosted/partial distinction to make, so there's nothing
                  to set here.
                </Typography>
              )}

              {accounts.length > 0 && (
                <TextField
                  label="Account"
                  size="small"
                  select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  helperText="Which account the zone is created in"
                  fullWidth
                >
                  {accounts.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {/* Full vs partial is a hosted-DNS product decision about
                  who answers for a domain. A server you run either is
                  authoritative or isn't, so the control would do
                  nothing there and isn't offered. */}
              {modes && (
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
              )}
            </>
          )}
        </Paper>
      </Box>

      <Box
        sx={{
          display: 'flex',
          gap: 1,
          pt: 2,
          mt: 3,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Button
          variant="contained"
          disabled={!zoneValid || create.isPending}
          onClick={() => create.mutate()}
        >
          Create
        </Button>
        <Button onClick={() => navigate('/dns/zones')}>Cancel</Button>
      </Box>
    </Box>
  )
}
