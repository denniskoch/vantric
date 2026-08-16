import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
import PageHeader from '../components/PageHeader'
import StatusIcon from '../components/StatusIcon'
import { usePermissions } from '../user'


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
  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? '—'

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['instances'] })

  const action = useMutation({
    mutationFn: ({ name, act }: { name: string; act: 'start' | 'stop' | 'reset' }) =>
      api.instanceAction(name, act),
    onSuccess: invalidate,
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
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

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

  const toggle = (name: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(name)) next.add(name)
      return next
    })

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
        title="VM instances"
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

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  disabled={instances.length === 0 || !canEdit}
                  checked={instances.length > 0 && selected.length === instances.length}
                  indeterminate={selected.length > 0 && selected.length < instances.length}
                  onChange={(e) =>
                    setPicked(e.target.checked ? new Set(instances.map((i) => i.name)) : new Set())
                  }
                  slotProps={{ input: { 'aria-label': 'Select all instances' } }}
                />
              </TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Server</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell>Internal IP</TableCell>
              <TableCell>External IP</TableCell>
              <TableCell>Connect</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {instances.map((inst) => (
              <TableRow key={inst.id} hover selected={picked.has(inst.name)}>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    disabled={!canEdit}
                    checked={picked.has(inst.name)}
                    onChange={() => toggle(inst.name)}
                    slotProps={{ input: { 'aria-label': `Select ${inst.name}` } }}
                  />
                </TableCell>
                <TableCell>
                  <StatusIcon status={inst.status} />
                </TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/compute/instances/${inst.name}`}
                    underline="hover"
                  >
                    {inst.name}
                  </Link>
                </TableCell>
                <TableCell>{serverName(inst.serverId)}</TableCell>
                <TableCell>{inst.zone}</TableCell>
                <TableCell>{inst.internalIp || '—'}</TableCell>
                <TableCell>{inst.externalIp || '—'}</TableCell>
                <TableCell>
                  <ConnectButton instance={inst} />
                </TableCell>
                <TableCell align="right">
                  {canEdit && (
                    <IconButton size="small" onClick={(e) => openMenu(e, inst)}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {instances.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No VM instances yet. Click "Create instance" to get started.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

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
              ? 'the virtual machine and its disks on ' + serverName(deleting[0].serverId)
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

/**
 * Runs one call per instance and reports the outcome once.
 *
 * Everything here is per-instance at the API, so a bulk action is N
 * requests; what it must not be is N alerts, or a single failure that
 * hides the ones that worked.
 */
async function settle<T>(names: string[], call: (name: string) => Promise<T>): Promise<void> {
  const results = await Promise.allSettled(names.map(call))
  const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  if (failures.length === 0) return
  const reason = (failures[0].reason as Error).message
  throw new Error(
    failures.length === names.length
      ? reason
      : `${failures.length} of ${names.length} failed — ${reason}`,
  )
}
