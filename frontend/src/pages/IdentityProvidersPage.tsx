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
import type { IdentityProvider } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { providerLabels } from '../identity'

export default function IdentityProvidersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<IdentityProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['identityProviders'],
    queryFn: api.listIdentityProviders,
    refetchInterval: 30000,
  })

  const remove = useMutation({
    mutationFn: (provider: IdentityProvider) => api.deleteIdentityProvider(provider.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identityProviders'] })
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
          onClick={() => navigate('/identity/providers/add')}
        >
          Add provider
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The identity service your lab signs in through. It owns the directory —
        this console reads it and performs the everyday changes.
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
              <TableCell>Type</TableCell>
              <TableCell>URL</TableCell>
              <TableCell>Version</TableCell>
              <TableCell align="right">Users</TableCell>
              <TableCell align="right">Groups</TableCell>
              <TableCell align="right">Apps</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {providers.map((provider) => (
              <TableRow key={provider.id} hover>
                <TableCell>
                  <Tooltip title={provider.error || provider.status}>
                    <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                      {provider.status === 'connected' ? (
                        <CheckCircleIcon sx={{ color: '#188038', fontSize: 18 }} />
                      ) : provider.status === 'unreachable' ? (
                        <ErrorIcon sx={{ color: '#d93025', fontSize: 18 }} />
                      ) : (
                        <HelpIcon sx={{ color: '#5f6368', fontSize: 18 }} />
                      )}
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell>{provider.name}</TableCell>
                <TableCell>{providerLabels[provider.type] ?? provider.type}</TableCell>
                <TableCell>{provider.baseUrl}</TableCell>
                <TableCell>
                  {provider.info?.version ?? '—'}
                  {provider.info?.outdated && provider.info.latestVersion && (
                    <Tooltip title={`${provider.info.latestVersion} is available`}>
                      <Box component="span" sx={{ color: '#f29900', ml: 1 }}>
                        update available
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell align="right">{provider.info?.users ?? '—'}</TableCell>
                <TableCell align="right">{provider.info?.groups ?? '—'}</TableCell>
                <TableCell align="right">{provider.info?.applications ?? '—'}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={() => navigate(`/identity/providers/${provider.id}/edit`)}
                  >
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
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No identity provider connected. Click "Add provider" to connect one.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Remove ${confirming?.name}?`}
        body={`This forgets the connection and its stored token. ${confirming?.baseUrl} keeps running and its directory is untouched.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
