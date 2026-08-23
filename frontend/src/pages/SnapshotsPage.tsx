import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Link,
  Paper,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { Snapshot } from '../api/client'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { settle } from '../bulk'
import { usePermissions } from '../user'

/** A snapshot's identity: the guest it belongs to and its own name,
 *  which is what the delete call takes. Snapshot names are only unique
 *  within one guest — "before-upgrade" exists on half the lab. */
const rowID = (s: Snapshot) => `${s.hypervisorId}/${s.vmName}/${s.name}`

export default function SnapshotsPage() {
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()
  const [picked, setPicked] = useState<string[]>([])
  const [matching, setMatching] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.listSnapshots,
    refetchInterval: 10000,
  })

  const selected = snapshots.filter((s) => picked.includes(rowID(s)))
  const guests = new Set(selected.map((s) => `${s.hypervisorId}/${s.vmName}`))

  // DELETING A SNAPSHOT IS AN OPERATION, so N of them are N operations
  // and the bell is where they report. What comes back here is one
  // outcome for the page, the same rule the instance list follows.
  const remove = useMutation({
    mutationFn: (items: Snapshot[]) => {
      const byRow = new Map(items.map((s) => [rowID(s), s]))
      return settle([...byRow.keys()], (key) => {
        const s = byRow.get(key)!
        return api.deleteInstanceSnapshot(s.vmName, s.name)
      })
    },
    onSuccess: () => {
      setConfirming(false)
      setPicked([])
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['operations'] })
    },
    onError: (e: Error) => {
      setConfirming(false)
      setPicked([])
      setError(e.message)
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
    },
  })

  const columns = useMemo<ColumnDef<(typeof snapshots)[number], unknown>[]>(
    () => [
      {
        id: 'vmName',
        header: 'VM',
        accessorFn: (snap) => snap.vmName,
        cell: ({ row }) => (
          <Link
            component={RouterLink}
            to={`/compute/instances/${row.original.vmName}`}
            underline="hover"
          >
            {row.original.vmName}
          </Link>
        ),
      },
      { id: 'name', header: 'Name', accessorFn: (snap) => snap.name },
      { id: 'node', header: 'Node', accessorFn: (snap) => snap.node },
      {
        id: 'description',
        header: 'Description',
        accessorFn: (snap) => snap.description,
        cell: ({ row }) => row.original.description || '—',
      },
      {
        id: 'createdAt',
        header: 'Created',
        meta: { nowrap: true },
        accessorFn: (snap) => snap.createdAt,
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt * 1000).toLocaleString()
            : '—',
      },
      {
        id: 'includesRam',
        header: 'RAM',
        accessorFn: (snap) => snap.includesRam,
        cell: ({ row }) =>
          row.original.includesRam ? (
            <Chip label="RAM" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
          ) : null,
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Snapshots" />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {canEdit && selected.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            mb: 1,
            px: 1,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: 'surface.infoTint',
            borderColor: '#d2e3fc',
          }}
        >
          <IconButton size="small" aria-label="Clear selection" onClick={() => setPicked([])}>
            <CloseIcon fontSize="small" />
          </IconButton>
          <Typography sx={{ fontSize: 13, color: 'text.primary' }}>{selected.length}</Typography>
          {matching.length > selected.length && (
            <Button size="small" onClick={() => setPicked(matching)}>
              Select all {matching.length}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            startIcon={<DeleteIcon />}
            disabled={remove.isPending}
            onClick={() => setConfirming(true)}
            sx={{ color: '#d93025' }}
          >
            Delete
          </Button>
        </Paper>
      )}

      <DataTable
        rows={snapshots}
        columns={columns}
        selection={picked}
        onSelectionChange={setPicked}
        onFilteredChange={setMatching}
        filterPlaceholder="Filter by VM, snapshot name, node or description"
        getRowId={rowID}
        initialSort={[{ id: 'vmName', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No snapshots found on your servers.'}
      />

      <ConfirmDeleteDialog
        open={confirming}
        title={`Delete ${selected.length} snapshot${selected.length === 1 ? '' : 's'}?`}
        body={`Across ${guests.size} guest${guests.size === 1 ? '' : 's'}. The guests aren't touched, but these restore points are gone.`}
        confirmPhrase="I UNDERSTAND"
        confirmLabel="to delete these restore points"
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => remove.mutate(selected)}
      />
    </Box>
  )
}
