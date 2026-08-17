import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
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
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import { api } from '../api/client'
import type { Bucket } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import { formatBytes } from '../format'
import { timeAgo } from '../format'
import { usePermissions } from '../user'

/**
 * Buckets across every configured object store.
 *
 * Size and object count come from the store's own usage scanner, which
 * lags behind writes — so an unscanned bucket shows a dash rather than a
 * zero. A bucket written to a minute ago reporting "0 objects" would be
 * a confident false statement; "—" is the true one.
 */
export default function BucketsPage() {
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Bucket | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
  })
  const { data: buckets = [], isLoading, refetch } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => api.listBuckets(),
    refetchInterval: 30000,
  })

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? '—'
  const connected = providers.filter((p) => p.status === 'connected')

  const remove = useMutation({
    mutationFn: (b: Bucket) => api.deleteBucket(b.providerId, b.name),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['buckets'] })
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Buckets"
        actions={
          <>
            {canEdit && (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddBoxIcon />}
                disabled={connected.length === 0}
                onClick={() => navigate('/storage/buckets/create')}
              >
                Create
              </Button>
            )}
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => refetch()}>
              Refresh
            </Button>
          </>
        }
        description="Object storage across the S3-compatible stores in your lab."
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
              <TableCell>Name</TableCell>
              <TableCell>Store</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Objects</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell align="right">Quota</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {buckets.map((b) => (
              <TableRow key={`${b.providerId}/${b.name}`} hover>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/storage/buckets/${b.providerId}/${b.name}`}
                    underline="hover"
                  >
                    {b.name}
                  </Link>
                </TableCell>
                <TableCell>{providerName(b.providerId)}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {b.createdAt ? timeAgo(b.createdAt) : '—'}
                </TableCell>
                {/* Unscanned reads as unknown, not as empty. */}
                <TableCell align="right">
                  {b.scanned ? b.objects.toLocaleString() : <NotScanned />}
                </TableCell>
                <TableCell align="right">
                  {b.scanned ? formatBytes(b.sizeBytes) : <NotScanned />}
                </TableCell>
                <TableCell align="right">
                  {b.quotaBytes ? formatBytes(b.quotaBytes) : '—'}
                </TableCell>
                <TableCell align="right">
                  {canEdit && (
                    <IconButton size="small" onClick={() => setDeleting(b)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {buckets.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No buckets yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name}?`}
        body="A bucket has to be empty before it can be deleted. Emptying it is a separate decision, and this won't make it for you."
        confirmPhrase={deleting?.name}
        confirmLabel="to delete it"
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Box>
  )
}

/** The store hasn't counted this bucket yet, which is not the same as it
 *  being empty. */
function NotScanned() {
  return (
    <Tooltip title="The store's usage scanner hasn't counted this bucket yet">
      <Box component="span" sx={{ color: 'text.secondary' }}>
        —
      </Box>
    </Tooltip>
  )
}
