import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Chip,
  IconButton,
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

  const columns = useMemo<ColumnDef<(typeof backups)[number], unknown>[]>(
    () => [
      {
        id: 'guestName',
        header: 'Guest',
        // A backup outlives its guest, so this is blank where the guest
        // is gone — and those sort last rather than leading the list.
        accessorFn: (backup) => backup.guestName,
        // The cell shows the vmid next to the name, so searching for
        // either finds the row. A backup of a deleted guest is only
        // findable by its vmid, which is the case that needs it most.
        meta: { filterText: (backup) => `${backup.guestName ?? ''} ${backup.vmid}` },
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
        id: 'createdAt',
        header: 'Created',
        meta: { nowrap: true },
        accessorFn: (backup) => backup.createdAt,
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt * 1000).toLocaleString()
            : '—',
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
        meta: { align: 'right', filterText: (backup) => formatBytes(backup.sizeBytes) },
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
        meta: { align: 'right', hug: true },
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

      <DataTable
        rows={backups}
        columns={columns}
        getRowId={(backup) => `${backup.hypervisorId}/${backup.id}`}
        initialSort={[{ id: 'createdAt', desc: true }]}
        filterPlaceholder="Filter by guest, vmid, node, datastore, date or format"
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
