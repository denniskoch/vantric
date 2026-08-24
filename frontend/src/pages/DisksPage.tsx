import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, IconButton, Link, Tooltip, Typography } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { Disk } from '../api/client'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import FilterSelect from '../components/FilterSelect'
import { usePermissions } from '../user'

/**
 * Every VM disk, in all three states one can be in.
 *
 * THE LIST USED TO BE ONLY THE UNDELETABLE ONES. It carried attached
 * disks alone, which is exactly the set the API refuses to delete —
 * while the volumes that cost space for nothing, a detached disk and
 * one whose guest was removed out-of-band, appeared on no page in this
 * console or in Proxmox.
 */
export default function DisksPage() {
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()
  const [attachment, setAttachment] = useState('')
  const [deleting, setDeleting] = useState<Disk | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: disks = [], isLoading } = useQuery({
    queryKey: ['disks'],
    queryFn: api.listDisks,
    refetchInterval: 10000,
  })

  const remove = useMutation({
    mutationFn: (d: Disk) => api.deleteDisk(d.hypervisorId, d.id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['disks'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  const rows = disks.filter((d) => attachment === '' || d.attachment === attachment)
  const reclaimable = disks.filter((d) => d.attachment !== 'attached')

  const columns = useMemo<ColumnDef<Disk, unknown>[]>(
    () => [
      { id: 'name', header: 'Name', meta: { width: 280 }, accessorFn: (d) => d.name },
      {
        id: 'attachment',
        header: 'State',
        meta: { nowrap: true },
        accessorFn: (d) => d.attachment,
        cell: ({ row }) => <State disk={row.original} />,
      },
      {
        id: 'inUseBy',
        header: 'Guest',
        meta: { nowrap: true },
        accessorFn: (d) => d.inUseBy,
        cell: ({ row }) =>
          row.original.inUseBy ? (
            <Link
              component={RouterLink}
              to={`/compute/instances/${row.original.inUseBy}`}
              underline="hover"
            >
              {row.original.inUseBy}
            </Link>
          ) : (
            <Box component="span" sx={{ color: 'text.disabled' }}>
              —
            </Box>
          ),
      },
      { id: 'node', header: 'Node', meta: { nowrap: true }, accessorFn: (d) => d.node },
      { id: 'storage', header: 'Storage pool', meta: { nowrap: true }, accessorFn: (d) => d.storage },
      {
        id: 'sizeGb',
        header: 'Size (GB)',
        accessorFn: (d) => d.sizeGb,
        meta: { align: 'right', nowrap: true },
        cell: ({ row }) => row.original.sizeGb || '—',
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { hug: true },
        cell: ({ row }) => {
          const attached = row.original.attachment === 'attached'
          return (
            canEdit && (
              // Disabled ALONE would be a mystery, so the reason is the
              // tooltip — and it names the guest holding it, which is
              // where the detach lives.
              <Tooltip
                title={
                  attached
                    ? `Attached to ${row.original.inUseBy}. Detach it first.`
                    : 'Delete this volume'
                }
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={attached || remove.isPending}
                    onClick={() => setDeleting(row.original)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )
          )
        },
      },
    ],
    [canEdit, remove.isPending],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Disks" />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <FilterSelect
          anyLabel="Any state"
          value={attachment}
          onChange={setAttachment}
          options={[
            { value: 'attached', label: 'Attached' },
            { value: 'detached', label: 'Detached' },
            { value: 'orphaned', label: 'Orphaned' },
          ]}
        />
        {/* The number is the finding: space nothing is using. Said
            here rather than as a banner, and absent when it is zero. */}
        {reclaimable.length > 0 && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {reclaimable.length} unused
            {reclaimable.some((d) => d.sizeGb > 0) &&
              ` · ${reclaimable.reduce((n, d) => n + d.sizeGb, 0)} GB`}
          </Typography>
        )}
      </Box>

      <DataTable
        rows={rows}
        columns={columns}
        filterPlaceholder="Filter by name, guest, node or storage pool"
        getRowId={(d) => `${d.hypervisorId}/${d.id}`}
        initialSort={[{ id: 'attachment', desc: true }]}
        empty={isLoading ? 'Loading…' : 'No disks found on your hypervisors.'}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name}?`}
        confirmPhrase={deleting?.name}
        body={
          deleting?.attachment === 'orphaned'
            ? 'Nothing references this volume. Its contents are gone for good.'
            : `${deleting?.inUseBy} is not using this volume. Its contents are gone for good.`
        }
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Box>
  )
}

/**
 * Three states, and only one of them is ordinary.
 *
 * Attached is the normal case and gets no colour. Detached and orphaned
 * are both space nothing is using, which is the reason to look at this
 * page at all.
 */
function State({ disk }: { disk: Disk }) {
  if (disk.attachment === 'attached') {
    return <Box component="span">attached</Box>
  }
  return (
    <Typography component="span" sx={{ fontSize: 13, color: '#b06000' }}>
      {disk.attachment === 'orphaned' ? 'orphaned' : 'detached'}
    </Typography>
  )
}
