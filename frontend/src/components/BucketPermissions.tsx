import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import PublicIcon from '@mui/icons-material/Public'
import LockIcon from '@mui/icons-material/Lock'
import { api } from '../api/client'
import type { PublicGrant } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'

/**
 * A bucket's permissions, which live in two unrelated places.
 *
 * WHO CAN REACH IT comes from the policies attached to the store's
 * access keys — there is no endpoint that answers it, so the console
 * reads them all and matches resource ARNs. That correlation is the
 * thing this page has that the store's own UI hasn't.
 *
 * IS IT PUBLIC comes from the bucket policy, and leads, because it's the
 * only setting in this section that can serve data to the internet
 * without anything else here noticing. It's stated in terms of what
 * actually happens — anyone can fetch, anyone can list, anyone can
 * write — rather than as a badge, because "Public" alone doesn't tell
 * you which of those you're living with.
 */
export default function BucketPermissions({
  providerId,
  bucket,
}: {
  providerId: string
  bucket: string
}) {
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['bucketPermissions', providerId, bucket],
    queryFn: () => api.bucketPermissions(providerId, bucket),
  })

  const revoke = useMutation({
    mutationFn: () => api.revokeBucketPublic(providerId, bucket),
    onSuccess: () => {
      setClosing(false)
      queryClient.invalidateQueries({ queryKey: ['bucketPermissions', providerId, bucket] })
    },
    onError: (e: Error) => {
      setClosing(false)
      setError(e.message)
    },
  })

  if (isLoading || !data) {
    return <Typography sx={{ color: 'text.secondary', py: 4 }}>Loading…</Typography>
  }

  const exposure = data.policy?.exposure
  const isPublic = Boolean(exposure?.public)

  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Public access
        </Typography>
        {!data.policySupported ? (
          // Not the same as "not public": this store can't be asked, and
          // a reassuring answer would be one nobody checked.
          <Alert severity="info">
            This store doesn't support bucket policies, so there's nothing here to read.
          </Alert>
        ) : isPublic ? (
          <Alert severity="warning" icon={<PublicIcon />}>
            <AlertTitle>Open to anyone on the internet</AlertTitle>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {exposure!.grants.map((grant, i) => (
                <GrantSummary key={grant.sid || i} grant={grant} />
              ))}
            </Stack>
            {canEdit && (
              <Button size="small" sx={{ mt: 1.5 }} onClick={() => setClosing(true)}>
                Remove public access
              </Button>
            )}
          </Alert>
        ) : (
          <Alert severity="success" icon={<LockIcon />}>
            Not public. Every request has to be signed with an access key.
          </Alert>
        )}
        {data.policySupported && canEdit && (
          <Button
            size="small"
            sx={{ mt: 1 }}
            onClick={() =>
              navigate(`/storage/buckets/${providerId}/${bucket}/public`)
            }
          >
            {isPublic ? 'Change what’s public' : 'Make a folder public'}
          </Button>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Access keys that reach this bucket
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Worked out from the policy attached to each key on this store. A key with no policy
          reaches nothing and isn't listed.
        </Typography>
        {!data.keysKnown ? (
          <Alert severity="info">This store doesn't manage its own access keys.</Alert>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Access key</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Policy</TableCell>
                  <TableCell>Allows</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.keys.map((k) => (
                  <TableRow key={k.accessKey} hover>
                    <TableCell>
                      <Link
                        component={RouterLink}
                        to={`/storage/keys/${providerId}/${encodeURIComponent(k.accessKey)}`}
                        underline="hover"
                      >
                        {k.accessKey}
                      </Link>
                    </TableCell>
                    <TableCell sx={{ color: k.enabled ? 'text.primary' : 'text.secondary' }}>
                      {k.enabled ? 'Enabled' : 'Disabled'}
                    </TableCell>
                    <TableCell>{k.policy}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {k.actions.filter((a) => a !== 'sts:AssumeRole').join(', ')}
                    </TableCell>
                  </TableRow>
                ))}
                {data.keys.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No access key on this store reaches this bucket.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      {data.policy?.document != null && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Bucket policy
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            The document as the store holds it. Editing statements beyond public access stays in
            the store's own console.
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              overflowX: 'auto',
              bgcolor: '#f8f9fa',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            <Box component="pre" sx={{ m: 0 }}>
              {JSON.stringify(data.policy.document, null, 2)}
            </Box>
          </Paper>
        </Box>
      )}

      <ConfirmDeleteDialog
        open={closing}
        title="Remove public access?"
        body="Anonymous reads stop immediately. Anything serving these files by plain URL — a website, a script without credentials — breaks. Statements naming a specific principal are left alone."
        actionLabel="Remove"
        pending={revoke.isPending}
        onCancel={() => setClosing(false)}
        onConfirm={() => revoke.mutate()}
      />
    </Stack>
  )
}

/**
 * One anonymous grant, in the terms that matter: what can be reached,
 * and whether the world can also enumerate or change it. Listing and
 * writing are called out separately because they're different sizes of
 * decision — serving a known URL is not the same as publishing an index,
 * and neither is the same as letting strangers upload.
 */
function GrantSummary({ grant }: { grant: PublicGrant }) {
  const paths = grant.resources.map((r) => r.replace(/^arn:aws:s3:::/, '')).join(', ')
  return (
    <Box>
      <Typography variant="body2">
        Anyone can <strong>read</strong> {paths || 'this bucket'}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
        {grant.listable && <Chip size="small" label="Anyone can list the contents" />}
        {grant.writable && <Chip size="small" label="Anyone can upload or delete" />}
        {grant.actions.map((a) => (
          <Chip key={a} size="small" label={a} />
        ))}
      </Box>
    </Box>
  )
}
