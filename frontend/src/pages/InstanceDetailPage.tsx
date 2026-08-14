import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import TerminalIcon from '@mui/icons-material/Terminal'
import { api } from '../api/client'
import type { MetricTimeframe } from '../api/client'
import StatusIcon from '../components/StatusIcon'
import DetailTable, { DetailSection } from '../components/DetailTable'
import TimeSeriesChart from '../components/TimeSeriesChart'
import { chart } from '../chartPalette'
import { formatBytes, formatBytesPerSec, formatPercent, formatUptime } from '../format'
import BrandIcon from '../components/BrandIcon'
import { osBrand } from '../brands'
import { connectionFor } from '../connect'
import { sshUsername } from '../user'

type TabID = 'details' | 'observability' | 'os' | 'console'

const mediaLabels: Record<string, string> = {
  cdrom: 'CD-ROM',
  efi: 'EFI vars',
  tpm: 'TPM state',
  unused: 'Unused (detached)',
}

const mediaLabel = (media: string) => mediaLabels[media] ?? 'Disk'

/**
 * A deep link to the hypervisor's own console.
 *
 * The display and serial consoles aren't proxied here yet, and until
 * they are, linking out beats a disabled button: Proxmox opens the
 * same VM on the same node, one click away.
 */
function proxmoxConsoleURL(
  baseUrl: string,
  node: string,
  vmid: string,
  mode: 'novnc' | 'xtermjs',
): string {
  const params = new URLSearchParams({ console: 'kvm', vmid, node })
  params.set(mode, '1')
  return `${baseUrl.replace(/\/$/, '')}/?${params}`
}

export default function InstanceDetailPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabID>('details')
  const [timeframe, setTimeframe] = useState<MetricTimeframe>('hour')

  const { data: inst } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name!),
    enabled: Boolean(name),
    refetchInterval: 3000,
  })
  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const server = servers.find((s) => s.id === inst?.serverId)

  // Live hypervisor config — on demand, not on the list's poll interval.
  const { data: detail, error: detailError } = useQuery({
    queryKey: ['instanceDetail', name],
    queryFn: () => api.describeInstance(name!),
    enabled: Boolean(name),
    refetchInterval: 30000,
    retry: false,
  })

  const { data: metrics = [], isLoading: metricsLoading } = useQuery({
    queryKey: ['instanceMetrics', name, timeframe],
    queryFn: () => api.instanceMetrics(name!, timeframe),
    enabled: Boolean(name) && tab === 'observability',
    refetchInterval: 60000,
  })

  const { data: osInfo, isLoading: osLoading } = useQuery({
    queryKey: ['instanceOSInfo', name],
    queryFn: () => api.instanceOSInfo(name!),
    enabled: Boolean(name) && tab === 'os',
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['instance', name] })
    queryClient.invalidateQueries({ queryKey: ['instanceDetail', name] })
    queryClient.invalidateQueries({ queryKey: ['instances'] })
  }

  const action = useMutation({
    mutationFn: (act: 'start' | 'stop' | 'reset') => api.instanceAction(name!, act),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteInstance(name!),
    onSuccess: () => navigate('/compute/instances'),
    onError: (e: Error) => setError(e.message),
  })

  const protect = useMutation({
    mutationFn: (flag: boolean) => api.setInstanceProtection(name!, flag),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  if (!inst) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading instance…</Typography>
      </Box>
    )
  }

  const times = metrics.map((m) => m.time)
  const maxMemory = metrics.reduce((max, m) => Math.max(max, m.maxMemoryBytes), 0)

  // Console access. A stopped VM has no display to attach to, and the
  // serial console only exists if the VM was given a serial port —
  // which is the usual reason it doesn't work, so say so rather than
  // offering a button that opens a dead terminal.
  const running = inst.status === 'RUNNING'
  const serialPort = detail?.devices?.find((d) => d.kind === 'Serial port')
  const hypervisorURL = server?.type === 'proxmox' ? server.baseUrl : ''
  const connection = connectionFor(inst.osType, inst.internalIp, inst.name)
  const hypervisorLink = (mode: 'novnc' | 'xtermjs') => (
    <Button
      size="small"
      endIcon={<OpenInNewIcon />}
      component="a"
      target="_blank"
      rel="noreferrer"
      href={proxmoxConsoleURL(hypervisorURL, inst.zone, inst.driverId, mode)}
    >
      Open in Proxmox
    </Button>
  )

  const consoleOptions: {
    name: string
    availability: string
    ready: boolean
    action?: ReactNode
  }[] = [
    {
      name: 'Display (VNC)',
      availability: !running
        ? 'Instance is not running'
        : !hypervisorURL
          ? 'This hypervisor has no console URL'
          : detail?.display || 'Default adapter',
      ready: running && Boolean(hypervisorURL),
      action: hypervisorLink('novnc'),
    },
    {
      name: 'Serial',
      availability: !serialPort
        ? 'No serial port configured on this instance'
        : !running
          ? 'Instance is not running'
          : `${serialPort.key} — ${serialPort.value}`,
      ready: running && Boolean(serialPort) && Boolean(hypervisorURL),
      action: hypervisorLink('xtermjs'),
    },
    {
      name: connection?.kind === 'RDP' ? 'Remote Desktop' : 'SSH',
      availability: !connection
        ? 'No address known for this instance'
        : connection.kind === 'RDP'
          ? `${inst.internalIp}:${connection.port} — opens your own client`
          : `${sshUsername()}@${inst.internalIp} — proxied by this console`,
      ready: Boolean(connection),
      action:
        connection?.kind === 'RDP' ? (
          <Button size="small" endIcon={<OpenInNewIcon />} component="a" href={connection.href}>
            Open Remote Desktop
          </Button>
        ) : (
          <Button
            size="small"
            endIcon={<TerminalIcon />}
            onClick={() =>
              window.open(
                connection!.href,
                `ssh-${inst.name}`,
                'width=1024,height=640,menubar=no,toolbar=no,location=no,status=no',
              )
            }
          >
            Open terminal
          </Button>
        ),
    },
  ]

  return (
    <Box sx={{ pb: 4 }}>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 3,
          py: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/compute/instances')}>
          VM instances
        </Button>
        <StatusIcon status={inst.status} />
        <Typography variant="h5">{inst.name}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<PlayArrowIcon />}
          disabled={inst.status !== 'TERMINATED' || action.isPending}
          onClick={() => action.mutate('start')}
        >
          Start
        </Button>
        <Button
          size="small"
          startIcon={<StopIcon />}
          disabled={inst.status !== 'RUNNING' || action.isPending}
          onClick={() => action.mutate('stop')}
        >
          Stop
        </Button>
        <Button
          size="small"
          startIcon={<RestartAltIcon />}
          disabled={inst.status !== 'RUNNING' || action.isPending}
          onClick={() => action.mutate('reset')}
        >
          Reset
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          disabled={remove.isPending || inst.protected}
          onClick={() => remove.mutate()}
        >
          Delete
        </Button>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ px: 3, borderBottom: '1px solid #dadce0', minHeight: 44 }}
      >
        <Tab label="Details" value="details" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Observability" value="observability" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="OS Info" value="os" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Console" value="console" sx={{ textTransform: 'none', minHeight: 44 }} />
      </Tabs>

      <Box sx={{ p: 3, maxWidth: 1100 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {tab === 'details' && (
          <>
            {detailError && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Couldn't read live configuration from the hypervisor; showing stored
                metadata only.
              </Alert>
            )}

            <DetailSection title="Basic information">
              <DetailTable
                rows={[
                  { label: 'Name', value: inst.name },
                  { label: 'Instance ID', value: inst.driverId || '—' },
                  { label: 'Description', value: detail?.description || inst.description || 'None' },
                  { label: 'Type', value: 'Virtual machine' },
                  { label: 'Status', value: inst.status },
                  {
                    label: 'Creation time',
                    value: detail?.createdAt
                      ? new Date(detail.createdAt * 1000).toLocaleString()
                      : new Date(inst.createdAt).toLocaleString(),
                  },
                  { label: 'Uptime', value: formatUptime(detail?.uptimeSeconds ?? 0) },
                  { label: 'Location', value: `${inst.zone} (${server?.name ?? 'unknown server'})` },
                  { label: 'Boot image', value: inst.imageId || '—' },
                  {
                    label: 'Tags',
                    value: detail?.tags?.length ? (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {detail.tags.map((t) => (
                          <Chip key={t} label={t} size="small" sx={{ fontSize: 11, height: 20 }} />
                        ))}
                      </Box>
                    ) : (
                      '—'
                    ),
                  },
                  {
                    label: 'Deletion protection',
                    value: (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {inst.protected ? 'Enabled' : 'Disabled'}
                        <Button
                          size="small"
                          disabled={protect.isPending}
                          onClick={() => protect.mutate(!inst.protected)}
                        >
                          {inst.protected ? 'Disable' : 'Enable'}
                        </Button>
                      </Box>
                    ),
                  },
                  {
                    label: 'Hypervisor protection flag',
                    value: detail?.hostProtected ? 'Enabled' : 'Disabled',
                  },
                  { label: 'Start on boot', value: detail?.onBoot ? 'On' : 'Off' },
                  { label: 'Guest agent', value: detail?.guestAgent ? 'Enabled' : 'Disabled' },
                ]}
              />
            </DetailSection>

            <DetailSection title="Machine configuration">
              <DetailTable
                rows={[
                  {
                    label: 'Machine type',
                    value: `${inst.machineType || 'custom'} (${inst.cpus} vCPU, ${inst.memoryMb} MB memory)`,
                  },
                  {
                    label: 'vCPUs',
                    value: detail?.sockets
                      ? `${inst.cpus} (${detail.sockets} socket${detail.sockets > 1 ? 's' : ''})`
                      : inst.cpus,
                  },
                  { label: 'Memory', value: `${inst.memoryMb} MB` },
                  { label: 'CPU platform', value: detail?.cpuType || '—' },
                  { label: 'Architecture', value: detail?.architecture || '—' },
                  { label: 'Guest OS type', value: detail?.osType || '—' },
                  { label: 'BIOS', value: detail?.bios || '—' },
                  { label: 'Chipset', value: detail?.machineType || '—' },
                  { label: 'Display', value: detail?.display || '—' },
                  { label: 'SCSI controller', value: detail?.scsiController || '—' },
                  { label: 'Boot order', value: detail?.bootOrder || '—' },
                ]}
              />
            </DetailSection>

            {/* Repeatable hardware: serial ports, USB, PCI passthrough, … */}
            {detail?.devices?.length ? (
              <DetailSection title="Hardware devices">
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Device</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Configuration</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.devices.map((device) => (
                        <TableRow key={device.key} hover>
                          <TableCell>{device.key}</TableCell>
                          <TableCell>{device.kind}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {device.value}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </DetailSection>
            ) : null}

            <DetailSection title="Networking">
              <DetailTable
                rows={[
                  { label: 'Internal IP', value: inst.internalIp || '—' },
                  { label: 'External IP', value: inst.externalIp || '—' },
                ]}
              />
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ color: '#5f6368', mb: 1 }}>
                  Network interfaces
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Model</TableCell>
                        <TableCell>Bridge</TableCell>
                        <TableCell>VLAN</TableCell>
                        <TableCell>MAC address</TableCell>
                        <TableCell>Firewall</TableCell>
                        <TableCell>IP address</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(detail?.nics ?? []).map((nic) => (
                        <TableRow key={nic.name} hover>
                          <TableCell>{nic.name}</TableCell>
                          <TableCell>{nic.model || '—'}</TableCell>
                          <TableCell>{nic.bridge || '—'}</TableCell>
                          <TableCell>{nic.vlanTag || '—'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {nic.mac || '—'}
                          </TableCell>
                          <TableCell>{nic.firewall ? 'On' : 'Off'}</TableCell>
                          <TableCell>{nic.ipAddress || '—'}</TableCell>
                        </TableRow>
                      ))}
                      {!detail?.nics?.length && (
                        <TableRow>
                          <TableCell colSpan={7} align="center" sx={{ py: 4, color: '#5f6368' }}>
                            No network interfaces reported.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </DetailSection>

            <DetailSection title="Storage">
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Interface</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Datastore</TableCell>
                      <TableCell align="right">Size</TableCell>
                      <TableCell>Media</TableCell>
                      <TableCell>Options</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detail?.disks ?? []).map((disk) => (
                      <TableRow key={disk.interface} hover>
                        <TableCell>{disk.interface}</TableCell>
                        <TableCell>{disk.name}</TableCell>
                        <TableCell>{disk.storage || '—'}</TableCell>
                        <TableCell align="right">{formatBytes(disk.sizeBytes)}</TableCell>
                        <TableCell>{mediaLabel(disk.media)}</TableCell>
                        <TableCell sx={{ color: '#5f6368', fontSize: 12 }}>
                          {[disk.ssd && 'SSD emulation', disk.discard && 'discard']
                            .filter(Boolean)
                            .join(', ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!detail?.disks?.length && (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 4, color: '#5f6368' }}>
                          No disks reported.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </DetailSection>

            <DetailSection title="Security and access">
              <DetailTable
                rows={[
                  { label: 'Cloud-init user', value: detail?.cloudInitUser || '—' },
                  { label: 'IP configuration', value: detail?.ipConfig || 'image default' },
                  { label: 'Nameservers', value: detail?.nameservers || 'host default' },
                  { label: 'Search domain', value: detail?.searchDomain || 'host default' },
                  {
                    label: 'Upgrade packages on boot',
                    value: detail?.upgradePackages ? 'Yes' : 'No',
                  },
                  { label: 'Datasource format', value: detail?.datasource || 'default' },
                  {
                    label: 'SSH keys',
                    value: detail?.sshKeys?.length ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {detail.sshKeys.map((key, i) => (
                          <Box
                            key={i}
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: 11,
                              color: '#5f6368',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 620,
                            }}
                            title={key}
                          >
                            {key}
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      'None'
                    ),
                  },
                ]}
              />
            </DetailSection>

            <DetailSection title="Backend">
              <DetailTable
                rows={[
                  {
                    label: 'Server',
                    value: server ? `${server.name} (${server.type})` : inst.serverId,
                  },
                  { label: 'Driver instance ID', value: inst.driverId },
                ]}
              />
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
                Sampled by the hypervisor; gaps mean the instance was off.
              </Typography>
            </Box>

            {metrics.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 6, textAlign: 'center', color: '#5f6368' }}>
                {metricsLoading ? 'Loading metrics…' : 'No metrics available for this instance.'}
              </Paper>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
                  gap: 2,
                }}
              >
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
                <TimeSeriesChart
                  title="Disk I/O"
                  times={times}
                  format={formatBytesPerSec}
                  series={[
                    { name: 'Read', color: chart.series[0], values: metrics.map((m) => m.diskReadBytes) },
                    { name: 'Write', color: chart.series[1], values: metrics.map((m) => m.diskWriteBytes) },
                  ]}
                />
              </Box>
            )}
          </>
        )}

        {tab === 'os' && (
          <>
            {osLoading && <Typography color="text.secondary">Loading OS info…</Typography>}
            {osInfo && !osInfo.available && (
              <Alert severity="info" sx={{ mb: 2 }}>
                No guest agent is responding on this instance. Install and enable the
                QEMU guest agent in the guest to report OS details here.
              </Alert>
            )}
            {osInfo && (
              <DetailSection title="Operating system">
                <DetailTable
                  rows={[
                    { label: 'Hostname', value: osInfo.hostname || '—' },
                    {
                      label: 'OS name',
                      value: (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {osBrand(osInfo.name) && (
                            <BrandIcon icon={osBrand(osInfo.name)!} size={18} />
                          )}
                          {osInfo.name || '—'}
                        </Box>
                      ),
                    },
                    { label: 'Version', value: osInfo.version || '—' },
                    { label: 'Kernel release', value: osInfo.kernelRelease || '—' },
                    { label: 'Kernel version', value: osInfo.kernelVersion || '—' },
                    { label: 'Machine', value: osInfo.machine || '—' },
                    { label: 'Configured guest type', value: osInfo.osType || '—' },
                  ]}
                />
              </DetailSection>
            )}
          </>
        )}

        {tab === 'console' && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              The display and serial consoles still open on the hypervisor. Proxying
              them through this app — the way the SSH terminal already is — is the
              next step.
            </Alert>

            <DetailSection title="Console access">
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Console</TableCell>
                      <TableCell>Availability</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {consoleOptions.map((option) => (
                      <TableRow key={option.name} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{option.name}</TableCell>
                        <TableCell sx={{ color: option.ready ? '#202124' : '#5f6368' }}>
                          {option.availability}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {option.ready && option.action}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </DetailSection>
          </>
        )}
      </Box>
    </Box>
  )
}
