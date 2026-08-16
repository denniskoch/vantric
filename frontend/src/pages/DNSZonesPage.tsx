import { useState } from 'react'
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PendingIcon from '@mui/icons-material/Pending'
import { api } from '../api/client'
import type { DNSZone } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import { usePermissions } from '../user'

export default function DNSZonesPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuZone, setMenuZone] = useState<DNSZone | null>(null)
  const [confirming, setConfirming] = useState<DNSZone | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['dnsProviders'],
    queryFn: api.listDNSProviders,
  })
  const { data: zones = [], isLoading } = useQuery({
    queryKey: ['dnsZones'],
    queryFn: api.listDNSZones,
    refetchInterval: 30000,
  })

  const connected = providers.filter((p) => p.status === 'connected')

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? '—'

  const remove = useMutation({
    mutationFn: (zone: DNSZone) => api.deleteDNSZone(zone.providerId, zone.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dnsZones'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Zones"
        actions={
          canEdit && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
              disabled={connected.length === 0}
              onClick={() => navigate('/dns/zones/create')}
            >
              Create zone
            </Button>
          )
        }
        description={
          <>
            Domains managed through your DNS providers.
          </>
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {providers.length === 0 && !isLoading && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button size="small" component={RouterLink} to="/dns/providers">
              Add provider
            </Button>
          }
        >
          No DNS providers configured yet.
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Account</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {zones.map((zone) => (
              <TableRow key={`${zone.providerId}/${zone.id}`} hover>
                <TableCell>
                  <Tooltip title={zone.paused ? 'paused' : zone.status}>
                    {zone.status === 'active' && !zone.paused ? (
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
                    ) : (
                      <PendingIcon sx={{ color: 'warning.main', fontSize: 18 }} />
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/dns/zones/${zone.providerId}/${zone.id}`}
                    underline="hover"
                  >
                    {zone.name}
                  </Link>
                </TableCell>
                <TableCell>{providerName(zone.providerId)}</TableCell>
                <TableCell>{zone.accountName || '—'}</TableCell>
                <TableCell align="right">
                  {canEdit && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        setMenuAnchor(e.currentTarget)
                        setMenuZone(zone)
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {zones.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No zones found at your providers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setConfirming(menuZone)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Delete ${confirming?.name}?`}
        body={`This removes the zone and all of its records at ${
          confirming ? providerName(confirming.providerId) : 'the provider'
        }. The domain itself is not affected, but it will stop resolving through this provider.`}
        confirmPhrase={confirming?.name}
        confirmLabel="to delete it"
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
