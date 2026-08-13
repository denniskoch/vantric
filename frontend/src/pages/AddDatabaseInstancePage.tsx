import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import type { DatabaseEngine, DatabaseServer, DatabaseServerRequest } from '../api/client'
import { engineDefaults, engineLabels, sslModes } from '../databases'
import { hostError, portError, resourceNameError, resourceNameRe } from '../validation'

const emptyForm: DatabaseServerRequest = {
  name: '',
  type: 'postgres',
  host: '',
  port: 5432,
  username: 'postgres',
  password: '',
  database: 'postgres',
  sslMode: 'prefer',
}

function ConnectionForm({ editing }: { editing: DatabaseServer | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<DatabaseServerRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          host: editing.host,
          port: editing.port,
          username: editing.username,
          password: '', // blank keeps the stored one
          database: editing.database,
          sslMode: editing.sslMode || 'prefer',
        }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)

  const { data: engines = ['postgres' as DatabaseEngine] } = useQuery({
    queryKey: ['databaseEngines'],
    queryFn: api.listDatabaseEngines,
  })

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updateDatabaseServer(editing.id, form)
        : api.createDatabaseServer(form),
    onSuccess: (server) => {
      queryClient.invalidateQueries({ queryKey: ['databaseServers'] })
      navigate(`/databases/instances/${server.id}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const hostFieldError = hostError(form.host)
  const portFieldError = portError(form.port)
  const valid =
    resourceNameRe.test(form.name) &&
    form.host.trim() !== '' &&
    !hostFieldError &&
    !portFieldError &&
    form.username.trim() !== '' &&
    (form.password !== '' || Boolean(editing?.hasPassword))

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/databases/instances')}
        >
          Instances
        </Button>
        <Typography variant="h5">
          {editing ? `Edit ${editing.name}` : 'Add instance'}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2, maxWidth: 680 }}>
          {error}
        </Alert>
      )}
      <Alert severity="info" sx={{ mb: 2, maxWidth: 680 }}>
        The credentials are checked before the connection is saved, so a saved
        instance is one that works. Use a role with enough rights to read the
        catalog — and to create databases and users, if you want to do that
        from here.
      </Alert>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 680 }}>
        <TextField
          label="Name"
          size="small"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={Boolean(nameError)}
          helperText={nameError ?? 'What this console calls it. e.g. pg-main'}
          fullWidth
        />

        <TextField
          label="Engine"
          size="small"
          select
          value={form.type}
          onChange={(e) => {
            const type = e.target.value as DatabaseEngine
            const defaults = engineDefaults(type)
            setForm({
              ...form,
              type,
              port: defaults.port,
              database: defaults.database,
              username: defaults.username,
            })
          }}
          helperText="Picking one sets the usual port and admin database"
          fullWidth
        >
          {engines.map((engine) => (
            <MenuItem key={engine} value={engine}>
              {engineLabels[engine] ?? engine}
            </MenuItem>
          ))}
        </TextField>

        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="Host"
            size="small"
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="192.168.80.20"
            error={Boolean(hostFieldError)}
            helperText={hostFieldError ?? 'Hostname or IP address'}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Port"
            size="small"
            type="number"
            value={form.port}
            onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
            error={Boolean(portFieldError)}
            helperText={portFieldError ?? ' '}
            sx={{ width: 140 }}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="Username"
            size="small"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            helperText="The role this console connects as"
            sx={{ flex: 1 }}
          />
          <TextField
            label="Password"
            size="small"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            helperText={
              editing?.hasPassword ? 'Leave blank to keep the current password' : ' '
            }
            sx={{ flex: 1 }}
          />
        </Box>

        <TextField
          label="Connect to database"
          size="small"
          value={form.database}
          onChange={(e) => setForm({ ...form, database: e.target.value })}
          helperText="Which database the connection opens against; the catalog it reads covers the whole server"
          fullWidth
        />

        <TextField
          label="TLS"
          size="small"
          select
          value={form.sslMode}
          onChange={(e) => setForm({ ...form, sslMode: e.target.value })}
          fullWidth
        >
          {sslModes.map((mode) => (
            <MenuItem key={mode.value} value={mode.value}>
              {mode.label}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {/* Persistent action bar, GCP-style */}
      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 3, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Connecting…' : editing ? 'Save' : 'Connect'}
        </Button>
        <Button onClick={() => navigate('/databases/instances')}>Cancel</Button>
      </Box>
    </Box>
  )
}

export default function AddDatabaseInstancePage() {
  const { id } = useParams()
  const { data: server, isLoading } = useQuery({
    queryKey: ['databaseServer', id],
    queryFn: () => api.getDatabaseServer(id!),
    enabled: Boolean(id),
  })

  if (id && isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading connection…</Typography>
      </Box>
    )
  }
  return <ConnectionForm editing={server ?? null} />
}
