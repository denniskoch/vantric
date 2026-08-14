import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
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
  FormGroup,
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
import MoreVertIcon from '@mui/icons-material/MoreVert'
import KeyIcon from '@mui/icons-material/Key'
import GroupIcon from '@mui/icons-material/Group'
import BlockIcon from '@mui/icons-material/Block'
import CheckIcon from '@mui/icons-material/Check'
import { api } from '../api/client'
import type { IdentityUser } from '../api/client'
import { isServiceAccount, userKind } from '../identity'
import { formatDuration } from '../format'

export default function IdentityUsersPage() {
  const queryClient = useQueryClient()
  const [menu, setMenu] = useState<{ anchor: HTMLElement; user: IdentityUser } | null>(null)
  const [passwordFor, setPasswordFor] = useState<{ user: IdentityUser; password: string } | null>(
    null,
  )
  const [groupsFor, setGroupsFor] = useState<{ user: IdentityUser; chosen: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['identityProviders'],
    queryFn: api.listIdentityProviders,
  })
  const { data: groups = [] } = useQuery({
    queryKey: ['identityGroups'],
    queryFn: api.listIdentityGroups,
    enabled: providers.length > 0,
  })
  const {
    data: users = [],
    isLoading,
    error: usersError,
  } = useQuery({
    queryKey: ['identityUsers'],
    queryFn: api.listIdentityUsers,
    enabled: providers.length > 0,
    retry: false,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['identityUsers'] })
    queryClient.invalidateQueries({ queryKey: ['identityGroups'] })
  }

  const setActive = useMutation({
    mutationFn: (user: IdentityUser) => api.setIdentityUserActive(user.id, !user.active),
    onSuccess: (_, user) => {
      setNotice(`${user.username} is now ${user.active ? 'disabled' : 'active'}`)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  // Membership is saved as a diff: only the boxes you actually changed
  // turn into calls, so a save with nothing ticked does nothing.
  const saveGroups = useMutation({
    mutationFn: async () => {
      const { user, chosen } = groupsFor!
      const before = new Set(user.groups ?? [])
      const after = new Set(chosen)
      const byName = new Map(groups.map((g) => [g.name, g.id]))
      for (const name of after) {
        if (!before.has(name) && byName.has(name)) {
          await api.addIdentityGroupMember(byName.get(name)!, user.id)
        }
      }
      for (const name of before) {
        if (!after.has(name) && byName.has(name)) {
          await api.removeIdentityGroupMember(byName.get(name)!, user.id)
        }
      }
    },
    onSuccess: () => {
      setNotice(`Groups updated for ${groupsFor?.user.username}`)
      setGroupsFor(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const setPassword = useMutation({
    mutationFn: () => api.setIdentityUserPassword(passwordFor!.user.id, passwordFor!.password),
    onSuccess: () => {
      setNotice(`Password changed for ${passwordFor?.user.username}`)
      setPasswordFor(null)
    },
    onError: (e: Error) => setError(e.message),
  })

  const lastLogin = (seconds: number) => {
    if (!seconds) return 'Never'
    return `${formatDuration(Date.now() / 1000 - seconds)} ago`
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Users
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Accounts in your identity provider's directory. Creating accounts and
        editing their details stays in the provider — this is for the changes
        you make in a hurry.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}
      {providers.length === 0 && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button size="small" component={RouterLink} to="/identity/providers">
              Add provider
            </Button>
          }
        >
          No identity provider is connected yet.
        </Alert>
      )}
      {usersError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(usersError as Error).message}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Username</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Groups</TableCell>
              <TableCell>Last sign-in</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell>
                  {user.username}
                  {user.superuser && (
                    <Chip
                      label="admin"
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18, ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell>{user.name || '—'}</TableCell>
                <TableCell>{user.email || '—'}</TableCell>
                <TableCell>{userKind(user.kind)}</TableCell>
                <TableCell sx={{ color: user.active ? undefined : '#d93025' }}>
                  {user.active ? 'Active' : 'Disabled'}
                </TableCell>
                <TableCell
                  sx={{
                    color: '#5f6368',
                    maxWidth: 240,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {/* A user in a dozen groups would otherwise wrap the
                      row to several hundred pixels. */}
                  <Tooltip title={user.groups?.join(', ') ?? ''}>
                    <span>{user.groups?.join(', ') || '—'}</span>
                  </Tooltip>
                </TableCell>
                <TableCell>{lastLogin(user.lastLogin)}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={(e) => setMenu({ anchor: e.currentTarget, user })}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No users.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            if (menu) setActive.mutate(menu.user)
            setMenu(null)
          }}
        >
          {menu?.user.active ? (
            <>
              <BlockIcon fontSize="small" sx={{ mr: 1 }} /> Disable account
            </>
          ) : (
            <>
              <CheckIcon fontSize="small" sx={{ mr: 1 }} /> Enable account
            </>
          )}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) setGroupsFor({ user: menu.user, chosen: menu.user.groups ?? [] })
            setMenu(null)
          }}
        >
          <GroupIcon fontSize="small" sx={{ mr: 1 }} /> Manage groups
        </MenuItem>
        <MenuItem
          disabled={Boolean(menu && isServiceAccount(menu.user.kind))}
          onClick={() => {
            if (menu) setPasswordFor({ user: menu.user, password: '' })
            setMenu(null)
          }}
        >
          <KeyIcon fontSize="small" sx={{ mr: 1 }} /> Set password
        </MenuItem>
        {menu && isServiceAccount(menu.user.kind) && (
          <Typography sx={{ fontSize: 12, color: '#5f6368', px: 2, py: 1, maxWidth: 260 }}>
            Service accounts authenticate with a token, not a password.
          </Typography>
        )}
      </Menu>

      <Dialog
        open={Boolean(groupsFor)}
        onClose={() => setGroupsFor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Groups for {groupsFor?.user.username}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <FormGroup>
            {groups.map((group) => (
              <FormControlLabel
                key={group.id}
                control={
                  <Checkbox
                    size="small"
                    checked={groupsFor?.chosen.includes(group.name) ?? false}
                    onChange={(e) =>
                      setGroupsFor({
                        ...groupsFor!,
                        chosen: e.target.checked
                          ? [...groupsFor!.chosen, group.name]
                          : groupsFor!.chosen.filter((name) => name !== group.name),
                      })
                    }
                  />
                }
                label={
                  <Box component="span">
                    {group.name}
                    {group.superuser && (
                      <Box component="span" sx={{ color: '#f29900', ml: 1, fontSize: 12 }}>
                        grants admin
                      </Box>
                    )}
                  </Box>
                }
              />
            ))}
          </FormGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupsFor(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={saveGroups.isPending}
            onClick={() => saveGroups.mutate()}
          >
            {saveGroups.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(passwordFor)}
        onClose={() => setPasswordFor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Set password for {passwordFor?.user.username}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            label="New password"
            size="small"
            type="password"
            value={passwordFor?.password ?? ''}
            onChange={(e) => setPasswordFor({ ...passwordFor!, password: e.target.value })}
            helperText="Takes effect at the next sign-in; existing sessions continue"
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordFor(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!passwordFor?.password || setPassword.isPending}
            onClick={() => setPassword.mutate()}
          >
            Set password
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
