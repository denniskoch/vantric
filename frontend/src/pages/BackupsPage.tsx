import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Chip,
  IconButton,
  MenuItem,
  Tooltip,
} from '@mui/material'
import SelectField from '../components/SelectField'
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

  const columns = useMemo<ColumnDef<(typeof shown)[number], unknown>[]>(
    () => [
      {
        id: 'createdAt',
        header: 'Created',
        accessorFn: (backup) => backup.createdAt,
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt * 1000).toLocaleString()
            : '—',
      },
      {
        id: 'guestName',
        header: 'Guest',
        // A backup outlives its guest, so this is blank where the guest
        // is gone — and those sort last rather than leading the list.
        accessorFn: (backup) => backup.guestName,
        cell: ({ row }) => (
          <>
            {row.original.guestName || (
              <Box component="span" sx={{ color: 'text.secondary' }}>
                deleted guest
              </Box>
            )}
            <Box component="span" sx={{ color: 'text.secondary' }}> · {row.original.vmid}</Box>
            {row.original.protected && (
              <Chip
                label="protected"
                size="small"
                variant="outlined"
                sx={{ fontSize: 10, height: 18, ml: 1 }}
              />
            )}
          </>
        ),
      },
      {
        id: 'guestType',
        header: 'Type',
        accessorFn: (backup) => guestLabels[backup.guestType] ?? backup.guestType,
        cell: ({ row }) =>
          guestLabels[row.original.guestType] ?? row.original.guestType ?? '—',
      },
      { id: 'node', header: 'Node', accessorFn: (backup) => backup.node },
      { id: 'storage', header: 'Datastore', accessorFn: (backup) => backup.storage },
      {
        id: 'size',
        header: 'Size',
        accessorFn: (backup) => backup.sizeBytes,
        meta: { align: 'right' },
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
      {
        id: 'format',
        header: 'Archive',
        accessorFn: (backup) => backup.format,
        cell: ({ row }) => (
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {row.original.format || '—'}
          </Box>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <Tooltip
            title={
              row.original.protected
                ? 'Protected on the hypervisor — clear that first'
                : 'Delete this archive'
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={row.original.protected || remove.isPending}
                onClick={() => setConfirming(row.original)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ),
      },
    ],
    [remove.isPending],
  )

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

      <SelectField
        label="Guest"
        size="small"
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
      </SelectField>

      <DataTable
        rows={shown}
        columns={columns}
        getRowId={(backup) => `${backup.hypervisorId}/${backup.id}`}
        initialSort={[{ id: 'createdAt', desc: true }]}
        empty={isLoading ? 'Loading…' : 'No backups on any datastore.'}
      />

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
