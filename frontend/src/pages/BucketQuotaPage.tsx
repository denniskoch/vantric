import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TextField } from '@mui/material'
import { api } from '../api/client'
import FormPage from '../components/FormPage'
import { formatBytes } from '../format'

/**
 * A bucket's quota, on its own page because it's a field you fill in and
 * modals here are for confirmation only.
 *
 * Deliberately not part of Create. A quota is enforced against the
 * store's usage figure, so one set on a bucket that already has a figure
 * takes effect at once — where one set at birth refuses every write until
 * the scanner has run.
 */
export default function BucketQuotaPage() {
  const { provider = '', bucket = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [gb, setGb] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bucketPath = `/storage/buckets/${provider}/${bucket}`

  const { data: buckets = [] } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => api.listBuckets(),
  })
  const meta = buckets.find((b) => b.providerId === provider && b.name === bucket)
  // Seeded once from what's stored, then left alone so typing isn't
  // overwritten by the list's next poll.
  if (!loaded && meta) {
    setLoaded(true)
    if (meta.quotaBytes) setGb(String(Math.round((meta.quotaBytes / 1024 ** 3) * 100) / 100))
  }

  const save = useMutation({
    mutationFn: () => api.setBucketQuota(provider, bucket, gb ? Math.round(Number(gb) * 1024 ** 3) : 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buckets'] })
      navigate(bucketPath)
    },
    onError: (e: Error) => setError(e.message),
  })

  const number = Number(gb)
  const gbError =
    gb !== '' && (!Number.isFinite(number) || number < 0) ? 'Enter a size in GB, or 0 to remove' : null

  return (
    <FormPage
      title={`Quota for ${bucket}`}
      backTo={bucketPath}
      backLabel="Bucket"
      error={error}
      onDismissError={() => setError(null)}
      notice="A quota is a hard cap: writes past it are refused. Not every store has quotas — one that doesn't will say so rather than silently accepting this."
      primaryLabel="Save"
      pendingLabel="Saving…"
      primaryDisabled={Boolean(gbError)}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <TextField
        label="Quota (GB)"
        size="small"
        type="number"
        value={gb}
        onChange={(e) => setGb(e.target.value)}
        error={Boolean(gbError)}
        helperText={
          gbError ??
          (meta?.quotaBytes
            ? `Currently ${formatBytes(meta.quotaBytes)}. Blank or 0 removes it.`
            : 'No quota set. Blank or 0 leaves it that way.')
        }
        fullWidth
      />
    </FormPage>
  )
}
