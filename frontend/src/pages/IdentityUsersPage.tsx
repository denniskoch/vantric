import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Tooltip,
} from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import AddBoxIcon from '@mui/icons-material/AddBox'
import BlockIcon from '@mui/icons-material/Block'
import CheckIcon from '@mui/icons-material/Check'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import type { IdentityUser } from '../api/client'
import { userKind } from '../identity'
import { formatDuration } from '../format'
import { usePermissions } from '../user'

export default function IdentityUsersPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menu, setMenu] = useState<{ anchor: HTMLElement; user: IdentityUser } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['identityProviders'],
    queryFn: api.listIdentityProviders,
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

  const lastLogin = (seconds: number) => {
    if (!seconds) return 'Never'
    return `${formatDuration(Date.now() / 1000 - seconds)} ago`
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Users"
        actions={
          canEdit && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
              disabled={providers.length === 0}
              onClick={() => navigate('/identity/users/create')}
            >
              Create user
            </Button>
          )
        }
        description={
          <>
                Accounts in your identity provider's directory.
          </>
        }
      />

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
                    color: 'text.secondary',
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
                  {canEdit && (
                    <IconButton
                      size="small"
                      onClick={(e) => setMenu({ anchor: e.currentTarget, user })}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
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
            if (menu) navigate(`/identity/users/${menu.user.id}/edit`)
            setMenu(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit user
        </MenuItem>
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
      </Menu>

    </Box>
  )
}
