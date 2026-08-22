import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
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
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { MonitoringProvider } from '../api/client'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import StatusIcon from '../components/StatusIcon'

/**
 * The monitoring service this console reads.
 *
 * The credential, kept in the section it serves — the same rule as DNS
 * providers under DNS and the inventory service under Devices. What it
 * knows shows up on Problems and Hosts.
 */
export default function MonitoringProvidersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<MonitoringProvider | null>(null)
  const [deleting, setDeleting] = useState<MonitoringProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['monitoringProviders'],
    queryFn: api.listMonitoringProviders,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMonitoringProvider(id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['monitoringProviders'] })
      queryClient.invalidateQueries({ queryKey: ['monitoringProblems'] })
      queryClient.invalidateQueries({ queryKey: ['monitoringHosts'] })
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Monitoring service"
        actions={
          <Button
            variant="contained"
            size="small"
            startIcon={<AddBoxIcon />}
            component={RouterLink}
            to="/monitoring/settings/service/add"
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
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>URL</TableCell>
              <TableCell>Version</TableCell>
              <TableCell align="right">Hosts</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {providers.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>
                  <StatusIcon status={p.status === 'connected' ? 'RUNNING' : 'TERMINATED'} />
                </TableCell>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.type}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{p.baseUrl}</TableCell>
                <TableCell>{p.info?.version || (p.error ? '—' : '')}</TableCell>
                <TableCell align="right">{p.info?.hosts ?? '—'}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setMenuAnchor(e.currentTarget)
                      setSelected(p)
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {providers.some((p) => p.error) && (
              <TableRow>
                <TableCell colSpan={7} sx={{ color: 'error.main', fontSize: 12 }}>
                  {providers.find((p) => p.error)?.error}
                </TableCell>
              </TableRow>
            )}
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No monitoring service connected.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (selected) navigate(`/monitoring/settings/service/${selected.id}/edit`)
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
        body={
          <>
            This console stops reading {deleting?.name}. Nothing changes in the
            service itself, and re-connecting brings it all back.
          </>
        }
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Box>
  )
}
