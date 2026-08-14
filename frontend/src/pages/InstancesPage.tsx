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
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { api } from '../api/client'
import { connectionFor } from '../connect'
import type { Instance } from '../api/client'
import StatusIcon from '../components/StatusIcon'

/**
 * SSH or RDP, whichever the guest speaks. The split button opens the
 * browser terminal; the arrow offers the alternative — your own client
 * over ssh://, for when you want scp, port forwards or a real tmux.
 */
function ConnectCell({ instance }: { instance: Instance }) {
  const [menu, setMenu] = useState<null | HTMLElement>(null)
  const connection = connectionFor(instance.osType, instance.internalIp, instance.name)
  const running = instance.status === 'RUNNING'

  // A terminal belongs in its own window: it outlives the page you
  // launched it from, and you'll want the console beside it.
  const openTerminal = () => {
    if (!connection) return
    window.open(
      connection.href,
      `ssh-${instance.name}`,
      'width=1024,height=640,menubar=no,toolbar=no,location=no,status=no',
    )
  }

  if (!connection) {
    return (
      <Tooltip title={running ? 'No address known yet' : 'Instance is not running'}>
        <Box component="span" sx={{ color: '#5f6368' }}>
          —
        </Box>
      </Tooltip>
    )
  }
  // RDP has no proxy here, so it stays a single button handing the URI
  // to whatever client the desktop registered.
  if (connection.kind === 'RDP') {
    return (
      <Tooltip title={running ? connection.command : 'Instance is not running'}>
        <span>
          <Button size="small" href={connection.href} disabled={!running} sx={{ minWidth: 0, px: 1 }}>
            RDP
          </Button>
        </span>
      </Tooltip>
    )
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Button size="small" disabled={!running} onClick={openTerminal} sx={{ minWidth: 0, px: 1 }}>
        SSH
      </Button>
      <IconButton
        size="small"
        disabled={!running}
        onClick={(e) => setMenu(e.currentTarget)}
        aria-label="Other ways to connect"
      >
        <ArrowDropDownIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setMenu(null)
            openTerminal()
          }}
        >
          Open in browser window
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenu(null)
            window.location.href = `ssh://${instance.internalIp}`
          }}
        >
          Use another SSH client
        </MenuItem>
      </Menu>
    </Box>
  )
}

export default function InstancesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuInstance, setMenuInstance] = useState<Instance | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    mutationFn: (name: string) => api.deleteInstance(name),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h5">VM instances</Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddBoxIcon />}
          onClick={() => navigate('/compute/instances/create')}
        >
          Create instance
        </Button>
        <Button size="small" startIcon={<RefreshIcon />} onClick={() => refetch()}>
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox size="small" disabled />
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
              <TableRow key={inst.id} hover>
                <TableCell padding="checkbox">
                  <Checkbox size="small" />
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
                  <ConnectCell instance={inst} />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={(e) => openMenu(e, inst)}>
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {instances.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: '#5f6368' }}>
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
            if (menuInstance) remove.mutate(menuInstance.name)
            closeMenu()
          }}
          disabled={menuInstance?.protected}
          sx={{ color: '#d93025' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          {menuInstance?.protected ? 'Delete (protected)' : 'Delete'}
        </MenuItem>
      </Menu>
    </Box>
  )
}
