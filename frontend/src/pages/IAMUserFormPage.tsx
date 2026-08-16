import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import type { RoleID } from '../api/client'
import FormPage from '../components/FormPage'
import { useSession } from '../user'

/**
 * Create or edit a console account. One page for both, because the
 * fields are the same and the only difference is whether a password is
 * being set for the first time — changing one later is its own page,
 * so an edit can't blank it by accident.
 */
export default function IAMUserFormPage() {
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user: me } = useSession()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<RoleID>('viewer')
  const [password, setPassword] = useState('')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: roles = [] } = useQuery({ queryKey: ['iamRoles'], queryFn: api.listRoles })
  const { data: existing } = useQuery({
    queryKey: ['iamUser', id],
    queryFn: () => api.getIAMUser(id!),
    enabled: editing,
  })

  useEffect(() => {
    if (!existing) return
    setEmail(existing.email)
    setName(existing.name)
    setRole(existing.role)
    setActive(existing.active)
  }, [existing])

  const save = useMutation({
    mutationFn: () => {
      const body = { email: email.trim(), name: name.trim(), role, active }
      return editing
        ? api.updateIAMUser(id!, body)
        : api.createIAMUser({ ...body, password })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['iamUsers'] })
      queryClient.invalidateQueries({ queryKey: ['session'] })
      navigate('/iam/users')
    },
    onError: (e: Error) => setError(e.message),
  })

  // Shown as soon as the field is wrong, not held back until submit.
  const emailError = email && !/^[^\s@]+@[^\s@]+$/.test(email.trim())
    ? 'Enter an email address'
    : ''
  // Blank is allowed on create: that's an account which exists only to
  // be matched by single sign-on.
  const passwordError =
    !editing && password && password.length < 12 ? 'At least 12 characters' : ''
  const incomplete =
    !email || Boolean(emailError) || (!editing && password !== '' && password.length < 12)

  const editingSelf = editing && me?.id === id

  return (
    <FormPage
      title={editing ? 'Edit user' : 'Add user'}
      backTo="/iam/users"
      backLabel="Users"
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel={editing ? 'Save' : 'Create'}
      primaryDisabled={incomplete}
      pending={save.isPending}
      onPrimary={() => {
        setError(null)
        save.mutate()
      }}
    >
      <TextField
        label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={Boolean(emailError)}
        helperText={emailError || 'Used to sign in, and as the SSH login for guests'}
        size="small"
        fullWidth
      />
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        helperText="Shown in the account menu"
        size="small"
        fullWidth
      />
      <TextField
        select
        label="Role"
        value={role}
        onChange={(e) => setRole(e.target.value as RoleID)}
        size="small"
        fullWidth
      >
        {roles.map((r) => (
          <MenuItem key={r.id} value={r.id}>
            <Box>
              <Typography sx={{ fontSize: 14 }}>{r.title}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{r.description}</Typography>
            </Box>
          </MenuItem>
        ))}
      </TextField>

      {!editing && (
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={Boolean(passwordError)}
          helperText={
            passwordError ||
            'At least 12 characters — or leave blank for an account that only signs in through single sign-on.'
          }
          autoComplete="new-password"
          size="small"
          fullWidth
        />
      )}

      <FormControlLabel
        control={
          <Switch
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={editingSelf}
          />
        }
        label={
          <Box>
            <Typography sx={{ fontSize: 14 }}>Active</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {editingSelf
                ? "You can't disable the account you're signed in as"
                : 'Disabling ends their sessions immediately'}
            </Typography>
          </Box>
        }
      />
    </FormPage>
  )
}
