import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import FormPage from '../components/FormPage'

/**
 * Opening a folder in a bucket to anonymous reads.
 *
 * Its own page rather than a dialog, because it's a form — and because
 * this is the one action in the section whose blast radius is "the
 * internet", which deserves more room than a modal gives it.
 *
 * Granting REPLACES any existing public grant rather than adding a
 * second one. If opening a second path also meant remembering the first,
 * "what is public here" would stop being answerable by looking.
 */
export default function BucketPublicPage() {
  const { provider = '', bucket = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [prefix, setPrefix] = useState('')
  const [allowList, setAllowList] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['bucketPermissions', provider, bucket],
    queryFn: () => api.bucketPermissions(provider, bucket),
  })
  const alreadyPublic = Boolean(data?.policy?.exposure.public)

  const save = useMutation({
    mutationFn: () =>
      api.grantBucketPublic(provider, bucket, { prefix: prefix.trim(), allowList }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bucketPermissions', provider, bucket] })
      navigate(`/storage/buckets/${provider}/${bucket}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  // A prefix becomes part of an ARN, where a stray "*" widens the grant
  // instead of failing — the one typo here that quietly opens more than
  // was asked for. The backend refuses it too.
  const prefixError = prefix.includes('*')
    ? 'A folder path, not a pattern — leave out the *'
    : null

  const target = prefix.trim() ? `${bucket}/${prefix.trim().replace(/^\/|\/$/g, '')}/` : `${bucket}/`

  return (
    <FormPage
      title="Make a folder public"
      backTo={`/storage/buckets/${provider}/${bucket}`}
      backLabel={bucket}
      error={error}
      onDismissError={() => setError(null)}
      notice="Anything under this path becomes readable by anyone who knows the URL — no credentials, no sign-in, over plain HTTP. Only put things here you would be comfortable finding in a search engine."
      primaryLabel="Make public"
      pendingLabel="Saving…"
      primaryDisabled={Boolean(prefixError)}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      {alreadyPublic && (
        <Alert severity="info">
          Something in this bucket is already public. Saving replaces that grant rather than adding
          to it, so what's public stays answerable by looking once.
        </Alert>
      )}

      <TextField
        label="Folder"
        size="small"
        value={prefix}
        onChange={(e) => setPrefix(e.target.value)}
        error={Boolean(prefixError)}
        helperText={prefixError ?? 'A key prefix, e.g. public or site/assets. Leave blank for the whole bucket.'}
        fullWidth
      />

      <Typography variant="body2" color="text.secondary">
        Anyone will be able to read <strong>{target}*</strong>
      </Typography>

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={allowList}
            onChange={(e) => setAllowList(e.target.checked)}
          />
        }
        label="Also let anyone list what's in it"
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
        Without this, a file can only be fetched by someone who already knows its exact name. With
        it, the folder's whole contents can be enumerated by anyone — a much larger decision, and
        rarely what a file you're linking to needs.
      </Typography>

      {!prefix.trim() && (
        <Alert severity="warning">
          With no folder set, every object in {bucket} becomes readable — including anything added
          later.
        </Alert>
      )}
    </FormPage>
  )
}
