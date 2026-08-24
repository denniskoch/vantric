import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
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
import AddIcon from '@mui/icons-material/Add'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import GppMaybeIcon from '@mui/icons-material/GppMaybe'
import HelpIcon from '@mui/icons-material/Help'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import RequireRole from '../components/RequireRole'
import { api } from '../api/client'
import type { DockerHost } from '../api/client'
import { formatBytes } from '../format'

/**
 * The Docker daemons this console can reach.
 *
 * OWNER-ONLY, because the record holds a bearer token that is, at the
 * other end, control of every container on that machine.
 */
export default function DockerHostsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<DockerHost | null>(null)
  const [deleting, setDeleting] = useState<DockerHost | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: hosts = [], isLoading } = useQuery({
    queryKey: ['dockerHosts'],
    queryFn: api.listDockerHosts,
    refetchInterval: 60_000,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDockerHost(id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['dockerHosts'] })
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  return (
    <RequireRole admin>
      <Box sx={{ p: 3 }}>
        <PageHeader
          title="Docker hosts"
          actions={
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => navigate('/docker/settings/hosts/new')}
            >
              Connect
            </Button>
          }
        />

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Host</TableCell>
                <TableCell>Address</TableCell>
                <TableCell>Runs in</TableCell>
                <TableCell>Docker</TableCell>
                <TableCell>Containers</TableCell>
                <TableCell>Changes</TableCell>
                <TableCell>Certificate</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {hosts.map((h) => (
                <TableRow key={h.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Status host={h} />
                      {h.name}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>{h.baseUrl}</TableCell>
                  <TableCell>
                    {/* THE JOIN. Docker knows its containers, Proxmox
                        knows its guests, and neither knows that this
                        daemon is a VM you could take a backup of. */}
                    {h.instance || (
                      <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
                        not a guest here
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{h.info?.version || '—'}</TableCell>
                  <TableCell>
                    {h.info ? `${h.info.running} of ${h.info.containers}` : '—'}
                  </TableCell>
                  <TableCell>
                    {h.info ? (
                      h.info.writable ? (
                        'allowed'
                      ) : (
                        // Discovered, not configured — and a deliberate
                        // setting on that host rather than a fault here.
                        <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
                          read-only
                        </Typography>
                      )
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Certificate host={h} />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      aria-label={`Actions for ${h.name}`}
                      onClick={(e) => {
                        setMenuAnchor(e.currentTarget)
                        setSelected(h)
                      }}
                    >
                      <MoreVertIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {hosts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {isLoading ? 'Loading…' : 'No Docker hosts connected.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {hosts.some((h) => h.error) && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {hosts.find((h) => h.error)?.error}
          </Alert>
        )}
        {hosts.some((h) => h.info) && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
            {hosts
              .filter((h) => h.info)
              .map(
                (h) =>
                  `${h.name}: ${h.info!.os}, ${h.info!.cpus} CPU, ${formatBytes(h.info!.memoryBytes)}`,
              )
              .join(' · ')}
          </Typography>
        )}

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            onClick={() => {
              if (selected) navigate(`/docker/settings/hosts/${selected.id}/edit`)
              setMenuAnchor(null)
            }}
          >
            <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
          </MenuItem>
          <MenuItem
            onClick={() => {
              setDeleting(selected)
              setMenuAnchor(null)
            }}
            sx={{ color: 'error.main' }}
          >
            <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Disconnect
          </MenuItem>
        </Menu>

        <ConfirmDeleteDialog
          open={Boolean(deleting)}
          title={`Disconnect ${deleting?.name}?`}
          body="This console stops reading that host. Nothing on it is touched."
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleting && remove.mutate(deleting.id)}
        />
      </Box>
    </RequireRole>
  )
}

/**
 * Four states, and the fourth is why this isn't a boolean.
 *
 * A host presenting the WRONG CERTIFICATE and a host that is switched
 * off are the same red dot in every console that only has two states,
 * and exactly one of them means somebody is standing in the middle.
 */
function Status({ host }: { host: DockerHost }) {
  const marks: Record<string, { icon: typeof CheckCircleIcon; colour: string; label: string }> = {
    connected: { icon: CheckCircleIcon, colour: '#1e8e3e', label: 'Connected' },
    unreachable: { icon: ErrorIcon, colour: '#d93025', label: 'Unreachable' },
    mismatch: {
      icon: GppMaybeIcon,
      colour: '#d93025',
      label: 'This host is presenting a different certificate',
    },
    unknown: { icon: HelpIcon, colour: '#9aa0a6', label: 'Not checked' },
  }
  const mark = marks[host.status] ?? marks.unknown
  const Icon = mark.icon
  return (
    <Tooltip title={mark.label}>
      <Icon sx={{ fontSize: 16, color: mark.colour, display: 'block' }} />
    </Tooltip>
  )
}

function Certificate({ host }: { host: DockerHost }) {
  if (host.fingerprint) {
    return (
      <Tooltip title={host.fingerprint}>
        <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
          {host.fingerprint.slice(0, 17)}…
        </Box>
      </Tooltip>
    )
  }
  if (host.insecureTls) {
    // NOT A BLANK. Unverified means anything on the path can read the
    // token, and the row should say so where a dash would not.
    return (
      <Typography component="span" sx={{ fontSize: 12, color: '#b06000' }}>
        not verified
      </Typography>
    )
  }
  return (
    <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
      public CA
    </Typography>
  )
}
