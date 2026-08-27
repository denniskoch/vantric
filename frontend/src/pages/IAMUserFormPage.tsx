import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  IconButton,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import RolePicker from '../components/RolePicker'
import { api } from '../api/client'
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
  // A LIST, NOT A FIELD. An account holds a set of roles — "viewer"
  // plus "compute.admin" is somebody who watches the lab and runs one
  // part of it — so the form is rows you add to, the way GCP's Assign
  // Roles panel is. An empty string is a row somebody has opened and
  // not yet chosen, which is why it survives in state and is dropped on
  // save.
  //
  // A NEW ACCOUNT STARTS EMPTY. It defaulted to "viewer", which under
  // the old model was the smallest thing you could grant and under this
  // one is every section readable — a much larger grant than picking
  // one, and larger than it looks sitting next to compute.viewer. An
  // empty row makes the decision explicit, and the warning below says
  // what nothing means.
  const [roleRows, setRoleRows] = useState<string[]>([''])
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
    setActive(existing.active)
  }, [existing])

  const { data: heldRoles } = useQuery({
    queryKey: ['iamUserRoles', id],
    queryFn: () => api.getUserRoles(id!),
    enabled: editing,
  })
  useEffect(() => {
    // An account with no bindings shows one empty row rather than
    // nothing, or there is no control to add the first one.
    if (heldRoles) setRoleRows(heldRoles.length ? heldRoles : [''])
  }, [heldRoles])

  const save = useMutation({
    mutationFn: () => {
      const roles = roleRows.filter(Boolean)
      const body = { email: email.trim(), name: name.trim(), roles, active }
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
      <Box>
        <Typography sx={{ fontSize: 14, mb: 0.5 }}>Assign roles</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
          A role covers one section. The basic three cover every section at
          once, so an account can watch the whole lab and run one part of it.
        </Typography>
        {roleRows.map((value, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
            <RolePicker
              value={value}
              roles={roles}
              disabledRoles={roleRows}
              onChange={(role) =>
                setRoleRows((rows) => rows.map((r, j) => (j === i ? role : r)))
              }
            />
            <IconButton
              size="small"
              aria-label="Remove role"
              sx={{ mt: 0.5 }}
              onClick={() => setRoleRows((rows) => rows.filter((_, j) => j !== i))}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setRoleRows((rows) => [...rows, ''])}
        >
          Add another role
        </Button>
        {/* An account with nothing granted can sign in and see no
            section at all, which is a real thing to want for somebody
            on their way out — but not something to do by accident. */}
        {roleRows.filter(Boolean).length === 0 && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            No roles: this account will be able to sign in and see nothing.
          </Alert>
        )}
      </Box>

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
