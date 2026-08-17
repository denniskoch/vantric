import { useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Link,
  Paper,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import type { MetricTimeframe } from '../api/client'
import DetailTable, { DetailSection } from '../components/DetailTable'
import TimeSeriesChart from '../components/TimeSeriesChart'
import UsageBar from '../components/UsageBar'
import { chart } from '../chartPalette'
import { formatBytes, formatBytesPerSec, formatPercent, formatUptime } from '../format'
import { useHypervisorNames } from '../useHypervisorNames'

/** Renders a value the host didn't report as words rather than a zero. */
function reported(value: string | number | undefined | null, render?: () => React.ReactNode) {
  if (value === undefined || value === null || value === '' || value === 0) {
    return <span style={{ color: 'inherit', opacity: 0.6 }}>Not reported</span>
  }
  return render ? render() : String(value)
}

/**
 * One virtualization host in detail.
 *
 * The only page in this console that describes the SUBSTRATE. Every
 * other one can show healthy guests and a half-empty datastore while
 * the machine underneath them is out of memory and swapping — which is
 * why swap and the host's own root filesystem are here, and why
 * neither belongs on a datastore page.
 */
export default function NodeDetailPage() {
  const { server, node } = useParams<{ server: string; node: string }>()
  const navigate = useNavigate()
  const hypervisorName = useHypervisorNames()
  const [tab, setTab] = useState('details')
  const [timeframe, setTimeframe] = useState<MetricTimeframe>('hour')

  const { data: nodes = [] } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.listNodes(),
    refetchInterval: 10000,
  })
  const summary = nodes.find((z) => z.hypervisorId === server && z.id === node)

  const {
    data: status,
    isLoading,
    error: statusError,
  } = useQuery({
    queryKey: ['node', server, node],
    queryFn: () => api.getNode(server!, node!),
    enabled: Boolean(server && node),
    refetchInterval: 10000,
  })

  const { data: metrics = [], isLoading: metricsLoading } = useQuery({
    queryKey: ['nodeMetrics', server, node, timeframe],
    queryFn: () => api.nodeMetrics(server!, node!, timeframe),
    enabled: Boolean(server && node) && tab === 'observability',
  })

  // No guest list here. VM instances and CT instances both carry a
  // Node column already, and forty-four rows of what this host is
  // running would bury the six facts the page exists to show.

  const times = metrics.map((m) => m.time)
  const maxMemory = metrics.reduce((max, m) => Math.max(max, m.maxMemoryBytes), 0)

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 1.5 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/compute/nodes')}>
          Nodes
        </Button>
        {summary &&
          (summary.status === 'online' ? (
            <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
          ) : (
            <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
          ))}
        <Typography variant="h5">{node}</Typography>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ px: 3, borderBottom: '1px solid #dadce0', minHeight: 44 }}
      >
        <Tab label="Details" value="details" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Observability" value="observability" sx={{ textTransform: 'none', minHeight: 44 }} />
      </Tabs>

      <Box sx={{ p: 3, maxWidth: 1100 }}>
        {statusError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Couldn't read this host: {(statusError as Error).message}
          </Alert>
        )}
        {isLoading && !status && <Typography color="text.secondary">Loading…</Typography>}

        {status && tab === 'details' && (
          <>
            {/* A hypervisor that has started swapping is one whose
                guests are about to feel it, and nothing else in this
                console would ever say so. */}
            {status.swapUsedBytes > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                This host is using {formatBytes(status.swapUsedBytes)} of swap. Guests on a
                swapping hypervisor slow down in ways that look like problems inside them.
              </Alert>
            )}

            <DetailSection title="Basic information">
              <DetailTable
                rows={[
                  { label: 'Name', value: status.name },
                  {
                    label: 'Server',
                    value: (
                      <Link
                        component={RouterLink}
                        to="/compute/settings/hypervisors"
                        underline="hover"
                      >
                        {hypervisorName(status.hypervisorId)}
                      </Link>
                    ),
                  },
                  { label: 'Status', value: summary?.status ?? 'unknown' },
                  {
                    label: 'Uptime',
                    value: reported(status.uptimeSeconds, () =>
                      formatUptime(status.uptimeSeconds),
                    ),
                  },
                  { label: 'Hypervisor version', value: reported(status.version) },
                  { label: 'Kernel', value: reported(status.kernelVersion) },
                  {
                    label: 'Boot mode',
                    value: reported(status.bootMode, () =>
                      status.bootMode === 'efi'
                        ? `UEFI${status.secureBoot ? ', Secure Boot on' : ''}`
                        : status.bootMode,
                    ),
                  },
                ]}
              />
            </DetailSection>

            <DetailSection title="CPU">
              <DetailTable
                rows={[
                  { label: 'Model', value: reported(status.cpuModel) },
                  {
                    label: 'Topology',
                    value: reported(status.cpus, () => {
                      const parts = [`${status.cpus} logical`]
                      if (status.cpuCores) parts.push(`${status.cpuCores} cores`)
                      if (status.cpuSockets) parts.push(`${status.cpuSockets} socket(s)`)
                      return parts.join(', ')
                    }),
                  },
                  {
                    label: 'Base frequency',
                    value: reported(status.cpuMhz, () => `${status.cpuMhz} MHz`),
                  },
                  { label: 'Current utilization', value: formatPercent(status.cpuPercent) },
                  {
                    // The number that explains a host which is busy
                    // without doing anything.
                    label: 'I/O wait',
                    value: formatPercent(status.ioWaitPercent),
                  },
                  {
                    label: 'Load average',
                    value: status.loadAverage?.length
                      ? `${status.loadAverage.join(', ')}${status.cpus ? ` (${status.cpus} logical CPUs)` : ''}`
                      : reported(''),
                  },
                ]}
              />
            </DetailSection>

            <DetailSection title="Memory">
              <DetailTable
                rows={[
                  {
                    label: 'RAM',
                    value: (
                      <UsageBar
                        used={status.memoryUsedBytes}
                        total={status.memoryTotalBytes}
                        minWidth={280}
                      />
                    ),
                  },
                  {
                    label: 'Swap',
                    value: status.swapTotalBytes ? (
                      <UsageBar
                        used={status.swapUsedBytes}
                        total={status.swapTotalBytes}
                        minWidth={280}
                      />
                    ) : (
                      'No swap configured'
                    ),
                  },
                  {
                    // How a host runs guests whose memory adds up to
                    // more than it has.
                    label: 'Shared by KSM',
                    value: status.ksmSharedBytes
                      ? formatBytes(status.ksmSharedBytes)
                      : 'None merged',
                  },
                ]}
              />
            </DetailSection>

            <DetailSection title="Root filesystem">
              <DetailTable
                rows={[
                  {
                    label: 'Usage',
                    value: (
                      <UsageBar
                        used={status.rootUsedBytes}
                        total={status.rootTotalBytes}
                        minWidth={280}
                      />
                    ),
                  },
                ]}
              />
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
                The host's own filesystem, not a datastore. Filling it stops the hypervisor
                whatever its storage pools have left.
              </Typography>
            </DetailSection>

          </>
        )}

        {tab === 'observability' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={timeframe}
                onChange={(_, v) => v && setTimeframe(v)}
              >
                {(['hour', 'day', 'week', 'month'] as MetricTimeframe[]).map((tf) => (
                  <ToggleButton key={tf} value={tf} sx={{ textTransform: 'none', px: 1.5 }}>
                    {tf === 'hour' ? '1 hour' : tf === 'day' ? '1 day' : tf === 'week' ? '1 week' : '1 month'}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Typography variant="body2" color="text.secondary">
                Sampled by the hypervisor.
              </Typography>
            </Box>

            {metrics.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
                {metricsLoading ? 'Loading metrics…' : 'No metrics available for this host.'}
              </Paper>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
                  gap: 2,
                }}
              >
                {/* Three charts, not the guest view's four: a host's
                    history carries root-filesystem usage where a guest
                    carries per-disk I/O, so a Disk I/O chart here would
                    read flat forever rather than say nothing. */}
                <TimeSeriesChart
                  title="CPU utilization"
                  times={times}
                  minYMax={10}
                  format={formatPercent}
                  series={[
                    { name: 'CPU', color: chart.series[0], values: metrics.map((m) => m.cpuPercent) },
                  ]}
                />
                <TimeSeriesChart
                  title={`Memory usage${maxMemory ? ` (of ${formatBytes(maxMemory)})` : ''}`}
                  times={times}
                  yMax={maxMemory || undefined}
                  format={formatBytes}
                  series={[
                    { name: 'Used', color: chart.series[0], values: metrics.map((m) => m.memoryBytes) },
                  ]}
                />
                <TimeSeriesChart
                  title="Network throughput"
                  times={times}
                  format={formatBytesPerSec}
                  series={[
                    { name: 'In', color: chart.series[0], values: metrics.map((m) => m.netInBytes) },
                    { name: 'Out', color: chart.series[1], values: metrics.map((m) => m.netOutBytes) },
                  ]}
                />
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
