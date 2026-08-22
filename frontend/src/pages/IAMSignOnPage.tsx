import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { api } from '../api/client'
import type { RoleID } from '../api/client'
import PageHeader from '../components/PageHeader'

/**
 * Signing in through the lab's identity service.
 *
 * The other door, not the only one: local accounts stay, because a
 * console reachable only through another service is unreachable
 * exactly when that service is what's broken.
 */
export default function IAMSignOnPage() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const [name, setName] = useState('authentik')
  const [issuer, setIssuer] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [scopes, setScopes] = useState('openid profile email')
  const [autoCreate, setAutoCreate] = useState(false)
  const [defaultRole, setDefaultRole] = useState<RoleID>('viewer')
  const [enabled, setEnabled] = useState(true)

  const { data: provider } = useQuery({ queryKey: ['oidc'], queryFn: api.getOIDC })
  const { data: roles = [] } = useQuery({ queryKey: ['iamRoles'], queryFn: api.listRoles })

  useEffect(() => {
    if (!provider?.issuer) return
    setName(provider.name)
    setIssuer(provider.issuer)
    setClientId(provider.clientId)
    setScopes(provider.scopes)
    setAutoCreate(provider.autoCreate)
    setDefaultRole(provider.defaultRole)
    setEnabled(provider.enabled)
  }, [provider])

  // Straight from the server: behind a tunnel the browser's origin and
  // the URI the server actually sends are different things, and the
  // provider has to be told the server's one. A redirect URI that
  // differs by so much as a slash is the classic hour lost to OIDC.
  const redirectURI =
    provider?.redirectUri ?? `${window.location.origin}/api/v1/auth/oidc/callback`

  const save = useMutation({
    mutationFn: () =>
      api.saveOIDC({
        name: name.trim(),
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        clientSecret,
        scopes: scopes.trim(),
        autoCreate,
        defaultRole,
        enabled,
      }),
    onSuccess: () => {
      setClientSecret('')
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['oidc'] })
      queryClient.invalidateQueries({ queryKey: ['authProviders'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: api.deleteOIDC,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oidc'] })
      queryClient.invalidateQueries({ queryKey: ['authProviders'] })
      setIssuer('')
      setClientId('')
      setClientSecret('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const issuerError =
    issuer && !/^https?:\/\//.test(issuer.trim()) ? 'Must start with http:// or https://' : ''
  const incomplete = !issuer.trim() || Boolean(issuerError) || !clientId.trim()

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <PageHeader
        title="Single sign-on"
        description="Let people sign in through the lab's identity provider. Local accounts keep working."
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" onClose={() => setSaved(false)} sx={{ mb: 2 }}>
          Saved. The issuer answered discovery, so the sign-in page can offer it now.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: 'surface.subtle' }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>
          Give your provider this redirect URI, exactly:
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="code"
            sx={{
              flex: 1,
              fontSize: 12,
              wordBreak: 'break-all',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {redirectURI}
          </Box>
          <Button
            size="small"
            startIcon={<ContentCopyIcon />}
            onClick={() => {
              navigator.clipboard.writeText(redirectURI)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Box>
        {provider && !provider.siteUrlSet && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
            Worked out from this request. Behind a proxy or a tunnel that's the
            address the proxy dialled, which the provider will reject — set{' '}
            <code>VANTRIC_SITE_URL</code> in <code>.env</code> to the real one.
          </Typography>
        )}
      </Paper>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <TextField
          label="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          helperText='Shown on the sign-in button: "Sign in with …"'
          size="small"
          fullWidth
        />
        <TextField
          label="Issuer URL"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          error={Boolean(issuerError)}
          helperText={
            issuerError ||
            'The base URL — pasting the full /.well-known/openid-configuration link works too'
          }
          placeholder="https://auth.example.com/application/o/lab-cloud/"
          size="small"
          fullWidth
        />
        <TextField
          label="Client ID"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Client secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          helperText={
            provider?.hasSecret
              ? 'Stored. Leave blank to keep it, or enter a new one to replace it.'
              : 'Leave blank for a public client — the flow uses PKCE either way.'
          }
          autoComplete="new-password"
          size="small"
          fullWidth
        />
        <TextField
          label="Scopes"
          value={scopes}
          onChange={(e) => setScopes(e.target.value)}
          helperText="email is required — it's how a person is matched to their account here"
          size="small"
          fullWidth
        />

        <FormControlLabel
          control={
            <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          }
          label={
            <Box>
              <Typography sx={{ fontSize: 14 }}>Enabled</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Shows the button on the sign-in page
              </Typography>
            </Box>
          }
        />

        <FormControlLabel
          control={
            <Switch checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} />
          }
          label={
            <Box>
              <Typography sx={{ fontSize: 14 }}>Create accounts automatically</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Off, someone must already have an account here, matched by email.
                On, anyone the provider vouches for gets in with the role below.
              </Typography>
            </Box>
          }
        />

        {autoCreate && (
          <TextField
            select
            label="Role for new accounts"
            value={defaultRole}
            onChange={(e) => setDefaultRole(e.target.value as RoleID)}
            size="small"
            fullWidth
          >
            {roles.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                <Box>
                  <Typography sx={{ fontSize: 14 }}>{r.title}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {r.description}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </TextField>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 3, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={incomplete || save.isPending}
          onClick={() => {
            setError(null)
            setSaved(false)
            save.mutate()
          }}
        >
          {save.isPending ? 'Checking the issuer…' : 'Save'}
        </Button>
        {provider?.issuer && (
          <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        )}
      </Box>
    </Box>
  )
}
