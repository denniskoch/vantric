import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material'
import SelectField from '../components/SelectField'
import { api } from '../api/client'
import FormPage from '../components/FormPage'
import { hostPatternError, identifierError } from '../validation'

/** The three forms an instance's tabs used to open in modals. They
 *  share a back target — the instance they belong to. */
function useInstance() {
  const { id = '' } = useParams()
  const { data: server } = useQuery({
    queryKey: ['databaseServer', id],
    queryFn: () => api.getDatabaseServer(id),
  })
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['databases', id] })
    queryClient.invalidateQueries({ queryKey: ['databaseUsers', id] })
    queryClient.invalidateQueries({ queryKey: ['databaseServer', id] })
  }
  return { id, server, backTo: `/databases/instances/${id}`, invalidate }
}

export function CreateDatabasePage() {
  const navigate = useNavigate()
  const { id, server, backTo, invalidate } = useInstance()
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: users = [] } = useQuery({
    queryKey: ['databaseUsers', id],
    queryFn: () => api.listDatabaseUsers(id),
  })

  const create = useMutation({
    mutationFn: () => api.createDatabase(id, { name: name.trim(), owner: owner || undefined }),
    onSuccess: () => {
      invalidate()
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = identifierError(name)
  // Ownership is PostgreSQL's; MySQL answers the same question with grants.
  const hasOwners = server?.type === 'postgres'

  return (
    <FormPage
      title="Create database"
      backTo={backTo}
      backLabel={server?.name ?? 'Instance'}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Create"
      primaryDisabled={!name || Boolean(nameError)}
      pending={create.isPending}
      onPrimary={() => create.mutate()}
    >
      <TextField
        label="Name"
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={Boolean(nameError)}
        helperText={nameError ?? 'Letters, digits, underscore or hyphen'}
        fullWidth
      />
      {hasOwners && (
        <SelectField
          label="Owner"
          size="small"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          helperText="Defaults to the role this console connects as"
          fullWidth
        >
          <MenuItem value="">
            <em>{server?.username}</em>
          </MenuItem>
          {users.map((user) => (
            <MenuItem key={user.name} value={user.name}>
              {user.name}
            </MenuItem>
          ))}
        </SelectField>
      )}
    </FormPage>
  )
}

export function CreateDatabaseUserPage() {
  const navigate = useNavigate()
  const { id, server, backTo, invalidate } = useInstance()
  const [name, setName] = useState('')
  const [host, setHost] = useState('%')
  const [password, setPassword] = useState('')
  const [canLogin, setCanLogin] = useState(true)
  const [createDb, setCreateDb] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hostScoped = server?.type === 'mysql'

  const create = useMutation({
    mutationFn: () =>
      api.createDatabaseUser(id, {
        name: name.trim(),
        host: hostScoped ? host.trim() || '%' : undefined,
        password,
        canLogin,
        createDb,
      }),
    onSuccess: () => {
      invalidate()
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = identifierError(name)
  const needsPassword = canLogin && !password

  return (
    <FormPage
      title="Create user"
      backTo={backTo}
      backLabel={server?.name ?? 'Instance'}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Create"
      primaryDisabled={!name || Boolean(nameError) || needsPassword}
      pending={create.isPending}
      onPrimary={() => create.mutate()}
    >
      <TextField
        label="Name"
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={Boolean(nameError)}
        helperText={nameError ?? 'Letters, digits, underscore or hyphen'}
        fullWidth
      />
      {hostScoped && (
        <TextField
          label="Host"
          size="small"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          helperText="Where this account may connect from. % means anywhere."
          fullWidth
        />
      )}
      <TextField
        label="Password"
        size="small"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={needsPassword}
        helperText={needsPassword ? 'A user that can log in needs a password' : ' '}
        fullWidth
      />
      <FormControlLabel
        control={
          <Checkbox size="small" checked={canLogin} onChange={(e) => setCanLogin(e.target.checked)} />
        }
        label="Can log in"
      />
      <FormControlLabel
        control={
          <Checkbox size="small" checked={createDb} onChange={(e) => setCreateDb(e.target.checked)} />
        }
        label="May create databases"
      />
    </FormPage>
  )
}

/**
 * Moving an account to a different host pattern.
 *
 * THE HOST IS HALF THE IDENTITY on MySQL — 'app'@'10.0.0.5' and
 * 'app'@'%' are two different accounts to the server — so this is a
 * rename, and the driver uses RENAME USER precisely so the password
 * and every grant travel with it.
 *
 * Its own page rather than a dialog, the same rule the password form
 * follows: a dialog asks "are you sure?", anything you fill in gets a
 * page.
 */
export function DatabaseUserHostPage() {
  const navigate = useNavigate()
  const { id, server, backTo, invalidate } = useInstance()
  const { name = '' } = useParams()
  const [params] = useSearchParams()
  const host = params.get('host') ?? undefined
  const [newHost, setNewHost] = useState(host ?? '%')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api.setDatabaseUserHost(id, name, newHost, host),
    onSuccess: () => {
      invalidate()
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const problem = hostPatternError(newHost)

  return (
    <FormPage
      title={`Move ${name}${host ? `@${host}` : ''}`}
      backTo={backTo}
      backLabel={server?.name ?? 'Instance'}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Move account"
      primaryDisabled={!newHost || Boolean(problem) || newHost === host}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <TextField
        label="Connects from"
        size="small"
        value={newHost}
        onChange={(e) => setNewHost(e.target.value)}
        error={Boolean(problem)}
        helperText={
          problem ??
          "% is any host. A pattern works too: 192.168.80.% or %.example.com"
        }
        fullWidth
      />
      <Alert severity="info" sx={{ mt: 2 }}>
        The password and every grant move with the account. Anything connected
        as {name}@{host || '%'} stays connected until it reconnects.
      </Alert>
    </FormPage>
  )
}

export function DatabaseUserPasswordPage() {
  const navigate = useNavigate()
  const { id, server, backTo, invalidate } = useInstance()
  const { name = '' } = useParams()
  const [params] = useSearchParams()
  const host = params.get('host') ?? undefined
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api.setDatabaseUserPassword(id, name, password, host),
    onSuccess: () => {
      invalidate()
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <FormPage
      title={`Set password for ${name}${host ? `@${host}` : ''}`}
      backTo={backTo}
      backLabel={server?.name ?? 'Instance'}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Set password"
      primaryDisabled={!password}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <TextField
        label="New password"
        size="small"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        helperText="Existing sessions stay connected; the next login uses this"
        fullWidth
      />
    </FormPage>
  )
}
