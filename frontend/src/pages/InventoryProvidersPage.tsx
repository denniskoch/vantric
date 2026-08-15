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
import type { InventoryProvider } from '../api/client'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import StatusIcon from '../components/StatusIcon'

/**
 * Device inventory services: the agents that know what's installed
 * inside the guests.
 *
 * Listed under Compute's settings rather than in a section of their
 * own, because nothing here is a resource you manage — it's a
 * credential, the same shape as a hypervisor's. What the service
 * knows shows up on each instance's OS Info tab, next to the machine
 * it describes.
 */
export default function InventoryProvidersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<InventoryProvider | null>(null)
  const [deleting, setDeleting] = useState<InventoryProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['inventoryProviders'],
    queryFn: api.listInventoryProviders,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteInventoryProvider(id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['inventoryProviders'] })
      queryClient.invalidateQueries({ queryKey: ['instanceInventory'] })
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Inventory"
        description="A device inventory service reports what's installed inside your guests, and which vulnerabilities those versions carry. This console reads it and shows it on each instance's OS Info tab — matching guests to hosts by their system UUID."
        actions={
          <Button
            variant="contained"
            size="small"
            startIcon={<AddBoxIcon />}
            component={RouterLink}
            to="/compute/settings/inventory/add"
          >
            Connect service
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
                <TableCell sx={{ color: '#5f6368' }}>{p.baseUrl}</TableCell>
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
                <TableCell colSpan={7} sx={{ color: '#d93025', fontSize: 12 }}>
                  {providers.find((p) => p.error)?.error}
                </TableCell>
              </TableRow>
            )}
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No inventory service connected. FleetDM runs osquery on your machines and reports their packages and CVEs.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (selected) navigate(`/compute/settings/inventory/${selected.id}/edit`)
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
          sx={{ color: '#d93025' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Disconnect
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Disconnect ${deleting?.name}?`}
        body={
          <>
            This console stops reading {deleting?.name} and every instance's OS Info
            tab loses its packages and vulnerabilities. Nothing is removed from the
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
