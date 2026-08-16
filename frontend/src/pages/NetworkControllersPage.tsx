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
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HelpIcon from '@mui/icons-material/Help'
import { api } from '../api/client'
import type { NetworkProvider } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'

export default function NetworkControllersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<NetworkProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['networkProviders'],
    queryFn: api.listNetworkProviders,
    refetchInterval: 30000,
  })

  const remove = useMutation({
    mutationFn: (provider: NetworkProvider) => api.deleteNetworkProvider(provider.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networkProviders'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Controllers"
        actions={
          <>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
              onClick={() => navigate('/network/controllers/add')}
            >
              Add controller
            </Button>
          </>
        }
        description={
          <>
                The controller that runs your network.
          </>
        }
      />

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
              <TableCell>URL</TableCell>
              <TableCell align="right">Sites</TableCell>
              <TableCell>Version</TableCell>
              <TableCell align="right">Networks</TableCell>
              <TableCell align="right">Clients</TableCell>
              <TableCell align="right">Devices</TableCell>
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
                        <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
                      ) : provider.status === 'unreachable' ? (
                        <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
                      ) : (
                        <HelpIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                      )}
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell>{provider.name}</TableCell>
                <TableCell>{provider.baseUrl}</TableCell>
                <TableCell align="right">{provider.info?.sites ?? '—'}</TableCell>
                <TableCell>{provider.info?.version ?? '—'}</TableCell>
                <TableCell align="right">{provider.info?.networks ?? '—'}</TableCell>
                <TableCell align="right">{provider.info?.clients ?? '—'}</TableCell>
                <TableCell align="right">{provider.info?.devices ?? '—'}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={() => navigate(`/network/controllers/${provider.id}/edit`)}
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
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No controller connected. Click "Add controller" to connect one.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Remove ${confirming?.name}?`}
        body={`This forgets the connection and its stored credentials. ${confirming?.baseUrl} keeps running and your network is untouched.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
