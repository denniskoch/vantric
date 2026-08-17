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
import type { StorageProvider } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import UsageBar from '../components/UsageBar'
import { formatUptime } from '../format'

const typeLabels: Record<string, string> = { rustfs: 'RustFS' }

function StatusGlyph({ provider }: { provider: StorageProvider }) {
  const icon =
    provider.status === 'connected' ? (
      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
    ) : provider.status === 'unreachable' ? (
      <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
    ) : (
      <HelpIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
    )
  return (
    <Tooltip title={provider.error ? `${provider.status}: ${provider.error}` : provider.status}>
      <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>{icon}</span>
    </Tooltip>
  )
}

export default function StorageInstancesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<StorageProvider | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
    refetchInterval: 30000,
  })

  const remove = useMutation({
    mutationFn: (p: StorageProvider) => api.deleteStorageProvider(p.id),
    onSuccess: () => {
      setConfirming(null)
      queryClient.invalidateQueries({ queryKey: ['storageProviders'] })
      queryClient.invalidateQueries({ queryKey: ['buckets'] })
    },
    onError: (e: Error) => {
      setConfirming(null)
      setError(e.message)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Object stores"
        actions={
          <Button
            variant="contained"
            size="small"
            startIcon={<AddBoxIcon />}
            onClick={() => navigate('/storage/instances/add')}
          >
            Add store
          </Button>
        }
        description="S3-compatible stores this console manages buckets through."
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
              <TableCell>Type</TableCell>
              <TableCell>Endpoint</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Capacity</TableCell>
              <TableCell>Uptime</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {providers.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>
                  <StatusGlyph provider={p} />
                </TableCell>
                <TableCell>{p.name}</TableCell>
                <TableCell>{typeLabels[p.type] ?? p.type}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{p.baseUrl}</TableCell>
                {/* Everything from here on needs the admin API, so it's
                    blank rather than zero on a store that has none. */}
                <TableCell sx={{ fontSize: 12 }}>
                  {p.info?.version ? p.info.version.split('@').pop() : '—'}
                </TableCell>
                <TableCell>
                  {p.info?.totalBytes ? (
                    <UsageBar used={p.info.usedBytes} total={p.info.totalBytes} minWidth={150} />
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {p.info?.uptimeSeconds ? formatUptime(p.info.uptimeSeconds) : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => navigate(`/storage/instances/${p.id}/edit`)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => setConfirming(p)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No object stores yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Remove ${confirming?.name}?`}
        body="This only removes the store from this console. Its buckets and objects are untouched, and re-adding it brings them back into view."
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
