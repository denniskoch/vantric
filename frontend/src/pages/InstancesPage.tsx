import { useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Paper,
} from '@mui/material'
import { Tooltip, Typography } from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { Instance } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import ConnectButton from '../components/ConnectButton'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import PageHeader from '../components/PageHeader'
import StatusIcon from '../components/StatusIcon'
import { usePermissions } from '../user'
import { settle } from '../bulk'


export default function InstancesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // The API refuses these for a viewer anyway; offering them and then
  // failing teaches nothing except that the console is broken.
  const { canEdit } = usePermissions()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuInstance, setMenuInstance] = useState<Instance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Instance[] | null>(null)
  // Selection is by name, which is what the API takes. Rows that
  // disappear fall out of the derived list on their own.
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const { data: instances = [], refetch, isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: api.listInstances,
    refetchInterval: 3000,
  })
  const { data: servers = [] } = useQuery({ queryKey: ['hypervisors'], queryFn: api.listHypervisors })
  const hypervisorName = (id: string) => servers.find((s) => s.id === id)?.name ?? '—'

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['instances'] })

  // A power action starts an operation, so the bell should turn now
  // rather than at the end of its next three-second poll.
  const started = () => {
    invalidate()
    queryClient.invalidateQueries({ queryKey: ['operations'] })
  }

  const action = useMutation({
    mutationFn: ({ name, act }: { name: string; act: 'start' | 'stop' | 'reset' }) =>
      api.instanceAction(name, act),
    onSuccess: started,
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (names: string[]) => settle(names, (name) => api.deleteInstance(name)),
    onSuccess: () => {
      setDeleting(null)
      setPicked(new Set())
      invalidate()
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  // Bulk actions run against the eligible subset and report as one:
  // starting four instances shouldn't produce four alerts, and one that
  // refuses shouldn't hide the three that worked.
  const bulk = useMutation({
    mutationFn: ({ act, names }: { act: 'start' | 'stop' | 'reset'; names: string[] }) =>
      settle(names, (name) => api.instanceAction(name, act)),
    onSuccess: started,
    onError: (e: Error) => setError(e.message),
  })

  // Columns as data, so the header, the sort key and the cell live in
  // one place instead of being split across two JSX blocks that have to
  // stay in the same order.
  const columns = useMemo<ColumnDef<Instance, unknown>[]>(
    () => [
      {
        id: 'status',
        header: 'Status',
        meta: { hug: true },
        accessorFn: (i) => i.status,
        cell: ({ row }) => <StatusIcon status={row.original.status} />,
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (i) => i.name,
        cell: ({ row }) => (
          <Link
            component={RouterLink}
            to={`/compute/instances/${row.original.name}`}
            underline="hover"
          >
            {row.original.name}
          </Link>
        ),
      },
      { id: 'node', header: 'Node', accessorFn: (i) => i.node },
      {
        id: 'internalIp',
        header: 'IP address',
        // Sorts on the address, renders the dash. Sorting on what's
        // drawn would order every guest without one under "—".
        accessorFn: (i) => i.internalIp,
        cell: ({ row }) => row.original.internalIp || '—',
      },
      {
        id: 'connect',
        header: 'Connect',
        enableSorting: false,
        // Hugs its content at the right, so the slack goes to the name
        // rather than stranding the button in the middle of the row.
        meta: { align: 'right', hug: true },
        cell: ({ row }) => <ConnectButton instance={row.original} />,
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { align: 'right', hug: true },
        cell: ({ row }) =>
          canEdit ? (
            <IconButton size="small" onClick={(e) => openMenu(e, row.original)}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          ) : null,
      },
    ],
    [canEdit],
  )

  const selected = instances.filter((i) => picked.has(i.name))
  const eligible = (want: (i: Instance) => boolean) =>
    selected.filter(want).map((i) => i.name)
  const startable = eligible((i) => i.status === 'TERMINATED')
  const stoppable = eligible((i) => i.status === 'RUNNING')
  const running = selected.filter((i) => i.status === 'RUNNING' || i.status === 'STAGING')
  const protectedOnes = selected.filter((i) => i.protected)
  const deleteBlocked =
    running.length > 0
      ? `${running.length === 1 ? running[0].name + ' is' : running.length + ' of these are'} still running — stop first`
      : protectedOnes.length > 0
        ? `${protectedOnes.length === 1 ? protectedOnes[0].name + ' has' : protectedOnes.length + ' of these have'} deletion protection`
        : ''

  const openMenu = (e: React.MouseEvent<HTMLElement>, inst: Instance) => {
    setMenuAnchor(e.currentTarget)
    setMenuInstance(inst)
  }
  const closeMenu = () => setMenuAnchor(null)

  const act = (act: 'start' | 'stop' | 'reset') => {
    if (menuInstance) action.mutate({ name: menuInstance.name, act })
    closeMenu()
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Virtual machines"
        actions={
          <>
            {canEdit && (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddBoxIcon />}
                onClick={() => navigate('/compute/instances/create')}
              >
                Create instance
              </Button>
            )}
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => refetch()}>
              Refresh
            </Button>
          </>
        }
      />

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
            gap: 0.5,
            bgcolor: 'surface.infoTint',
            borderColor: '#d2e3fc',
          }}
        >
          <IconButton size="small" aria-label="Clear selection" onClick={() => setPicked(new Set())}>
            <CloseIcon fontSize="small" />
          </IconButton>
          <Typography sx={{ fontSize: 13, color: 'text.primary', mx: 1 }}>{selected.length}</Typography>
          <Button
            size="small"
            startIcon={<PlayArrowIcon />}
            disabled={startable.length === 0 || bulk.isPending}
            onClick={() => bulk.mutate({ act: 'start', names: startable })}
          >
            Start
          </Button>
          <Button
            size="small"
            startIcon={<StopIcon />}
            disabled={stoppable.length === 0 || bulk.isPending}
            onClick={() => bulk.mutate({ act: 'stop', names: stoppable })}
          >
            Stop
          </Button>
          <Button
            size="small"
            startIcon={<RestartAltIcon />}
            disabled={stoppable.length === 0 || bulk.isPending}
            onClick={() => bulk.mutate({ act: 'reset', names: stoppable })}
          >
            Reset
          </Button>
          <Box sx={{ flex: 1 }} />
          {/* Disabled alone would just be a mystery, so the reason is
              the tooltip and it names the instance in the way. */}
          <Tooltip title={deleteBlocked}>
            <span>
              <Button
                size="small"
                startIcon={<DeleteIcon />}
                disabled={Boolean(deleteBlocked)}
                onClick={() => setDeleting(selected)}
                sx={{ color: deleteBlocked ? undefined : '#d93025' }}
              >
                Delete
              </Button>
            </span>
          </Tooltip>
        </Paper>
      )}

      <DataTable
        rows={instances}
        columns={columns}
        filterPlaceholder="Filter by name, node or IP address"
        getRowId={(i) => i.name}
        initialSort={[{ id: 'name', desc: false }]}
        selection={[...picked]}
        onSelectionChange={(ids) => setPicked(new Set(ids))}
        selectable={canEdit}
        empty={
          isLoading ? 'Loading…' : 'No virtual machines yet. Click "Create instance" to get started.'
        }
      />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => act('start')}
          disabled={menuInstance?.status !== 'TERMINATED'}
        >
          <PlayArrowIcon fontSize="small" sx={{ mr: 1 }} /> Start
        </MenuItem>
        <MenuItem
          onClick={() => act('stop')}
          disabled={menuInstance?.status !== 'RUNNING'}
        >
          <StopIcon fontSize="small" sx={{ mr: 1 }} /> Stop
        </MenuItem>
        <MenuItem
          onClick={() => act('reset')}
          disabled={menuInstance?.status !== 'RUNNING'}
        >
          <RestartAltIcon fontSize="small" sx={{ mr: 1 }} /> Reset
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuInstance) setDeleting([menuInstance])
            closeMenu()
          }}
          disabled={menuInstance?.protected || isPoweredOn(menuInstance)}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          {menuInstance?.protected
            ? 'Delete (protected)'
            : isPoweredOn(menuInstance)
              ? 'Delete (stop it first)'
              : 'Delete'}
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={
          deleting && deleting.length === 1
            ? `Delete ${deleting[0].name}?`
            : `Delete ${deleting?.length} instances?`
        }
        body={
          <>
            This destroys{' '}
            {deleting && deleting.length === 1
              ? 'the virtual machine and its disks on ' + hypervisorName(deleting[0].hypervisorId)
              : deleting?.map((i) => i.name).join(', ')}
            . Snapshots and backups taken of{' '}
            {deleting && deleting.length === 1 ? 'it' : 'them'} are not removed, but
            nothing else brings {deleting && deleting.length === 1 ? 'this instance' : 'them'}{' '}
            back.
          </>
        }
        confirmPhrase={
          deleting && deleting.length === 1 ? deleting[0].name : 'I UNDERSTAND'
        }
        confirmLabel={deleting && deleting.length === 1 ? 'to delete it' : 'to delete them'}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.map((i) => i.name))}
      />
    </Box>
  )
}

function isPoweredOn(inst: Instance | null): boolean {
  return inst?.status === 'RUNNING' || inst?.status === 'STAGING'
}

