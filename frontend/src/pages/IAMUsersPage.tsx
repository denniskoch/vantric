import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import BlockIcon from '@mui/icons-material/Block'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import type { IAMUser } from '../api/client'
import { useSession } from '../user'

/**
 * Who can use this console.
 *
 * Not the identity provider's directory — that's the Identity Platform
 * section. These accounts govern this app and nothing else, which is
 * why the two live apart.
 */
export default function IAMUsersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user: me } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuUser, setMenuUser] = useState<IAMUser | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<IAMUser | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['iamUsers'],
    queryFn: api.listIAMUsers,
  })
  const { data: roles = [] } = useQuery({ queryKey: ['iamRoles'], queryFn: api.listRoles })
  const roleTitle = (id: string) => roles.find((r) => r.id === id)?.title ?? id

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['iamUsers'] })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteIAMUser(id),
    onSuccess: () => {
      setPendingRemoval(null)
      invalidate()
    },
    onError: (e: Error) => {
      setPendingRemoval(null)
      setError(e.message)
    },
  })

  const setActive = useMutation({
    mutationFn: (user: IAMUser) =>
      api.updateIAMUser(user.id, {
        email: user.email,
        name: user.name,
        role: user.role,
        active: !user.active,
      }),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const openMenu = (e: React.MouseEvent<HTMLElement>, user: IAMUser) => {
    setMenuAnchor(e.currentTarget)
    setMenuUser(user)
  }
  const closeMenu = () => setMenuAnchor(null)

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Users"
        actions={
          <>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
              onClick={() => navigate('/iam/users/create')}
            >
              Add user
            </Button>
          </>
        }
        description={
          <>
            Accounts that can sign in to this console, and the role each one holds.
          </>
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Last sign-in</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell>
                  {user.active ? (
                    <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18, verticalAlign: 'middle' }} />
                  ) : (
                    <BlockIcon sx={{ color: 'text.secondary', fontSize: 18, verticalAlign: 'middle' }} />
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/iam/users/${user.id}/edit`}
                    underline="hover"
                  >
                    {user.email}
                  </Link>
                  {me?.id === user.id && (
                    <Chip label="you" size="small" sx={{ ml: 1, fontSize: 10, height: 18 }} />
                  )}
                </TableCell>
                <TableCell>{user.name || '—'}</TableCell>
                <TableCell>{roleTitle(user.role)}</TableCell>
                <TableCell>
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={(e) => openMenu(e, user)}>
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No accounts yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            closeMenu()
            if (menuUser) navigate(`/iam/users/${menuUser.id}/edit`)
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu()
            if (menuUser) navigate(`/iam/users/${menuUser.id}/password`)
          }}
        >
          Reset password
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu()
            if (menuUser) setActive.mutate(menuUser)
          }}
          disabled={menuUser?.id === me?.id}
        >
          {menuUser?.active ? 'Disable' : 'Enable'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu()
            setPendingRemoval(menuUser)
          }}
          disabled={menuUser?.id === me?.id}
          sx={{ color: 'error.main' }}
        >
          Delete
        </MenuItem>
      </Menu>

      <Dialog open={Boolean(pendingRemoval)} onClose={() => setPendingRemoval(null)}>
        <DialogTitle>Delete {pendingRemoval?.email}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            They lose access immediately and any session they hold ends. This
            doesn't touch their account in the identity provider.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingRemoval(null)}>Cancel</Button>
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={() => pendingRemoval && remove.mutate(pendingRemoval.id)}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
