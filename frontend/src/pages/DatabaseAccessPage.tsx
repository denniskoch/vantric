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
import { hostPatternError } from '../validation'

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
  // Only asked about when CREATING an account. Picking an existing one
  // takes its host from the account itself — see identityValue below.
  // The host arrives alongside the user when coming from a grant row,
  // because it is half of which account that grant belongs to. '%' is
  // only the default for an account being created here.
  const [host, setHost] = useState(params.get('host') ?? '%')
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

  /**
   * WHICH ACCOUNT IS ONE ANSWER, NOT TWO.
   *
   * The picker showed "bob@localhost" and set the value to "bob",
   * throwing the host away — while a separate Host field defaulted to
   * "%". So granting to any account not already at % addressed
   * 'bob'@'%', which usually doesn't exist, and MySQL answered "Can't
   * find any matching row in the user table". The wildcard looked like
   * a safe default and was actually a different account.
   *
   * The identity travels as the pair it is. A MariaDB ROLE has no host
   * at all, and its empty half has to survive the round trip — a role
   * is granted to as a bare name, and '@%' bolted onto one fails the
   * same way.
   */
  const identityValue = (u: { name: string; host: string }) => `${u.name}\u0000${u.host}`
  const selectedIdentity = users.find((u) => u.name === user && (!isMySQL || u.host === host))
  const grantable = users.filter((u) => !u.system)
  const back = `/databases/instances/${id}/databases/${encodeURIComponent(name)}`

  const save = useMutation({
    mutationFn: () =>
      api.grantDatabaseAccess(id, name, {
        user: user.trim(),
        // A role's empty host is meaningful and must not become '%'.
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

  const hostError = isMySQL && createUser ? hostPatternError(host) : null
  // ON MYSQL THE COLLISION IS THE PAIR. 'app'@'10.0.0.5' and
  // 'app'@'%' are two different accounts, and creating the second when
  // the first exists is an ordinary thing to want — refusing it on the
  // name alone would block exactly the case the host field is for.
  const nameTaken =
    createUser &&
    users.some(
      (u) => u.name === user.trim() && (!isMySQL || u.host === host.trim()),
    )
  const userError = nameTaken
    ? isMySQL
      ? 'That user already exists on this host'
      : 'A user with that name already exists'
    : ''
  const passwordError =
    createUser && password && password.length < 8 ? 'At least 8 characters' : ''
  const incomplete =
    !user.trim() ||
    Boolean(userError) ||
    Boolean(hostError) ||
    (createUser && password.length < 8)

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
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
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
          value={selectedIdentity ? identityValue(selectedIdentity) : ''}
          onChange={(e) => {
            const picked = grantable.find((u) => identityValue(u) === e.target.value)
            setUser(picked?.name ?? '')
            setHost(picked?.host ?? '')
          }}
          size="small"
          fullWidth
          helperText={
            selectedIdentity?.role
              ? 'A role — grant it here, then grant the role to whoever needs it'
              : isMySQL
                ? 'The account, including where it connects from'
                : undefined
          }
        >
          {grantable.map((u) => (
            <MenuItem key={identityValue(u)} value={identityValue(u)}>
              {isMySQL && u.host ? `${u.name}@${u.host}` : u.name}
              {u.role && (
                <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                  role
                </Box>
              )}
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

      {/* Only when CREATING one. For an account that already exists the
          host is not a question — it is half of which account you
          picked, and asking again is how you end up naming one that
          isn't there. */}
      {isMySQL && createUser && (
        <TextField
          label="Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          error={Boolean(hostError)}
          helperText={hostError || 'Where this user may connect from. % is anywhere.'}
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
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{l.description}</Typography>
            </Box>
          </MenuItem>
        ))}
      </TextField>
    </FormPage>
  )
}
