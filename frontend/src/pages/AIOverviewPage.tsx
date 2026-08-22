import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import SectionLandingPage from './SectionLandingPage'
import TimeSeriesChart from '../components/TimeSeriesChart'
import ProviderName from '../components/ProviderName'
import { chart } from '../chartPalette'
import { api } from '../api/client'

/**
 * The AI section's front page: enough to know whether anything is
 * wrong before opening the request log, and no more.
 *
 * A DAY, NOT ALL TIME. An all-time success rate keeps reporting an
 * outage long after it is fixed — this lab's sits at 51% because of
 * one migration that broke Ollama for a day, and it will say 51% for
 * months. A front page owes you the state of the thing now, so every
 * traffic figure here is the last 24 hours and says so underneath.
 * That window is not a promise the number will look good: while the
 * outage is still inside it, the page reports it in red, which is the
 * whole point.
 *
 * It adds no integration: the gateway and the provider accounts are
 * already connected, and this asks them the questions the other pages
 * don't.
 */

const DAY_HOURS = 24

export default function AIOverviewPage() {
  // Pinned once per mount. A window recomputed each render would
  // change the query key on every keystroke elsewhere in the tree.
  const since = useMemo(
    () => new Date(Date.now() - DAY_HOURS * 3600_000).toISOString(),
    [],
  )
  const query = { since }

  const { data: stats } = useQuery({
    queryKey: ['aiStats', 'overview', since],
    queryFn: () => api.getAIStats(query),
    refetchInterval: 60_000,
  })
  const { data: traffic } = useQuery({
    queryKey: ['aiTraffic', since],
    queryFn: () => api.getAITraffic(query),
    refetchInterval: 60_000,
  })
  const { data: models = [] } = useQuery({
    queryKey: ['aiRankings', since],
    queryFn: () => api.getAIRankings({ ...query, limit: 8 }),
    refetchInterval: 60_000,
  })
  const { data: accounts = [] } = useQuery({
    queryKey: ['aiAccounts'],
    queryFn: api.listAIAccounts,
    refetchInterval: 5 * 60_000,
  })

  const buckets = traffic?.buckets ?? []
  const times = buckets.map((b) => Math.floor(new Date(b.at).getTime() / 1000))
  const failed = buckets.reduce((sum, b) => sum + b.failed, 0)

  return (
    <SectionLandingPage>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
        <Stat label="Requests" value={stats ? stats.requests.toLocaleString() : '—'} />
        <Stat
          label="Succeeded"
          value={stats ? `${stats.successRate.toFixed(1)}%` : '—'}
          // Anything much below 100 is worth looking at; a gateway that
          // fails one call in ten is not "mostly fine".
          alarming={Boolean(stats && stats.requests > 0 && stats.successRate < 90)}
        />
        <Stat label="Average latency" value={stats ? formatMs(stats.avgLatencyMs) : '—'} />
        <Stat label="Tokens" value={stats ? compact(stats.totalTokens) : '—'} />
        {accounts.map((a) => (
          <Stat
            key={a.id}
            label={`${a.name} credit`}
            value={
              a.balance?.remaining === undefined
                ? '—'
                : a.balance.unit === 'USD'
                  ? `$${a.balance.remaining.toFixed(2)}`
                  : `${compact(a.balance.remaining)} ${a.balance.unit}`
            }
            alarming={Boolean(a.balance?.remaining !== undefined && a.balance.remaining < 5)}
          />
        ))}
      </Box>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 3 }}>
        Traffic figures cover the last 24 hours. Credit is whatever the provider last
        reported.
      </Typography>

      {failed > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {failed.toLocaleString()} request{failed === 1 ? '' : 's'} failed in the last 24
          hours.
        </Alert>
      )}

      {buckets.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <TimeSeriesChart
            title={`Requests per ${traffic && traffic.bucketSeconds === 3600 ? 'hour' : `${(traffic?.bucketSeconds ?? 0) / 60} minutes`}`}
            times={times}
            format={(v) => v.toLocaleString()}
            minYMax={5}
            series={[
              {
                name: 'Succeeded',
                color: chart.series[0],
                values: buckets.map((b) => b.succeeded),
              },
              { name: 'Failed', color: '#d93025', values: buckets.map((b) => b.failed) },
            ]}
          />
        </Box>
      )}

      {models.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 16, mb: 1.5 }}>Models</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Provider</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell align="right">Requests</TableCell>
                  <TableCell align="right">Succeeded</TableCell>
                  <TableCell align="right">Tokens</TableCell>
                  <TableCell align="right">Latency</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {models.map((m) => (
                  <TableRow key={`${m.provider}/${m.model}`} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <ProviderName name={m.provider} />
                    </TableCell>
                    <TableCell>{m.model || '—'}</TableCell>
                    <TableCell align="right">{m.requests.toLocaleString()}</TableCell>
                    <TableCell align="right">
                      {m.requests > 0
                        ? `${((m.succeeded / m.requests) * 100).toFixed(1)}%`
                        : '—'}
                    </TableCell>
                    <TableCell align="right">{compact(m.tokens)}</TableCell>
                    <TableCell align="right">{formatMs(m.avgLatencyMs)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </SectionLandingPage>
  )
}

function Stat({
  label,
  value,
  alarming,
}: {
  label: string
  value: string
  alarming?: boolean
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 160, flex: '1 1 160px' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 400, color: alarming ? 'error.main' : undefined }}>
        {value}
      </Typography>
    </Paper>
  )
}

function formatMs(ms: number): string {
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
