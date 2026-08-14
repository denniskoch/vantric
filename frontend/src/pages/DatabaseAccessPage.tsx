import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { api } from '../api/client'
import type { AccessLevel } from '../api/client'
import FormPage from '../components/FormPage'

/**
 * Granting a user access to one database — and creating that user in
 * the same step, because "make an account for this app and let it in"
 * is one job however many statements it takes.
 *
 * Three levels rather than a privilege matrix. Read, read/write and
 * full are the answers people actually want; the engines spell them
 * very differently, and anything finer belongs in psql.
 */
const levels: { id: AccessLevel; title: string; description: string }[] = [
  { id: 'read', title: 'Read only', description: 'SELECT on every table, now and later' },
  {
    id: 'readwrite',
    title: 'Read and write',
    description: 'SELECT, INSERT, UPDATE and DELETE — what an application needs',
  },
  {
    id: 'full',
    title: 'Full access',
    description: 'Everything, including creating and dropping tables',
  },
]

export default function DatabaseAccessPage() {
  const { id = '', name = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Arriving from a row's "Change access" starts on that user.
  const [user, setUser] = useState(params.get('user') ?? '')
  const [createUser, setCreateUser] = useState(false)
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('%')
  const [level, setLevel] = useState<AccessLevel>('readwrite')
  const [error, setError] = useState<string | null>(null)

  const { data: server } = useQuery({
    queryKey: ['databaseServer', id],
    queryFn: () => api.getDatabaseServer(id),
    enabled: Boolean(id),
  })
  const { data: users = [] } = useQuery({
    queryKey: ['databaseUsers', id],
    queryFn: () => api.listDatabaseUsers(id),
    enabled: Boolean(id),
  })

  // MySQL identities are name@host; PostgreSQL roles are just a name.
  const isMySQL = server?.type === 'mysql'
  const back = `/databases/instances/${id}/databases/${encodeURIComponent(name)}`

  const save = useMutation({
    mutationFn: () =>
      api.grantDatabaseAccess(id, name, {
        user: user.trim(),
        host: isMySQL ? host.trim() : '',
        level,
        createUser,
        password: createUser ? password : '',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['databaseGrants', id, name] })
      queryClient.invalidateQueries({ queryKey: ['databaseUsers', id] })
      navigate(back)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameTaken = createUser && users.some((u) => u.name === user.trim())
  const userError = nameTaken ? 'A user with that name already exists' : ''
  const passwordError =
    createUser && password && password.length < 8 ? 'At least 8 characters' : ''
  const incomplete =
    !user.trim() || Boolean(userError) || (createUser && password.length < 8)

  return (
    <FormPage
      title={`Grant access to ${name}`}
      backTo={back}
      backLabel={name}
      error={error}
      onDismissError={() => setError(null)}
      notice="Granting replaces whatever this user had on this database, so lowering someone's access is a real reduction rather than an addition."
      primaryLabel="Grant access"
      primaryDisabled={incomplete}
      pending={save.isPending}
      onPrimary={() => {
        setError(null)
        save.mutate()
      }}
    >
      <FormControlLabel
        control={
          <Switch
            checked={createUser}
            onChange={(e) => {
              setCreateUser(e.target.checked)
              setUser('')
            }}
          />
        }
        label={
          <Box>
            <Typography sx={{ fontSize: 14 }}>Create a new user</Typography>
            <Typography sx={{ fontSize: 12, color: '#5f6368' }}>
              Otherwise pick one that already exists on this server
            </Typography>
          </Box>
        }
      />

      {createUser ? (
        <TextField
          label="User name"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          error={Boolean(userError)}
          helperText={userError || 'Letters, digits and underscores'}
          size="small"
          fullWidth
        />
      ) : (
        <TextField
          select
          label="User"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          size="small"
          fullWidth
        >
          {users
            .filter((u) => !u.system)
            .map((u) => (
              <MenuItem key={`${u.name}@${u.host}`} value={u.name}>
                {isMySQL && u.host ? `${u.name}@${u.host}` : u.name}
              </MenuItem>
            ))}
        </TextField>
      )}

      {createUser && (
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={Boolean(passwordError)}
          helperText={passwordError || 'At least 8 characters'}
          autoComplete="new-password"
          size="small"
          fullWidth
        />
      )}

      {isMySQL && (
        <TextField
          label="Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          helperText="Where this user may connect from. % is anywhere."
          size="small"
          fullWidth
        />
      )}

      <TextField
        select
        label="Access"
        value={level}
        onChange={(e) => setLevel(e.target.value as AccessLevel)}
        size="small"
        fullWidth
      >
        {levels.map((l) => (
          <MenuItem key={l.id} value={l.id}>
            <Box>
              <Typography sx={{ fontSize: 14 }}>{l.title}</Typography>
              <Typography sx={{ fontSize: 12, color: '#5f6368' }}>{l.description}</Typography>
            </Box>
          </MenuItem>
        ))}
      </TextField>
    </FormPage>
  )
}
