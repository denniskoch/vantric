import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HelpIcon from '@mui/icons-material/Help'
import { api } from '../api/client'
import { BrandLabel } from '../components/BrandIcon'
import { dnsBrand } from '../brands'
import type { DNSProvider, DNSProviderType } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

const typeLabels: Record<DNSProviderType, string> = { cloudflare: 'Cloudflare' }

function StatusGlyph({ provider }: { provider: DNSProvider }) {
  const icon =
    provider.status === 'connected' ? (
      <CheckCircleIcon sx={{ color: '#188038', fontSize: 18 }} />
    ) : provider.status === 'unreachable' ? (
      <ErrorIcon sx={{ color: '#d93025', fontSize: 18 }} />
    ) : (
      <HelpIcon sx={{ color: '#5f6368', fontSize: 18 }} />
    )
  return (
    <Tooltip title={provider.error ? `${provider.status}: ${provider.error}` : provider.status}>
      <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>{icon}</span>
    </Tooltip>
  )
}

export default function DNSProvidersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<DNSProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['dnsProviders'],
    queryFn: api.listDNSProviders,
    refetchInterval: 30000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dnsProviders'] })
    queryClient.invalidateQueries({ queryKey: ['dnsZones'] })
  }

  const remove = useMutation({
    mutationFn: (provider: DNSProvider) => api.deleteDNSProvider(provider.id),
    onSuccess: () => {
      invalidate()
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
        <Typography variant="h5">Providers</Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddBoxIcon />}
          onClick={() => navigate('/dns/providers/add')}
        >
          Add provider
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        DNS accounts this console manages zones through. Credentials stay on the
        server and are never sent back to the browser.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Account</TableCell>
              <TableCell align="right">Zones</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {providers.map((provider) => (
              <TableRow key={provider.id} hover>
                <TableCell>
                  <StatusGlyph provider={provider} />
                </TableCell>
                <TableCell>{provider.name}</TableCell>
                <TableCell>
                  <BrandLabel
                    icon={dnsBrand(provider.type)}
                    label={typeLabels[provider.type] ?? provider.type}
                  />
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {provider.accountId || '—'}
                </TableCell>
                <TableCell align="right">
                  {provider.status === 'connected' ? provider.zones : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => navigate(`/dns/providers/${provider.id}/edit`)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => setConfirming(provider)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No DNS providers yet. Add one to manage zones from here.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Remove ${confirming?.name}?`}
        body="This only removes the provider from this console. Zones and records at the provider are untouched."
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
