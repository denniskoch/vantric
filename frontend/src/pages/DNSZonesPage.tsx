import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PendingIcon from '@mui/icons-material/Pending'
import { api } from '../api/client'
import type { DNSZone } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { domainError, domainRe } from '../validation'

export default function DNSZonesPage() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState('')
  const [zoneType, setZoneType] = useState('full')
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
  if (!providerId && connected.length > 0) setProviderId(connected[0].id)

  // Accounts come from the provider, so zones land in the right one.
  const { data: accounts = [] } = useQuery({
    queryKey: ['dnsAccounts', providerId],
    queryFn: () => api.listDNSAccounts(providerId),
    enabled: Boolean(providerId) && createOpen,
  })

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? '—'

  const create = useMutation({
    mutationFn: () =>
      api.createDNSZone(providerId, {
        name,
        accountId: accountId || undefined,
        type: zoneType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dnsZones'] })
      setCreateOpen(false)
      setName('')
    },
    onError: (e: Error) => setError(e.message),
  })

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

  const nameFieldError = domainError(name)
  const valid = domainRe.test(name.trim().toLowerCase()) && Boolean(providerId)

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
        <Typography variant="h5">Zones</Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddBoxIcon />}
          disabled={connected.length === 0}
          onClick={() => setCreateOpen(true)}
        >
          Create zone
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Domains managed through your DNS providers.
      </Typography>

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
              <TableCell>Mode</TableCell>
              <TableCell>Nameservers</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {zones.map((zone) => (
              <TableRow key={`${zone.providerId}/${zone.id}`} hover>
                <TableCell>
                  <Tooltip title={zone.paused ? 'paused' : zone.status}>
                    {zone.status === 'active' && !zone.paused ? (
                      <CheckCircleIcon sx={{ color: '#188038', fontSize: 18 }} />
                    ) : (
                      <PendingIcon sx={{ color: '#f29900', fontSize: 18 }} />
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell>{zone.name}</TableCell>
                <TableCell>{providerName(zone.providerId)}</TableCell>
                <TableCell>{zone.accountName || '—'}</TableCell>
                <TableCell>
                  <Chip
                    label={zone.type || 'full'}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: 10, height: 18 }}
                  />
                </TableCell>
                <TableCell sx={{ fontSize: 12, color: '#5f6368' }}>
                  {zone.nameservers?.join(', ') || '—'}
                </TableCell>
                <TableCell>
                  {zone.createdAt ? new Date(zone.createdAt * 1000).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setMenuAnchor(e.currentTarget)
                      setMenuZone(zone)
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {zones.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: '#5f6368' }}>
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
          sx={{ color: '#d93025' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Create zone</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          <TextField
            label="Provider"
            size="small"
            select
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value)
              setAccountId('')
            }}
            fullWidth
          >
            {providers.map((p) => (
              <MenuItem key={p.id} value={p.id} disabled={p.status !== 'connected'}>
                {p.name} ({p.status})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Domain"
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="example.com"
            error={Boolean(nameFieldError)}
            helperText={nameFieldError ?? 'The apex domain, without a scheme or trailing dot'}
            fullWidth
          />
          <TextField
            label="Account"
            size="small"
            select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            helperText={
              accounts.length === 0
                ? "Uses the provider's default account"
                : 'Which account the zone is created in'
            }
            fullWidth
          >
            <MenuItem value="">
              <em>Provider default</em>
            </MenuItem>
            {accounts.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Mode"
            size="small"
            select
            value={zoneType}
            onChange={(e) => setZoneType(e.target.value)}
            helperText="Full delegates the domain's nameservers; partial keeps them elsewhere"
            fullWidth
          >
            <MenuItem value="full">Full — authoritative</MenuItem>
            <MenuItem value="partial">Partial — CNAME setup</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Delete ${confirming?.name}?`}
        body={`This removes the zone and all of its records at ${
          confirming ? providerName(confirming.providerId) : 'the provider'
        }. The domain itself is not affected, but it will stop resolving through this provider.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
