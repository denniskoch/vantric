import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Button, IconButton, MenuItem, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { IdentityUser } from '../api/client'
import FormPage from '../components/FormPage'
import DetailTable from '../components/DetailTable'
import { isServiceAccount, userKind } from '../identity'
import { formatDuration } from '../format'

function EditForm({ user, groups }: { user: IdentityUser; groups: { id: string; name: string; superuser: boolean }[] }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [active, setActive] = useState(user.active)
  const [chosen, setChosen] = useState<string[]>(user.groups ?? [])
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const before = new Set(user.groups ?? [])
  const after = new Set(chosen.filter(Boolean))
  const added = [...after].filter((name) => !before.has(name))
  const removed = [...before].filter((name) => !after.has(name))
  const dirty = active !== user.active || added.length > 0 || removed.length > 0 || password !== ''

  // Everything saves as a diff, so an untouched field is never written
  // and the audit log stays honest about what actually changed.
  const save = useMutation({
    mutationFn: async () => {
      const byName = new Map(groups.map((g) => [g.name, g.id]))
      if (active !== user.active) {
        await api.setIdentityUserActive(user.id, active)
      }
      for (const name of added) {
        const id = byName.get(name)
        if (id) await api.addIdentityGroupMember(id, user.id)
      }
      for (const name of removed) {
        const id = byName.get(name)
        if (id) await api.removeIdentityGroupMember(id, user.id)
      }
      if (password) {
        await api.setIdentityUserPassword(user.id, password)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identityUsers'] })
      queryClient.invalidateQueries({ queryKey: ['identityGroups'] })
      navigate('/identity/users')
    },
    onError: (e: Error) => setError(e.message),
  })

  const lastLogin = user.lastLogin
    ? `${formatDuration(Date.now() / 1000 - user.lastLogin)} ago`
    : 'Never'

  return (
    <FormPage
      title={`Edit ${user.username}`}
      backTo="/identity/users"
      backLabel="Users"
      error={error}
      onDismissError={() => setError(null)}
      notice="Names, emails and account creation belong to the identity provider. This page changes what you'd change in a hurry: whether the account works, what it belongs to, and its password."
      primaryLabel="Save"
      pendingLabel="Saving…"
      primaryDisabled={!dirty}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <DetailTable
        rows={[
          { label: 'Username', value: user.username },
          { label: 'Name', value: user.name || '—' },
          { label: 'Email', value: user.email || '—' },
          { label: 'Type', value: userKind(user.kind) },
          { label: 'Last sign-in', value: lastLogin },
        ]}
      />

      <TextField
        label="Status"
        size="small"
        select
        value={active ? 'active' : 'disabled'}
        onChange={(e) => setActive(e.target.value === 'active')}
        helperText="A disabled account keeps its groups but can't sign in"
        fullWidth
      >
        <MenuItem value="active">Active</MenuItem>
        <MenuItem value="disabled">Disabled</MenuItem>
      </TextField>

      <Box>
        <Typography sx={{ fontSize: 16, color: 'text.primary', mb: 0.5 }}>Groups</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Membership is what grants access to an application, and a superuser
          group makes this account an administrator.
        </Typography>
        {/* A row per group rather than a checklist of every group there
            is: someone in two groups shouldn't have to read fourteen
            lines to see it. */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {chosen.map((name, i) => {
            const group = groups.find((g) => g.name === name)
            return (
              <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label="Group"
                  size="small"
                  select
                  value={name}
                  onChange={(e) =>
                    setChosen(chosen.map((n, j) => (j === i ? e.target.value : n)))
                  }
                  helperText={group?.superuser ? 'Grants administrator' : ' '}
                  sx={{
                    width: 380,
                    '& .MuiFormHelperText-root': { color: group?.superuser ? '#f29900' : undefined },
                  }}
                >
                  {groups
                    // Only groups not already picked, plus this row's own.
                    .filter((g) => g.name === name || !chosen.includes(g.name))
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
            )
          })}
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
        {chosen.length === 0 && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
            This account belongs to no groups.
          </Typography>
        )}
      </Box>

      <TextField
        label="New password"
        size="small"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={isServiceAccount(user.kind)}
        helperText={
          isServiceAccount(user.kind)
            ? 'Service accounts authenticate with a token, not a password'
            : 'Leave blank to keep the current password'
        }
        fullWidth
      />
    </FormPage>
  )
}

export default function IdentityUserEditPage() {
  const { id = '' } = useParams()
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['identityUsers'],
    queryFn: api.listIdentityUsers,
  })
  const { data: groups = [] } = useQuery({
    queryKey: ['identityGroups'],
    queryFn: api.listIdentityGroups,
  })

  const user = users.find((u) => u.id === id)
  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">
          {isLoading ? 'Loading user…' : 'That account no longer exists.'}
        </Typography>
      </Box>
    )
  }
  return <EditForm user={user} groups={groups} />
}
