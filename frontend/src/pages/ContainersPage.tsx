import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
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
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteIcon from '@mui/icons-material/Delete'
import { Button } from '@mui/material'
import { api } from '../api/client'
import type { Container } from '../api/client'
import StatusIcon from '../components/StatusIcon'

// CT (LXC) instances. Separate from VM instances by design — they
// list and provision differently.
export default function ContainersPage() {
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuContainer, setMenuContainer] = useState<Container | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: containers = [], refetch, isLoading } = useQuery({
    queryKey: ['containers'],
    queryFn: api.listContainers,
    refetchInterval: 3000,
  })
  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? '—'

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['containers'] })

  const action = useMutation({
    mutationFn: ({ name, act }: { name: string; act: 'start' | 'stop' | 'reset' }) =>
      api.containerAction(name, act),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (name: string) => api.deleteContainer(name),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="h5">CT instances</Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={() => refetch()}>
          Refresh
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5, mb: 2 }}>
        System containers (LXC) discovered on your servers. Container
        provisioning from this console is coming soon.
      </Typography>

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
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {containers.map((ct) => (
              <TableRow key={ct.id} hover>
                <TableCell padding="checkbox">
                  <Checkbox size="small" />
                </TableCell>
                <TableCell>
                  <StatusIcon status={ct.status} />
                </TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/compute/containers/${ct.name}`}
                    underline="hover"
                  >
                    {ct.name}
                  </Link>
                </TableCell>
                <TableCell>{serverName(ct.serverId)}</TableCell>
                <TableCell>{ct.zone}</TableCell>
                <TableCell align="right">{ct.cpus}</TableCell>
                <TableCell align="right">{ct.memoryMb}</TableCell>
                <TableCell>{ct.internalIp || '—'}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={(e) => openMenu(e, ct)}>
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {containers.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No containers found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

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
            if (menuContainer) remove.mutate(menuContainer.name)
            closeMenu()
          }}
          disabled={menuContainer?.protected}
          sx={{ color: '#d93025' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          {menuContainer?.protected ? 'Delete (protected)' : 'Delete'}
        </MenuItem>
      </Menu>
    </Box>
  )
}
