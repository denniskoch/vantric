import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { Backup } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import { formatBytes } from '../format'

const guestLabels: Record<string, string> = { qemu: 'VM', lxc: 'CT' }

export default function BackupsPage() {
  const queryClient = useQueryClient()
  const [guestFilter, setGuestFilter] = useState('')
  const [confirming, setConfirming] = useState<Backup | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: api.listBackups,
    refetchInterval: 60000,
  })

  const remove = useMutation({
    mutationFn: (backup: Backup) => api.deleteBackup(backup.hypervisorId, backup.node, backup.id),
    onSuccess: () => {
      // The hypervisor deletes on a task, so the archive lingers for a
      // moment; the poll picks up its disappearance.
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  // A busy lab keeps hundreds of these, and you almost always arrive
  // looking for one guest's.
  const guests = [...new Set(backups.map((b) => b.guestName || String(b.vmid)))].sort()
  const shown = guestFilter
    ? backups.filter((b) => (b.guestName || String(b.vmid)) === guestFilter)
    : backups

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Backups"
        description="Guest backup archives on your datastores, newest first."
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TextField
        label="Guest"
        size="small"
        select
        value={guestFilter}
        onChange={(e) => setGuestFilter(e.target.value)}
        sx={{ width: 260, mb: 2 }}
      >
        <MenuItem value="">
          <em>All guests</em>
        </MenuItem>
        {guests.map((guest) => (
          <MenuItem key={guest} value={guest}>
            {guest}
          </MenuItem>
        ))}
      </TextField>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Created</TableCell>
              <TableCell>Guest</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Node</TableCell>
              <TableCell>Datastore</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Archive</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((backup) => (
              <TableRow key={`${backup.hypervisorId}/${backup.id}`} hover>
                <TableCell>
                  {backup.createdAt ? new Date(backup.createdAt * 1000).toLocaleString() : '—'}
                </TableCell>
                <TableCell>
                  {backup.guestName || (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      deleted guest
                    </Box>
                  )}
                  <Box component="span" sx={{ color: 'text.secondary' }}> · {backup.vmid}</Box>
                  {backup.protected && (
                    <Chip
                      label="protected"
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18, ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell>{guestLabels[backup.guestType] ?? backup.guestType ?? '—'}</TableCell>
                <TableCell>{backup.node}</TableCell>
                <TableCell>{backup.storage}</TableCell>
                <TableCell align="right">{formatBytes(backup.sizeBytes)}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{backup.format || '—'}</TableCell>
                <TableCell align="right">
                  <Tooltip
                    title={
                      backup.protected
                        ? 'Protected on the hypervisor — clear that first'
                        : 'Delete this archive'
                    }
                  >
                    <span>
                      <IconButton
                        size="small"
                        disabled={backup.protected || remove.isPending}
                        onClick={() => setConfirming(backup)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No backups on any datastore.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Delete this backup of ${confirming?.guestName || confirming?.vmid}?`}
        body={`${confirming?.name} — ${formatBytes(confirming?.sizeBytes ?? 0)} taken ${
          confirming?.createdAt
            ? new Date(confirming.createdAt * 1000).toLocaleString()
            : 'at an unknown time'
        }. Deleting the archive doesn't touch the guest, but this restore point is gone.`}
        confirmPhrase="I UNDERSTAND"
        confirmLabel="to delete this restore point"
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
