import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { DNSProvider, DNSProviderRequest, DNSProviderType } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe } from '../validation'

const backTo = '/dns/providers'

/**
 * What each provider type calls its own settings.
 *
 * A hosted API's address is a constant in its implementation; a server
 * in your lab has to be told where it is. And the third field is a
 * different thing entirely on each: Cloudflare's account owns zones,
 * PowerDNS's server id is part of every API path and is "localhost"
 * everywhere outside a hosting provider — so it is defaulted rather
 * than asked for.
 */
const shapes: Record<
  DNSProviderType,
  {
    label: string
    selfHosted: boolean
    tokenLabel: string
    tokenHint: string
    urlHint?: string
    thirdLabel: string
    thirdHint: string
    notice: string
  }
> = {
  cloudflare: {
    label: 'Cloudflare',
    selfHosted: false,
    tokenLabel: 'API token',
    tokenHint: 'A scoped token, not the global API key',
    thirdLabel: 'Account ID (optional)',
    thirdHint: "Which account new zones are created in; blank uses the provider's default",
    notice:
      'The token is checked against the API before the provider is saved, so a saved provider is one that works. It needs permission to read and edit zones.',
  },
  powerdns: {
    label: 'PowerDNS',
    selfHosted: true,
    tokenLabel: 'API key',
    tokenHint: 'The api-key from pdns.conf',
    urlHint: 'Where the API listens, e.g. http://192.168.1.10:8081 — not the DNS port',
    thirdLabel: 'Server ID (optional)',
    thirdHint: 'Blank means localhost, which is right on a standard install',
    notice:
      'The key is checked against the API before the provider is saved. PowerDNS only answers the API when webserver and api are enabled in pdns.conf, and api-key is set.',
  },
}

function ProviderForm({ editing }: { editing: DNSProvider | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<DNSProviderRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          token: '', // blank keeps the stored token
          accountId: editing.accountId,
          baseUrl: editing.baseUrl,
        }
      : { name: '', type: 'cloudflare', token: '', accountId: '', baseUrl: '' },
  )
  const [error, setError] = useState<string | null>(null)
  const shape = shapes[form.type] ?? shapes.cloudflare

  const { data: types = ['cloudflare' as DNSProviderType] } = useQuery({
    queryKey: ['dnsProviderTypes'],
    queryFn: api.listDNSProviderTypes,
  })

  const save = useMutation({
    mutationFn: () =>
      editing ? api.updateDNSProvider(editing.id, form) : api.createDNSProvider(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dnsProviders'] })
      queryClient.invalidateQueries({ queryKey: ['dnsZones'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const urlError =
    shape.selfHosted && form.baseUrl !== '' && !/^https?:\/\/.+/.test(form.baseUrl.trim())
      ? 'Must be a full http:// or https:// address'
      : null
  const valid =
    resourceNameRe.test(form.name) &&
    (form.token !== '' || Boolean(editing?.hasToken)) &&
    (!shape.selfHosted || (form.baseUrl.trim() !== '' && !urlError))

  return (
    <FormPage
      title={editing ? `Edit ${editing.name}` : 'Add DNS provider'}
      backTo={backTo}
      backLabel="Providers"
      error={error}
      onDismissError={() => setError(null)}
      notice={shape.notice}
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
        helperText={nameError ?? 'What this console calls it. e.g. cloudflare'}
        fullWidth
      />
      <TextField
        label="Type"
        size="small"
        select
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value as DNSProviderType })}
        fullWidth
      >
        {types.map((type) => (
          <MenuItem key={type} value={type}>
            {shapes[type]?.label ?? type}
          </MenuItem>
        ))}
      </TextField>
      {/* Only a self-hosted provider has an address to give. */}
      {shape.selfHosted && (
        <TextField
          label="API URL"
          size="small"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          error={Boolean(urlError)}
          helperText={urlError ?? shape.urlHint}
          fullWidth
        />
      )}
      <TextField
        label={shape.tokenLabel}
        size="small"
        type="password"
        value={form.token}
        onChange={(e) => setForm({ ...form, token: e.target.value })}
        helperText={
          editing?.hasToken ? `Leave blank to keep the current ${shape.tokenLabel.toLowerCase()}` : shape.tokenHint
        }
        fullWidth
      />
      <TextField
        label={shape.thirdLabel}
        size="small"
        value={form.accountId}
        onChange={(e) => setForm({ ...form, accountId: e.target.value })}
        helperText={shape.thirdHint}
        fullWidth
      />
    </FormPage>
  )
}

export default function DNSProviderFormPage() {
  const { id } = useParams()
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['dnsProviders'],
    queryFn: api.listDNSProviders,
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
