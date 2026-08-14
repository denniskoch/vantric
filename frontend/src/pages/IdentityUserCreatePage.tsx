import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import FormPage from '../components/FormPage'
import { api } from '../api/client'

const backTo = '/identity/users'

export default function IdentityUserCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ username: string; link?: string; linkError?: string } | null>(
    null,
  )
  const [copied, setCopied] = useState(false)

  const { data: groups = [] } = useQuery({
    queryKey: ['identityGroups'],
    queryFn: api.listIdentityGroups,
  })
  const { data: users = [] } = useQuery({
    queryKey: ['identityUsers'],
    queryFn: api.listIdentityUsers,
  })

  const create = useMutation({
    mutationFn: () =>
      api.createIdentityUser({
        username: username.trim(),
        name: name.trim(),
        email: email.trim(),
        // The API takes group ids; the pickers work in names.
        groups: chosen
          .filter(Boolean)
          .map((n) => groups.find((g) => g.name === n)?.id)
          .filter((id): id is string => Boolean(id)),
      }),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ['identityUsers'] })
      queryClient.invalidateQueries({ queryKey: ['identityGroups'] })
      setCreated({
        username: user.username,
        link: user.recoveryLink,
        linkError: user.recoveryError,
      })
    },
    onError: (e: Error) => setError(e.message),
  })

  const taken = users.some((u) => u.username === username.trim())
  const usernameError = username.includes(' ')
    ? 'Usernames cannot contain spaces'
    : taken
      ? 'That username is already in the directory'
      : null
  const valid = username.trim() !== '' && !usernameError

  // Once the account exists, the page's job is handing over the link —
  // going back to the form would invite creating the person twice.
  if (created) {
    return (
      <Box sx={{ p: 3, maxWidth: 680 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          {created.username} created
        </Typography>
        {created.link ? (
          <>
            <Alert severity="success" sx={{ mb: 2 }}>
              Send this one-time link to {created.username}. They set their own
              password and go through your enrollment flow — this console never
              sees it.
            </Alert>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField
                size="small"
                value={created.link}
                slotProps={{ input: { readOnly: true } }}
                sx={{ flex: 1, '& input': { fontFamily: 'monospace', fontSize: 12 } }}
              />
              <IconButton
                size="small"
                sx={{ mt: 0.5 }}
                onClick={() => {
                  navigator.clipboard?.writeText(created.link ?? '')
                  setCopied(true)
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
            {copied && (
              <Typography sx={{ fontSize: 12, color: '#188038', mt: 1 }}>
                Copied. The link is single-use and expires.
              </Typography>
            )}
          </>
        ) : (
          <Alert severity="warning" sx={{ mb: 2 }}>
            The account was created, but no recovery link could be issued:{' '}
            {created.linkError}. Set a password from the user's edit page instead.
          </Alert>
        )}
        <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 3, borderTop: '1px solid #dadce0' }}>
          <Button variant="contained" onClick={() => navigate(backTo)}>
            Done
          </Button>
        </Box>
      </Box>
    )
  }

  return (
    <FormPage
      title="Create user"
      backTo={backTo}
      backLabel="Users"
      error={error}
      onDismissError={() => setError(null)}
      notice="The new account has no password. Creating it produces a one-time recovery link to hand over, so the person sets their own and passes through your enrollment and MFA on the way in."
      primaryLabel="Create"
      pendingLabel="Creating…"
      primaryDisabled={!valid}
      pending={create.isPending}
      onPrimary={() => create.mutate()}
    >
      <TextField
        label="Username"
        size="small"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={Boolean(usernameError)}
        helperText={usernameError ?? 'What they sign in with'}
        fullWidth
      />
      <TextField
        label="Full name"
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        helperText="Shown in the directory and to applications"
        fullWidth
      />
      <TextField
        label="Email"
        size="small"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        helperText="Applications that key off email need this"
        fullWidth
      />

      <Box>
        <Typography sx={{ fontSize: 16, color: '#202124', mb: 0.5 }}>Groups</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Membership is what grants access to an application; an account in none
          can sign in but reach nothing.
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {chosen.map((group, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField
                label="Group"
                size="small"
                select
                value={group}
                onChange={(e) => setChosen(chosen.map((g, j) => (j === i ? e.target.value : g)))}
                helperText={
                  groups.find((g) => g.name === group)?.superuser ? 'Grants administrator' : ' '
                }
                sx={{
                  width: 380,
                  '& .MuiFormHelperText-root': {
                    color: groups.find((g) => g.name === group)?.superuser ? '#f29900' : undefined,
                  },
                }}
              >
                {groups
                  .filter((g) => g.name === group || !chosen.includes(g.name))
                  .map((g) => (
                    <MenuItem key={g.id} value={g.name}>
                      {g.name}
                    </MenuItem>
                  ))}
              </TextField>
              <IconButton
                size="small"
                sx={{ mt: 0.5 }}
                onClick={() => setChosen(chosen.filter((_, j) => j !== i))}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
        <Button
          size="small"
          startIcon={<AddIcon />}
          sx={{ mt: chosen.length ? 0 : 1 }}
          disabled={chosen.length >= groups.length}
          onClick={() => setChosen([...chosen, ''])}
        >
          Add another group
        </Button>
      </Box>
    </FormPage>
  )
}
