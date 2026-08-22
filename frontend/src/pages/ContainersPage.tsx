import { useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import RefreshIcon from '@mui/icons-material/Refresh'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteIcon from '@mui/icons-material/Delete'
import CloseIcon from '@mui/icons-material/Close'
import { Button } from '@mui/material'
import { api } from '../api/client'
import type { Container } from '../api/client'
import StatusIcon from '../components/StatusIcon'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import { usePermissions } from '../user'
import { settle } from '../bulk'

// CT (LXC) instances. Separate from VM instances by design — they
// list and provision differently.
export default function ContainersPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuContainer, setMenuContainer] = useState<Container | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Container[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const { data: containers = [], refetch, isLoading } = useQuery({
    queryKey: ['containers'],
    queryFn: api.listContainers,
    refetchInterval: 3000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['containers'] })

  // A power action starts an operation, so the bell should turn now
  // rather than at the end of its next three-second poll.
  const started = () => {
    invalidate()
    queryClient.invalidateQueries({ queryKey: ['operations'] })
  }

  const action = useMutation({
    mutationFn: ({ name, act }: { name: string; act: 'start' | 'stop' | 'reset' }) =>
      api.containerAction(name, act),
    onSuccess: started,
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (names: string[]) => settle(names, (name) => api.deleteContainer(name)),
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

  // Same model as VM instances: each action runs against the ELIGIBLE
  // subset, so a mixed selection isn't a refusal, and N requests report
  // as one outcome.
  const bulk = useMutation({
    mutationFn: ({ act, names }: { act: 'start' | 'stop' | 'reset'; names: string[] }) =>
      settle(names, (name) => api.containerAction(name, act)),
    onSuccess: started,
    onError: (e: Error) => setError(e.message),
  })

  const columns = useMemo<ColumnDef<Container, unknown>[]>(
    () => [
      {
        id: 'status',
        header: 'Status',
        meta: { hug: true },
        accessorFn: (ct) => ct.status,
        cell: ({ row }) => <StatusIcon status={row.original.status} />,
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (ct) => ct.name,
        cell: ({ row }) => (
          <Link
            component={RouterLink}
            to={`/compute/containers/${row.original.name}`}
            underline="hover"
          >
            {row.original.name}
          </Link>
        ),
      },
      { id: 'node', header: 'Node', accessorFn: (ct) => ct.node },
      {
        id: 'cpus',
        header: 'vCPUs',
        accessorFn: (ct) => ct.cpus,
        meta: { align: 'right' },
      },
      {
        id: 'memoryMb',
        header: 'Memory (MB)',
        accessorFn: (ct) => ct.memoryMb,
        meta: { align: 'right' },
      },
      {
        id: 'internalIp',
        header: 'Internal IP',
        accessorFn: (ct) => ct.internalIp,
        cell: ({ row }) => row.original.internalIp || '—',
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

  const selected = containers.filter((ct) => picked.has(ct.name))
  const eligible = (want: (ct: Container) => boolean) =>
    selected.filter(want).map((ct) => ct.name)
  const startable = eligible((ct) => ct.status === 'TERMINATED')
  const stoppable = eligible((ct) => ct.status === 'RUNNING')
  const running = selected.filter((ct) => ct.status === 'RUNNING' || ct.status === 'STAGING')
  const protectedOnes = selected.filter((ct) => ct.protected)
  const deleteBlocked =
    running.length > 0
      ? `${running.length === 1 ? running[0].name + ' is' : running.length + ' of these are'} still running — stop first`
      : protectedOnes.length > 0
        ? `${protectedOnes.length === 1 ? protectedOnes[0].name + ' has' : protectedOnes.length + ' of these have'} deletion protection`
        : ''

  const openMenu = (e: React.MouseEvent<HTMLElement>, ct: Container) => {
    setMenuAnchor(e.currentTarget)
    setMenuContainer(ct)
  }
  const closeMenu = () => setMenuAnchor(null)

  const act = (act: 'start' | 'stop' | 'reset') => {
    if (menuContainer) action.mutate({ name: menuContainer.name, act })
    closeMenu()
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Container instances"
        actions={
          <>
            {canEdit && (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddBoxIcon />}
                onClick={() => navigate('/compute/containers/create')}
              >
                Create container
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
            Restart
          </Button>
          <Box sx={{ flex: 1 }} />
          {/* Disabled alone would be a mystery, so the reason is the
              tooltip and it names the container in the way. */}
          <Tooltip title={deleteBlocked}>
            <span>
              <Button
                size="small"
                startIcon={<DeleteIcon />}
                disabled={Boolean(deleteBlocked)}
                onClick={() => setDeleting(selected)}
                sx={{ color: deleteBlocked ? undefined : 'error.main' }}
              >
                Delete
              </Button>
            </span>
          </Tooltip>
        </Paper>
      )}

      <DataTable
        rows={containers}
        columns={columns}
        filterPlaceholder="Filter by name, node or IP address"
        getRowId={(ct) => ct.name}
        initialSort={[{ id: 'name', desc: false }]}
        selection={[...picked]}
        onSelectionChange={(ids) => setPicked(new Set(ids))}
        selectable={canEdit}
        empty={isLoading ? 'Loading…' : 'No containers found on your servers.'}
      />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => act('start')}
          disabled={menuContainer?.status !== 'TERMINATED'}
        >
          <PlayArrowIcon fontSize="small" sx={{ mr: 1 }} /> Start
        </MenuItem>
        <MenuItem
          onClick={() => act('stop')}
          disabled={menuContainer?.status !== 'RUNNING'}
        >
          <StopIcon fontSize="small" sx={{ mr: 1 }} /> Stop
        </MenuItem>
        <MenuItem
          onClick={() => act('reset')}
          disabled={menuContainer?.status !== 'RUNNING'}
        >
          <RestartAltIcon fontSize="small" sx={{ mr: 1 }} /> Restart
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleting(menuContainer ? [menuContainer] : null)
            closeMenu()
          }}
          disabled={menuContainer?.protected || isPoweredOn(menuContainer)}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          {/* A disabled item should say which of the two reasons it is. */}
          {menuContainer?.protected
            ? 'Delete (protected)'
            : isPoweredOn(menuContainer)
              ? 'Delete (stop it first)'
              : 'Delete'}
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={
          deleting?.length === 1 ? `Delete ${deleting[0].name}?` : `Delete ${deleting?.length} containers?`
        }
        body={
          <>
            This destroys{' '}
            {deleting?.length === 1 ? 'the container and its root filesystem' : 'these containers and their root filesystems'}.
            Backups taken of {deleting?.length === 1 ? 'it' : 'them'} are not removed, but nothing
            else brings {deleting?.length === 1 ? 'it' : 'them'} back.
          </>
        }
        // Typing the name can't be muscle memory; for several, the count
        // is the thing to read rather than a name nobody would retype.
        confirmPhrase={deleting?.length === 1 ? deleting[0].name : 'I UNDERSTAND'}
        confirmLabel="to delete"
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.map((ct) => ct.name))}
      />
    </Box>
  )
}

function isPoweredOn(ct: Container | null): boolean {
  return ct?.status === 'RUNNING' || ct?.status === 'STAGING'
}
