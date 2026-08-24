import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import RequireRole from '../components/RequireRole'

/**
 * Connecting a Docker daemon.
 *
 * THE FINGERPRINT IS THE POINT OF THIS FORM. A self-hosted daemon
 * presents a certificate no CA has signed, and the console's older
 * answer — an "ignore TLS errors" checkbox — means anything on the LAN
 * can sit in the middle and read the token. Pinning the certificate
 * fixes that without a CA, and costs one paste.
 *
 * FETCHING IT IS TRUST-ON-FIRST-USE AND THE FORM SAYS SO. What comes
 * back from Read is only as good as the network being clean right now,
 * which is the assumption pinning exists to remove — so the value
 * arrives next to the command that prints the real one, and the
 * comparison is the operator's to make.
 */
export default function DockerHostFormPage() {
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://')
  const [token, setToken] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [insecureTls, setInsecureTls] = useState(false)
  const [seen, setSeen] = useState<{ fingerprint: string; subject: string; notAfter: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  const { data: existing } = useQuery({
    queryKey: ['dockerHosts'],
    queryFn: api.listDockerHosts,
    enabled: editing,
    select: (all) => all.find((h) => h.id === id),
  })

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setBaseUrl(existing.baseUrl)
    setFingerprint(existing.fingerprint)
    setInsecureTls(existing.insecureTls)
  }, [existing])

  const peek = useMutation({
    mutationFn: () => api.peekDockerHost(baseUrl),
    onSuccess: (cert) => {
      setSeen(cert)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const save = useMutation({
    mutationFn: () => {
      const body = { name, baseUrl, token, fingerprint, insecureTls }
      return editing ? api.updateDockerHost(id!, body) : api.createDockerHost(body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dockerHosts'] })
      navigate('/docker/settings/hosts')
    },
    onError: (e: Error) => setError(e.message),
  })

  const complete = name.trim() !== '' && /^https?:\/\/.+/.test(baseUrl.trim())

  return (
    <RequireRole admin>
      <Box sx={{ p: 3, maxWidth: 760 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/docker/settings/hosts')}
          >
            Docker hosts
          </Button>
        </Box>
        <PageHeader title={editing ? 'Edit Docker host' : 'Connect Docker host'} />

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
          />
          <TextField
            label="Address"
            size="small"
            fullWidth
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            helperText="https://host:9443"
          />
          <TextField
            label="Token"
            size="small"
            fullWidth
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            helperText={
              editing
                ? 'Leave blank to keep the stored token.'
                : 'Leave blank if the host takes none.'
            }
          />

          <Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField
                label="Certificate fingerprint"
                size="small"
                fullWidth
                value={fingerprint}
                onChange={(e) => setFingerprint(e.target.value)}
                slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
                helperText="SHA-256 of the host's certificate. Colons optional."
              />
              <Button
                size="small"
                disabled={!/^https:\/\/.+/.test(baseUrl.trim()) || peek.isPending}
                onClick={() => peek.mutate()}
              >
                Read
              </Button>
            </Box>

            {seen && (
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography sx={{ fontSize: 13, mb: 0.5 }}>
                  That host is presenting a certificate for <strong>{seen.subject}</strong>,
                  valid until {new Date(seen.notAfter).toLocaleDateString()}.
                </Typography>
                <Box sx={{ fontFamily: 'monospace', fontSize: 11, overflowWrap: 'anywhere', mb: 1 }}>
                  {seen.fingerprint}
                </Box>
                {/* The whole point of the confirmation: this value came
                    over the network we are trying not to trust. */}
                <Typography sx={{ fontSize: 12, mb: 1 }}>
                  Check it against the host before accepting. capstan prints it at startup;
                  on a Proxmox node, <code>pvenode cert info</code>.
                </Typography>
                <Button size="small" variant="outlined" onClick={() => setFingerprint(seen.fingerprint)}>
                  Use this fingerprint
                </Button>
              </Alert>
            )}
          </Box>

          {/* Offered, but second, and it says what it costs. A pinned
              certificate is verified; an allowed one is not. */}
          <FormControlLabel
            control={
              <Checkbox
                checked={insecureTls}
                disabled={fingerprint.trim() !== ''}
                onChange={(e) => setInsecureTls(e.target.checked)}
              />
            }
            label={
              <Typography sx={{ fontSize: 14 }}>
                Accept any certificate
                <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 1 }}>
                  {fingerprint.trim()
                    ? 'not used while a fingerprint is set'
                    : 'anything on the network path can read the token'}
                </Typography>
              </Typography>
            }
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
            {editing ? 'Save' : 'Connect'}
          </Button>
          <Button onClick={() => navigate('/docker/settings/hosts')}>Cancel</Button>
        </Box>
      </Box>
    </RequireRole>
  )
}
