import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RefreshIcon from '@mui/icons-material/Refresh'
import UploadIcon from '@mui/icons-material/Upload'
import DownloadIcon from '@mui/icons-material/Download'
import DeleteIcon from '@mui/icons-material/Delete'
import FolderIcon from '@mui/icons-material/Folder'
import DescriptionIcon from '@mui/icons-material/Description'
import { api } from '../api/client'
import DetailTable from '../components/DetailTable'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { formatBytes, timeAgo } from '../format'
import { usePermissions } from '../user'

/**
 * One bucket, on Cloud Storage's shape: a strip of facts under the name,
 * then tabs. Objects is the tab you live in.
 *
 * A bucket's keyspace is flat — "folders" are what a delimiter makes of
 * the slashes in a key — so this browses by prefix rather than pretending
 * a tree exists underneath.
 */
export default function BucketDetailPage() {
  const { provider = '', bucket = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()
  const [tab, setTab] = useState('objects')
  const [prefix, setPrefix] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
  })
  const store = providers.find((p) => p.id === provider)

  const { data: buckets = [] } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => api.listBuckets(),
  })
  const meta = buckets.find((b) => b.providerId === provider && b.name === bucket)

  const {
    data: page,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['objects', provider, bucket, prefix],
    queryFn: () => api.listObjects(provider, bucket, { prefix, delimiter: '/' }),
    enabled: Boolean(provider && bucket),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['objects', provider, bucket] })
    queryClient.invalidateQueries({ queryKey: ['buckets'] })
  }

  const removeObject = useMutation({
    mutationFn: (key: string) => api.deleteObject(provider, bucket, key),
    onSuccess: () => {
      setDeleting(null)
      invalidate()
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      // Uploaded under the prefix being browsed, which is what "put it
      // in this folder" means in a flat keyspace.
      await api.uploadObject(provider, bucket, prefix + file.name, file)
      invalidate()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  // Breadcrumbs from the prefix, so you can climb back out.
  const parts = prefix.split('/').filter(Boolean)
  const crumbs = parts.map((part, i) => ({
    label: part,
    prefix: parts.slice(0, i + 1).join('/') + '/',
  }))

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 1.5 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/storage/buckets')}>
          Buckets
        </Button>
        <Typography variant="h5">{bucket}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<RefreshIcon />} onClick={() => refetch()}>
          Refresh
        </Button>
      </Box>

      {/* Cloud Storage's strip of facts, rather than a table for four
          values you read at a glance. */}
      <Box sx={{ px: 3, display: 'flex', gap: 5, flexWrap: 'wrap', mb: 2 }}>
        <Fact label="Store" value={store?.name ?? '—'} />
        <Fact label="Endpoint" value={store?.baseUrl ?? '—'} />
        <Fact
          label="Objects"
          value={meta?.scanned ? meta.objects.toLocaleString() : 'Not scanned yet'}
        />
        <Fact
          label="Size"
          value={meta?.scanned ? formatBytes(meta.sizeBytes) : 'Not scanned yet'}
        />
        <Fact label="Quota" value={meta?.quotaBytes ? formatBytes(meta.quotaBytes) : 'None'} />
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ px: 3, borderBottom: '1px solid #dadce0', minHeight: 44 }}
      >
        <Tab label="Objects" value="objects" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Details" value="details" sx={{ textTransform: 'none', minHeight: 44 }} />
      </Tabs>

      <Box sx={{ p: 3, maxWidth: 1100 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {tab === 'objects' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
              {canEdit && (
                <>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<UploadIcon />}
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    Upload
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) upload(file)
                      e.target.value = ''
                    }}
                  />
                </>
              )}
              <Box sx={{ flex: 1 }} />
              {/* Where you are, and the way back. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 13 }}>
                <Link component="button" underline="hover" onClick={() => setPrefix('')}>
                  {bucket}
                </Link>
                {crumbs.map((c) => (
                  <Box key={c.prefix} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span style={{ color: '#5f6368' }}>/</span>
                    <Link component="button" underline="hover" onClick={() => setPrefix(c.prefix)}>
                      {c.label}
                    </Link>
                  </Box>
                ))}
              </Box>
            </Box>

            {/* The bytes are leaving this machine, so this one waits. */}
            {uploading && <LinearProgress sx={{ mb: 2 }} />}

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">Size</TableCell>
                    <TableCell>Last modified</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {page?.prefixes.map((p) => (
                    <TableRow key={p} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <FolderIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          <Link component="button" underline="hover" onClick={() => setPrefix(p)}>
                            {p.slice(prefix.length).replace(/\/$/, '')}
                          </Link>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary' }}>
                        —
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>—</TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                  {page?.objects.map((o) => (
                    <TableRow key={o.key} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <DescriptionIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          <Box sx={{ wordBreak: 'break-all' }}>{o.key.slice(prefix.length)}</Box>
                        </Box>
                      </TableCell>
                      <TableCell align="right">{formatBytes(o.sizeBytes)}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {o.modifiedAt ? timeAgo(o.modifiedAt) : '—'}
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Download">
                          <IconButton
                            size="small"
                            component="a"
                            href={api.objectDownloadURL(provider, bucket, o.key)}
                          >
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {canEdit && (
                          <IconButton size="small" onClick={() => setDeleting(o.key)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {page && page.objects.length === 0 && page.prefixes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                        {isLoading ? 'Loading…' : prefix ? 'Nothing under this prefix.' : 'This bucket is empty.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            {page?.truncated && (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
                Showing the first page. Object stores paginate by cursor, so there's no page
                count to report.
              </Typography>
            )}
          </>
        )}

        {tab === 'details' && (
          <DetailTable
            rows={[
              { label: 'Name', value: bucket },
              { label: 'Store', value: store ? `${store.name} (${store.type})` : '—' },
              { label: 'Endpoint', value: store?.baseUrl ?? '—' },
              { label: 'Created', value: meta?.createdAt ? timeAgo(meta.createdAt) : '—' },
              {
                label: 'Objects',
                value: meta?.scanned
                  ? meta.objects.toLocaleString()
                  : "The store's usage scanner hasn't counted this bucket yet",
              },
              {
                label: 'Size',
                value: meta?.scanned
                  ? formatBytes(meta.sizeBytes)
                  : "The store's usage scanner hasn't counted this bucket yet",
              },
              {
                label: 'Quota',
                value: meta?.quotaBytes ? formatBytes(meta.quotaBytes) : 'No quota set',
              },
            ]}
          />
        )}
      </Box>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title="Delete this object?"
        body={
          <>
            This permanently removes <code>{deleting}</code>. Nothing else brings it back.
          </>
        }
        confirmPhrase="I UNDERSTAND"
        confirmLabel="to delete it"
        pending={removeObject.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && removeObject.mutate(deleting)}
      />
    </Box>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontSize: 13 }}>{value}</Typography>
    </Box>
  )
}
