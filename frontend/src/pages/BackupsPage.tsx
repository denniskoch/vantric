import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import RestoreIcon from '@mui/icons-material/SettingsBackupRestore'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import { api } from '../api/client'
import type { Backup } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import TimeRangePicker from '../components/TimeRangePicker'
import { ANY_TIME, inRange } from '../timeRange'
import type { TimeRange } from '../timeRange'
import { formatBytes } from '../format'
import { settle } from '../bulk'
import { usePermissions } from '../user'

const guestLabels: Record<string, string> = { qemu: 'VM', lxc: 'CT' }

/** An archive's identity here. See removeMany for why it is composite. */
const rowID = (b: Backup) => `${b.hypervisorId}/${b.id}`

export default function BackupsPage() {
  const [range, setRange] = useState<TimeRange>(ANY_TIME)
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<Backup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  // Ids rather than rows: the list is polled, and holding the objects
  // would keep a selection pointing at archives that have since gone.
  const [picked, setPicked] = useState<string[]>([])
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  // Every archive the filter matches, across pages — so narrowing to
  // one dead guest's vmid and clearing the lot is one click rather
  // than one per page.
  const [matching, setMatching] = useState<string[]>([])

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: api.listBackups,
    refetchInterval: 60000,
  })

  // A protected archive is one the hypervisor refuses to delete, so the
  // console has to be able to clear the flag it can set.
  const protect = useMutation({
    mutationFn: (v: { b: Backup; on: boolean }) =>
      api.setBackupProtection(v.b.hypervisorId, v.b.node, v.b.id, v.on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
    onError: (e: Error) => setError(e.message),
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

  // ONE OUTCOME FOR N DELETES, the rule the instance list already
  // follows: every call is issued, none abandoned because an earlier
  // one failed, and what comes back names how many of how many.
  const removeMany = useMutation({
    mutationFn: (items: Backup[]) => {
      // KEYED BY hypervisorId/volid, NOT by the volid alone. Both of
      // this lab's hypervisors write to a datastore called `synology`
      // and their vmids overlap, so two archives can carry the same
      // volume id — and a lookup on that would delete one of them
      // twice and leave the other.
      const byRow = new Map(items.map((b) => [rowID(b), b]))
      return settle([...byRow.keys()], (key) => {
        const b = byRow.get(key)!
        return api.deleteBackup(b.hypervisorId, b.node, b.id)
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setConfirmingBulk(false)
      setPicked([])
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setConfirmingBulk(false)
      setPicked([])
      setError(e.message)
    },
  })

  // An archive's date is the thing you narrow a backup list by, and
  // the text box can only match the date as it happens to be spelled.
  const shown = useMemo(
    () => backups.filter((b) => inRange(range, b.createdAt)),
    [backups, range],
  )

  const selected = shown.filter((b) => picked.includes(rowID(b)))
  // THE ELIGIBLE SUBSET, not a refusal: the hypervisor won't delete a
  // protected archive, so a mixed selection deletes the rest and the
  // bar says how many it left alone.
  const deletable = selected.filter((b) => !b.protected)
  const held = selected.length - deletable.length
  const totalBytes = deletable.reduce((sum, b) => sum + b.sizeBytes, 0)
  // An archive whose guest is still there. Blank means the guest is
  // gone, which is the case this page's bulk delete exists for.
  const live = deletable.filter((b) => b.guestName !== '')

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
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            {/* Restore before delete, and not only alphabetically: an
                archive exists to be restored, and deleting one is the
                thing you do to the ones you no longer need. */}
            <Tooltip title="Restore this archive">
              <span>
                <IconButton
                  size="small"
                  disabled={!canEdit}
                  onClick={() =>
                    navigate(
                      `/compute/backups/restore?hypervisor=${row.original.hypervisorId}` +
                        `&volume=${encodeURIComponent(row.original.id)}`,
                    )
                  }
                >
                  <RestoreIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={
                row.original.protected ? 'Keeping this one. Click to stop.' : 'Keep regardless of retention'
              }
            >
              <IconButton
                size="small"
                disabled={!canEdit || protect.isPending}
                onClick={() => protect.mutate({ b: row.original, on: !row.original.protected })}
              >
                {row.original.protected ? (
                  <LockIcon sx={{ fontSize: 16, color: '#b06000' }} />
                ) : (
                  <LockOpenIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip
              title={
                row.original.protected
                  ? 'Protected — stop keeping it first'
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
          </Box>
        ),
      },
    ],
    [remove.isPending, protect.isPending, canEdit, navigate],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Backups" />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', mb: 2 }}>
        <TimeRangePicker value={range} onChange={setRange} />
      </Box>

      {canEdit && selected.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            mb: 1,
            px: 1,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            bgcolor: 'surface.infoTint',
            borderColor: '#d2e3fc',
          }}
        >
          <IconButton size="small" aria-label="Clear selection" onClick={() => setPicked([])}>
            <CloseIcon fontSize="small" />
          </IconButton>
          <Typography sx={{ fontSize: 13, color: 'text.primary', mx: 1 }}>
            {selected.length}
          </Typography>
          {held > 0 && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {held} protected on the hypervisor and will be left alone
            </Typography>
          )}
          {matching.length > selected.length && (
            <Button size="small" onClick={() => setPicked(matching)}>
              Select all {matching.length}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mr: 1 }}>
            {formatBytes(totalBytes)}
          </Typography>
          <Button
            size="small"
            startIcon={<DeleteIcon />}
            disabled={deletable.length === 0 || removeMany.isPending}
            onClick={() => setConfirmingBulk(true)}
            sx={{ color: deletable.length === 0 ? undefined : '#d93025' }}
          >
            Delete
          </Button>
        </Paper>
      )}

      <DataTable
        rows={shown}
        columns={columns}
        selection={picked}
        onSelectionChange={setPicked}
        onFilteredChange={setMatching}
        getRowId={rowID}
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

      {/* The same typed phrase the single delete asks for. A bulk
          delete is the one that most needs reading twice, and the
          count is the thing to read. */}
      <ConfirmDeleteDialog
        open={confirmingBulk}
        title={`Delete ${deletable.length} backup${deletable.length === 1 ? '' : 's'}?`}
        body={
          <>
            {formatBytes(totalBytes)} across {guestCount(deletable)}. The guests aren't
            touched, but these restore points are gone.
            {/* THE HAZARD IN THE OBVIOUS WORKFLOW. Clearing out a dead
                guest means filtering by its vmid — and a vmid is only
                unique within one hypervisor, so the same number can
                belong to a guest that is alive and well on the other.
                Saying which live guests are in the selection is the
                difference between tidying up and deleting the backups
                of something you still run. */}
            {live.length > 0 && (
              <Box sx={{ mt: 1, color: '#b06000' }}>
                {live.length} of these belong to guests that still exist:{' '}
                {[...new Set(live.map((b) => b.guestName))].join(', ')}.
              </Box>
            )}
          </>
        }
        confirmPhrase="I UNDERSTAND"
        confirmLabel="to delete these restore points"
        pending={removeMany.isPending}
        onCancel={() => setConfirmingBulk(false)}
        onConfirm={() => removeMany.mutate(deletable)}
      />
    </Box>
  )
}

/** How many guests a set of archives belongs to — the number that says
 *  whether you are clearing out one deleted VM or half the lab. */
function guestCount(items: Backup[]): string {
  // hypervisorId AND vmid: a vmid is unique within one hypervisor, and
  // this lab has the same number in use on both.
  const guests = new Set(items.map((b) => `${b.hypervisorId}/${b.vmid}`))
  return guests.size === 1
    ? `1 guest`
    : `${guests.size} guests`
}
