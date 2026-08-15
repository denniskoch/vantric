import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  LinearProgress,
  Link,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { timeAgo } from '../format'

/**
 * The CVE enrichment worker, and the key that decides how fast it runs.
 *
 * Fleet says which machines carry a flaw; it doesn't say what the flaw
 * is, and on a free tier it doesn't score it either. This console
 * fetches that from NVD for every CVE it knows about, slowly, in the
 * background — so a list can sort by severity and the overview can say
 * something meaningful, rather than the answer existing only on pages
 * somebody happened to open.
 *
 * The page exists mostly to answer "is it working": a bar, a count, and
 * the rate limit in force.
 */
export default function DevicesEnrichmentPage() {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['enrichment'],
    queryFn: api.enrichmentStatus,
    // While a pass is running the numbers move; this is the one page
    // where watching it is the point.
    refetchInterval: 5000,
  })

  const toggle = useMutation({
    mutationFn: (on: boolean) => api.setEnrichmentEnabled(on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['enrichment'] }),
    onError: (e: Error) => setError(e.message),
  })

  const save = useMutation({
    mutationFn: (remove?: boolean) => api.setNVDAPIKey(remove ? '' : key.trim(), remove),
    onSuccess: () => {
      setKey('')
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['enrichment'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const cache = data?.cache
  const total = data?.total ?? 0
  const done = cache?.enriched ?? 0
  const missing = cache?.missing ?? 0
  const progress = total > 0 ? Math.min(100, ((done + missing) / total) * 100) : 0
  const remaining = Math.max(0, total - done - missing)
  // The honest estimate, at the rate the limit allows.
  const secondsLeft = remaining * (data?.hasApiKey ? 0.75 : 7)

  return (
    <Box sx={{ p: 3, maxWidth: 900 }}>
      <PageHeader
        title="Vulnerability data"
        description="Your inventory service reports which machines carry a CVE. What the CVE is — the description, the CVSS score, the weakness and the patch — comes from the National Vulnerability Database, fetched in the background for everything you have."
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* NVD meters per key, and per IP for anonymous callers, so two
          consoles backfilling the same estate contend with each other.
          One of them should do it. */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={data?.enabled ?? false}
              disabled={toggle.isPending}
              onChange={(e) => toggle.mutate(e.target.checked)}
            />
          }
          label="Enrich CVEs in the background on this console"
        />
        <Typography sx={{ fontSize: 12, color: '#5f6368' }}>
          NVD counts requests per key, and per address for anonymous callers, so a
          dev console and a production one sharing either will throttle each other.
          Leave this on where the data should be collected and off everywhere else —
          pages still fetch a CVE on demand either way.
        </Typography>
      </Paper>

      <Typography sx={{ fontSize: 16, color: '#202124', mb: 1.5 }}>Progress</Typography>
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{ height: 6, borderRadius: 1, bgcolor: '#f1f3f4', mb: 1.5 }}
        />
        <Box sx={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Fact label="Enriched" value={`${done.toLocaleString()} of ${total.toLocaleString()}`} />
          <Fact
            label="Not in NVD"
            value={missing.toLocaleString()}
            hint={missing ? 'reserved but unpublished' : undefined}
          />
          <Fact label="With a score" value={(cache?.withScore ?? 0).toLocaleString()} />
          <Fact
            label="Status"
            value={data?.running ? 'Running' : remaining > 0 ? 'Waiting' : 'Up to date'}
            hint={
              data?.running && remaining > 0
                ? `about ${Math.ceil(secondsLeft / 60)} minutes left`
                : data?.lastRunAt
                  ? `last pass ${timeAgo(data.lastRunAt)}`
                  : undefined
            }
          />
        </Box>
        {data?.lastError && (
          <Typography sx={{ fontSize: 11, color: '#d93025', mt: 1.5 }}>
            Last error: {data.lastError}
          </Typography>
        )}
      </Paper>

      <Typography sx={{ fontSize: 16, color: '#202124', mb: 1.5 }}>NVD API key</Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Alert severity={data?.hasApiKey ? 'success' : 'info'} sx={{ mb: 2 }}>
          {data?.hasApiKey
            ? 'A key is configured: about 50 requests per 30 seconds, so a few thousand CVEs take under an hour.'
            : 'No key configured. NVD allows anonymous callers a handful of requests a minute, which makes a first pass over a few thousand CVEs take most of a day.'}{' '}
          <Link
            href="https://nvd.nist.gov/developers/request-an-api-key"
            target="_blank"
            rel="noreferrer"
            underline="hover"
          >
            Request one from NIST
          </Link>{' '}
          — it's free and arrives by email.
        </Alert>
        <TextField
          label="API key"
          size="small"
          type="password"
          fullWidth
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            setSaved(false)
          }}
          helperText={
            saved
              ? 'Saved. The next pass uses the faster rate.'
              : // Write-only, like every other credential here — which
                // is why a blank save keeps what's stored rather than
                // deleting it. Remove is a separate button on purpose.
                'Stored in the database and never shown again. Leave blank to keep the current key.'
          }
        />
        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          <Button
            variant="contained"
            disabled={save.isPending || key.trim() === ''}
            onClick={() => save.mutate(false)}
          >
            Save key
          </Button>
          {data?.hasApiKey && (
            <Button color="error" disabled={save.isPending} onClick={() => save.mutate(true)}>
              Remove
            </Button>
          )}
        </Box>
      </Paper>
    </Box>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: '#5f6368' }}>{label}</Typography>
      <Typography sx={{ fontSize: 20, color: '#202124', lineHeight: 1.4 }}>{value}</Typography>
      {hint && <Typography sx={{ fontSize: 11, color: '#80868b' }}>{hint}</Typography>}
    </Box>
  )
}
