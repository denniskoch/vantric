import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Tooltip,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import RefreshIcon from '@mui/icons-material/Refresh'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { api } from '../api/client'
import type { StoragePolicy, StorageUser } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import { timeAgo } from '../format'
import { policyWarning } from '../storagePolicy'
import { usePermissions } from '../user'

/**
 * Access keys across every configured object store.
 *
 * The store's own API calls these USERS, and so does this console's
 * backend, because that's what the endpoints are called. The UI says
 * access key because nothing signs in as one — it's a credential a
 * script holds — and because this section sits in a console that
 * already has three other things called users (accounts, the identity
 * directory, database users).
 *
 * The secret appears once, when the key is made, and never again. That
 * isn't a limitation to work around: a store that could hand back a
 * secret would be a worse store.
 */
export default function StorageKeysPage() {
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<StorageUser | null>(null)
  const [menu, setMenu] = useState<{ el: HTMLElement; user: StorageUser } | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
  })
  const {
    data: users = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['storageUsers'],
    queryFn: () => api.listStorageUsers(),
    refetchInterval: 30000,
  })

  const connected = providers.filter((p) => p.status === 'connected')
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? '—'

  // Policies are per-store, and the warning below is derived from the
  // policy document rather than its name — so a store that ships a
  // different `readonly` is described accurately.
  const { data: policies = [] } = useQuery({
    queryKey: ['storagePolicies', connected.map((p) => p.id).join(',')],
    queryFn: async () => {
      const all = await Promise.all(
        connected.map((p) =>
          api.listStoragePolicies(p.id).catch(() => [] as StoragePolicy[]),
        ),
      )
      return all.flat()
    },
    enabled: connected.length > 0,
  })
  const policyFor = (user: StorageUser) =>
    policies.find((p) => p.providerId === user.providerId && p.name === user.policy)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['storageUsers'] })

  const setStatus = useMutation({
    mutationFn: (v: { user: StorageUser; enabled: boolean }) =>
      api.setStorageUserStatus(v.user.providerId, v.user.accessKey, v.enabled),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (u: StorageUser) => api.deleteStorageUser(u.providerId, u.accessKey),
    onSuccess: () => {
      setDeleting(null)
      invalidate()
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Access keys"
        actions={
          <>
            {canEdit && (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddBoxIcon />}
                disabled={connected.length === 0}
                onClick={() => navigate('/storage/keys/create')}
              >
                Create
              </Button>
            )}
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => refetch()}>
              Refresh
            </Button>
          </>
        }
        description="Credentials for the S3 API on each store. The stores themselves call these users."
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {providers.length === 0 && !isLoading && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button size="small" component={RouterLink} to="/storage/instances">
              Add a store
            </Button>
          }
        >
          No object store is connected yet.
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Access key</TableCell>
              <TableCell>Store</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Policy</TableCell>
              <TableCell>Changed</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => {
              // Only warn about a policy we actually read. A document
              // that hasn't loaded has no actions, and describing that as
              // "grants nothing" would be a confident false statement
              // about a policy that may grant everything.
              const known = policyFor(u)
              const warning = known ? policyWarning(known) : null
              return (
                <TableRow key={`${u.providerId}/${u.accessKey}`} hover>
                  <TableCell>
                    <Link
                      component={RouterLink}
                      to={`/storage/keys/${u.providerId}/${encodeURIComponent(u.accessKey)}`}
                      underline="hover"
                    >
                      {u.accessKey}
                    </Link>
                  </TableCell>
                  <TableCell>{providerName(u.providerId)}</TableCell>
                  <TableCell sx={{ color: u.enabled ? 'text.primary' : 'text.secondary' }}>
                    {u.enabled ? 'Enabled' : 'Disabled'}
                  </TableCell>
                  <TableCell>
                    {u.policy ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {u.policy}
                        {warning && (
                          <Tooltip title={warning}>
                            <WarningAmberIcon
                              fontSize="small"
                              sx={{ color: 'warning.main', display: 'block' }}
                            />
                          </Tooltip>
                        )}
                      </Box>
                    ) : (
                      // A key with nothing bound can sign requests and
                      // reach nothing, which is worth saying rather than
                      // leaving as a dash.
                      <Chip label="No access" size="small" />
                    )}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {u.updatedAt ? timeAgo(u.updatedAt) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {canEdit && (
                      <IconButton
                        size="small"
                        onClick={(e) => setMenu({ el: e.currentTarget, user: u })}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No access keys yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menu?.el} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            navigate(
              `/storage/keys/${menu!.user.providerId}/${encodeURIComponent(menu!.user.accessKey)}`,
            )
            setMenu(null)
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setStatus.mutate({ user: menu!.user, enabled: !menu!.user.enabled })
            setMenu(null)
          }}
        >
          {menu?.user.enabled ? 'Disable' : 'Enable'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            navigate(
              `/storage/keys/${menu!.user.providerId}/${encodeURIComponent(menu!.user.accessKey)}/secret`,
            )
            setMenu(null)
          }}
        >
          Replace secret
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleting(menu!.user)
            setMenu(null)
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.accessKey}?`}
        body="Anything still signing with this key stops working immediately, and the key can't be recreated with the same secret. To stop it temporarily instead, disable it."
        confirmPhrase={deleting?.accessKey}
        confirmLabel="to delete it"
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Box>
  )
}
