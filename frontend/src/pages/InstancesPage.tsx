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
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { api } from '../api/client'
import { connectionFor } from '../connect'
import type { Instance } from '../api/client'
import StatusIcon from '../components/StatusIcon'

/** SSH or RDP, whichever the guest speaks. The console has no console
 *  proxy of its own, so this hands the desktop a URI its own client
 *  can open and offers the command for when it can't. */
function ConnectCell({ instance }: { instance: Instance }) {
  const [copied, setCopied] = useState(false)
  const connection = connectionFor(instance.osType, instance.internalIp)
  const running = instance.status === 'RUNNING'

  if (!connection) {
    return (
      <Tooltip title={running ? 'No address known yet' : 'Instance is not running'}>
        <Box component="span" sx={{ color: '#5f6368' }}>
          —
        </Box>
      </Tooltip>
    )
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Tooltip title={running ? connection.command : 'Instance is not running'}>
        <span>
          <Button
            size="small"
            href={connection.href}
            disabled={!running}
            sx={{ minWidth: 0, px: 1 }}
          >
            {connection.kind}
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={copied ? 'Copied' : `Copy "${connection.command}"`}>
        <IconButton
          size="small"
          onClick={() => {
            navigator.clipboard?.writeText(connection.command)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
        >
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
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
              <TableCell align="right">vCPUs</TableCell>
              <TableCell align="right">Memory (MB)</TableCell>
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
                <TableCell align="right">{inst.cpus}</TableCell>
                <TableCell align="right">{inst.memoryMb}</TableCell>
                <TableCell>{inst.internalIp || '—'}</TableCell>
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
                <TableCell colSpan={11} align="center" sx={{ py: 6, color: '#5f6368' }}>
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
