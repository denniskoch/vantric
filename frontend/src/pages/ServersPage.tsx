import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
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
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HelpIcon from '@mui/icons-material/Help'
import { api } from '../api/client'
import type { Server, ServerRequest, ServerType } from '../api/client'
import { resourceNameError, resourceNameRe, urlError } from '../validation'

const typeLabels: Record<ServerType, string> = {
  proxmox: 'Proxmox VE',
  mock: 'Mock (development)',
}

const emptyForm: ServerRequest = {
  name: '',
  type: 'proxmox',
  baseUrl: '',
  tokenId: '',
  secret: '',
  insecureTls: true,
}

function StatusGlyph({ server }: { server: Server }) {
  const icon =
    server.status === 'connected' ? (
      <CheckCircleIcon sx={{ color: '#188038', fontSize: 18 }} />
    ) : server.status === 'unreachable' ? (
      <ErrorIcon sx={{ color: '#d93025', fontSize: 18 }} />
    ) : (
      <HelpIcon sx={{ color: '#5f6368', fontSize: 18 }} />
    )
  return (
    <Tooltip title={server.error ? `${server.status}: ${server.error}` : server.status}>
      <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>{icon}</span>
    </Tooltip>
  )
}

export default function ServersPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Server | null>(null)
  const [form, setForm] = useState<ServerRequest>(emptyForm)
  const [error, setError] = useState<string | null>(null)

  const { data: servers = [], isLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: api.listServers,
    refetchInterval: 10000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['servers'] })
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditing(null)
    setForm(emptyForm)
  }

  const save = useMutation({
    mutationFn: () =>
      editing ? api.updateServer(editing.id, form) : api.createServer(form),
    onSuccess: () => {
      invalidate()
      closeDialog()
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteServer(id),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = (server: Server) => {
    setEditing(server)
    setForm({
      name: server.name,
      type: server.type,
      baseUrl: server.baseUrl,
      tokenId: server.tokenId,
      secret: '', // blank keeps the stored secret
      insecureTls: server.insecureTls,
    })
    setDialogOpen(true)
  }

  const isProxmox = form.type === 'proxmox'
  const nameError = resourceNameError(form.name)
  const baseUrlError = urlError(form.baseUrl)
  const validName = resourceNameRe.test(form.name)
  const valid =
    validName &&
    (!isProxmox ||
      (form.baseUrl !== '' &&
        form.tokenId !== '' &&
        (form.secret !== '' || Boolean(editing?.hasSecret))))

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
        <Typography variant="h5">Servers</Typography>
        <Button variant="contained" size="small" startIcon={<AddBoxIcon />} onClick={openCreate}>
          Add server
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Virtualization hosts that back your instances. Each server provides
        zones (its nodes) and images (its templates).
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
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Hypervisor</TableCell>
              <TableCell>Endpoint</TableCell>
              <TableCell align="right">Nodes</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {servers.map((server) => (
              <TableRow key={server.id} hover>
                <TableCell>
                  <StatusGlyph server={server} />
                </TableCell>
                <TableCell>{server.name}</TableCell>
                <TableCell>
                  <Chip
                    label={typeLabels[server.type] ?? server.type}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: 11, height: 20 }}
                  />
                </TableCell>
                <TableCell>{server.baseUrl || '—'}</TableCell>
                <TableCell align="right">
                  {server.status === 'connected' ? server.nodes : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => openEdit(server)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => remove.mutate(server.id)}
                    disabled={remove.isPending}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {servers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No servers registered. Click "Add server" to connect a hypervisor.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add server'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          <TextField
            label="Name"
            size="small"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={Boolean(nameError)}
            helperText={nameError ?? 'Lowercase letters, numbers, hyphens. e.g. pve-1'}
            fullWidth
          />
          <TextField
            label="Hypervisor type"
            size="small"
            select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ServerType })}
            helperText="More hypervisors (ESXi, libvirt, …) planned"
            fullWidth
          >
            <MenuItem value="proxmox">Proxmox VE</MenuItem>
            <MenuItem value="mock">Mock (development)</MenuItem>
          </TextField>
          {isProxmox && (
            <>
              <TextField
                label="API URL"
                size="small"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://pve.lan:8006"
                error={Boolean(baseUrlError)}
                helperText={baseUrlError ?? ' '}
                fullWidth
              />
              <TextField
                label="API token ID"
                size="small"
                value={form.tokenId}
                onChange={(e) => setForm({ ...form, tokenId: e.target.value })}
                placeholder="root@pam!labcloud"
                fullWidth
              />
              <TextField
                label="API token secret"
                size="small"
                type="password"
                value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                helperText={
                  editing?.hasSecret
                    ? 'Leave blank to keep the current secret'
                    : 'From Datacenter → Permissions → API Tokens'
                }
                fullWidth
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.insecureTls}
                    onChange={(e) => setForm({ ...form, insecureTls: e.target.checked })}
                  />
                }
                label="Allow self-signed TLS certificate"
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {editing ? 'Save' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
