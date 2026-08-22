import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { api } from '../api/client'
import type { AttachedDisk, Backup, MetricTimeframe, Snapshot } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import AddIcon from '@mui/icons-material/Add'
import StatusIcon, { statusLabel } from '../components/StatusIcon'
import DetailTable, { DetailSection } from '../components/DetailTable'
import TimeSeriesChart from '../components/TimeSeriesChart'
import { chart } from '../chartPalette'
import { formatBytes, formatBytesPerSec, formatPercent, formatUptime, timeAgo } from '../format'
import { OSIcon } from '../components/OSName'
import ConnectButton from '../components/ConnectButton'
import GuestInventory from '../components/GuestInventory'
import { usePermissions } from '../user'
import { realSerial } from '../serial'

type TabID = 'details' | 'observability' | 'os' | 'backups' | 'console'

const mediaLabels: Record<string, string> = {
  cdrom: 'CD-ROM',
  efi: 'EFI vars',
  tpm: 'TPM state',
  unused: 'Unused (detached)',
}

const mediaLabel = (media: string) => mediaLabels[media] ?? 'Disk'

// A value the hypervisor doesn't carry, said in words. A confident
// fallback ("image default") states a fact about the guest; this
// states what was read, which is nothing.
const unset = (text: string) => (
  <Box component="span" sx={{ color: 'text.secondary' }}>
    {text}
  </Box>
)

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
  const { name = '' } = useParams<{ name: string }>()
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tab, setTab] = useState<TabID>('details')
  const [deletingBackup, setDeletingBackup] = useState<Backup | null>(null)
  // Detaching keeps the volume, so it asks once and doesn't make you
  // type anything — the rule is that a dialog's weight matches how hard
  // the thing is to undo, and this one is a click to undo.
  const [detaching, setDetaching] = useState<AttachedDisk | null>(null)
  // Deleting a volume and rolling back both lose something for good, so
  // both make you type the name. Detaching and deleting a snapshot don't.
  const [deletingDisk, setDeletingDisk] = useState<AttachedDisk | null>(null)
  const [rollingBack, setRollingBack] = useState<Snapshot | null>(null)
  const [deletingSnapshot, setDeletingSnapshot] = useState<Snapshot | null>(null)

  // Filtered from the catalogue rather than through a new endpoint: the
  // list already carries which guest each snapshot belongs to, and one
  // more instance-scoped route would be a second way to ask the same
  // question.
  const { data: allSnapshots = [] } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.listSnapshots,
    enabled: Boolean(name),
  })
  const snapshots = allSnapshots.filter((snap) => snap.vmName === name)

  const refreshDetail = () =>
    queryClient.invalidateQueries({ queryKey: ['instanceDetail', name] })
  const attachDisk = useMutation({
    mutationFn: (disk: string) => api.attachInstanceDisk(name, disk),
    onSuccess: refreshDetail,
    onError: (e: Error) => setError(e.message),
  })
  const deleteDisk = useMutation({
    mutationFn: (disk: string) => api.deleteInstanceDisk(name, disk),
    onSuccess: () => {
      setDeletingDisk(null)
      void refreshDetail()
    },
    onError: (e: Error) => {
      setDeletingDisk(null)
      setError(e.message)
    },
  })
  // Rolling back and deleting a snapshot are operations, so what the
  // page does immediately is start the bell turning; the snapshot list
  // and the detail refresh from there when the work lands.
  const refreshOperations = () => queryClient.invalidateQueries({ queryKey: ['operations'] })
  const rollback = useMutation({
    mutationFn: (snapshot: string) => api.rollbackInstanceSnapshot(name, snapshot),
    onSuccess: () => {
      setRollingBack(null)
      void refreshOperations()
    },
    onError: (e: Error) => {
      setRollingBack(null)
      setError(e.message)
    },
  })
  const removeSnapshot = useMutation({
    mutationFn: (snapshot: string) => api.deleteInstanceSnapshot(name, snapshot),
    onSuccess: () => {
      setDeletingSnapshot(null)
      void refreshOperations()
    },
    onError: (e: Error) => {
      setDeletingSnapshot(null)
      setError(e.message)
    },
  })
  const detachDisk = useMutation({
    mutationFn: (disk: string) => api.detachInstanceDisk(name, disk),
    onSuccess: () => {
      setDetaching(null)
      void refreshDetail()
    },
    onError: (e: Error) => {
      setDetaching(null)
      setError(e.message)
    },
  })
  const [timeframe, setTimeframe] = useState<MetricTimeframe>('hour')

  const { data: inst } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name!),
    enabled: Boolean(name),
    refetchInterval: 3000,
  })
  const { data: hypervisors = [] } = useQuery({ queryKey: ['hypervisors'], queryFn: api.listHypervisors })
  const hypervisor = hypervisors.find((s) => s.id === inst?.hypervisorId)

  // Live hypervisor config — on demand, not on the list's poll interval.
  const { data: detail, error: detailError } = useQuery({
    queryKey: ['instanceDetail', name],
    queryFn: () => api.describeInstance(name!),
    enabled: Boolean(name),
    refetchInterval: 30000,
    retry: false,
  })

  // The first real disk is the one the guest boots from, which the
  // driver refuses to detach. Deciding not to OFFER it is this side's
  // job; the refusal is still the driver's.
  const bootDiskInterface = detail?.disks?.find((d) => d.media === 'disk')?.interface

  const { data: metrics = [], isLoading: metricsLoading } = useQuery({
    queryKey: ['instanceMetrics', name, timeframe],
    queryFn: () => api.instanceMetrics(name!, timeframe),
    enabled: Boolean(name) && tab === 'observability',
    refetchInterval: 60000,
  })

  // Someone else's catalog, changed by their backup job rather than by
  // this page — so it's read when the tab is opened and never polled.
  const { data: backups, isLoading: backupsLoading } = useQuery({
    queryKey: ['instanceBackups', name],
    queryFn: () => api.instanceBackups(name!),
    enabled: Boolean(name) && tab === 'backups',
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

  // A power action starts an operation, so the bell should turn now
  // rather than at the end of its next three-second poll.
  const started = () => {
    invalidate()
    queryClient.invalidateQueries({ queryKey: ['operations'] })
  }

  const action = useMutation({
    mutationFn: (act: 'start' | 'stop' | 'reset') => api.instanceAction(name!, act),
    onSuccess: started,
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteInstance(name!),
    onSuccess: () => navigate('/compute/instances'),
    onError: (e: Error) => {
      setDeleting(false)
      setError(e.message)
    },
  })

  const removeBackup = useMutation({
    mutationFn: (backup: Backup) =>
      api.deleteBackup(backup.hypervisorId, backup.node, backup.id),
    onSuccess: () => {
      // The hypervisor deletes on a task, so the archive lingers for a
      // moment; this tab is read on demand, so re-read it.
      queryClient.invalidateQueries({ queryKey: ['instanceBackups', name] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setDeletingBackup(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setDeletingBackup(null)
    },
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
  // Powered on covers the moment between Start and RUNNING as well:
  // deleting a VM that is mid-boot is the same mistake.
  const poweredOn = running || inst.status === 'STAGING'
  const serialPort = detail?.devices?.find((d) => d.kind === 'Serial port')
  const hypervisorURL = hypervisor?.type === 'proxmox' ? hypervisor.baseUrl : ''
  const hypervisorLink = (mode: 'novnc' | 'xtermjs') => (
    <Button
      size="small"
      endIcon={<OpenInNewIcon />}
      component="a"
      target="_blank"
      rel="noreferrer"
      href={proxmoxConsoleURL(hypervisorURL, inst.node, inst.driverId, mode)}
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
          Virtual machines
        </Button>
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
        {/* A powered-on VM can't be deleted out from under whoever is
            using it; the backend refuses too, so this only saves the
            round trip and says why. */}
        <Tooltip
          title={
            inst.protected
              ? 'Deletion protection is enabled'
              : poweredOn
                ? 'Stop the instance before deleting it'
                : ''
          }
        >
          <span>
            <Button
              size="small"
              color="error"
              startIcon={<DeleteIcon />}
              disabled={remove.isPending || inst.protected || poweredOn}
              onClick={() => setDeleting(true)}
            >
              Delete
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ px: 3, borderBottom: '1px solid #dadce0', minHeight: 44 }}
      >
        <Tab label="Details" value="details" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Observability" value="observability" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="OS Info" value="os" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Backups" value="backups" sx={{ textTransform: 'none', minHeight: 44 }} />
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

            {/* The way in comes before the facts about it, GCP-style. */}
            <Box sx={{ mb: 3 }}>
              <ConnectButton instance={inst} variant="outlined" />
            </Box>

            <DetailSection title="Basic information">
              <DetailTable
                rows={[
                  {
                    label: 'Name',
                    // Beside the value it changes, like Description.
                    value: (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {inst.name}
                        {canEdit && (
                          <Tooltip title="Rename">
                            <IconButton
                              size="small"
                              onClick={() => navigate(`/compute/instances/${inst.name}/rename`)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    ),
                  },
                  { label: 'Instance ID', value: inst.driverId || '—' },
                  {
                    label: 'Description',
                    // Inline pencil, the same shape as the name above:
                    // the action belongs beside the value it changes,
                    // and the form itself gets its own page.
                    value: (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box component="span" sx={{ whiteSpace: 'pre-wrap' }}>
                          {detail?.description || inst.description || 'None'}
                        </Box>
                        {canEdit && (
                          <Tooltip title="Edit description">
                            <IconButton
                              size="small"
                              onClick={() =>
                                navigate(`/compute/instances/${inst.name}/description`)
                              }
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    ),
                  },
                  { label: 'Type', value: 'Virtual machine' },
                  {
                    label: 'Status',
                    value: (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                        <StatusIcon status={inst.status} />
                        {statusLabel(inst.status)}
                      </Box>
                    ),
                  },
                  {
                    // The store's own timestamp, NOT the hypervisor's.
                    // Proxmox's only per-guest timestamp is the ctime in
                    // its config, and a clone copies the config — so it
                    // reports the template's build date for every VM
                    // this console creates. A ten-minute-old guest read
                    // as three days old, which is worse than reading as
                    // unknown because it looks like an answer.
                    label: 'Creation time',
                    value: new Date(inst.createdAt).toLocaleString(),
                  },
                  { label: 'Uptime', value: formatUptime(detail?.uptimeSeconds ?? 0) },
                  { label: 'Location', value: `${inst.node} (${hypervisor?.name ?? 'unknown hypervisor'})` },
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

            <DetailSection
              title="Machine configuration"
              action={
                canEdit && (
                  <Button
                    size="small"
                    component={RouterLink}
                    to={`/compute/instances/${encodeURIComponent(name)}/resize`}
                  >
                    Resize
                  </Button>
                )
              }
            >
              <DetailTable
                rows={[
                  {
                    label: 'Size',
                    value: `${inst.cpus} vCPU, ${inst.memoryMb} MB memory`,
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
                  {
                    label: 'Serial number',
                    // Blank is the normal state, and "—" would read as
                    // "we didn't look". Inventory tools key on this, so
                    // say what its absence costs.
                    value: realSerial(inst.serial || detail?.serial) ? (
                      <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {realSerial(inst.serial || detail?.serial)}
                      </Box>
                    ) : (
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        Not set on the hypervisor
                      </Box>
                    ),
                  },
                  {
                    label: 'System UUID',
                    // The stored copy first: it's there for every
                    // instance, while the live read can be a moment
                    // behind on a page opened during creation.
                    value: (
                      <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {inst.uuid || detail?.uuid || '—'}
                      </Box>
                    ),
                  },
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
                  { label: 'IP address', value: inst.internalIp || '—' },
                ]}
              />
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
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
                          <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                            No network interfaces reported.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </DetailSection>

            <DetailSection
              title="Storage"
              action={
                canEdit && (
                  <Button
                    size="small"
                    startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                    component={RouterLink}
                    to={`/compute/instances/${encodeURIComponent(name)}/disks/add`}
                  >
                    Add disk
                  </Button>
                )
              }
            >
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
                      <TableCell align="right" sx={{ width: 190 }} />
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
                        <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                          {[disk.ssd && 'SSD emulation', disk.discard && 'discard']
                            .filter(Boolean)
                            .join(', ') || '—'}
                        </TableCell>
                        <TableCell align="right">
                          {/* An unused volume is a disk this guest still
                              owns but can't see. The only thing worth
                              offering it is a way back in. */}
                          {canEdit && disk.media === 'unused' && (
                            <>
                              <Button
                                size="small"
                                disabled={attachDisk.isPending}
                                onClick={() => attachDisk.mutate(disk.interface)}
                              >
                                Attach
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                onClick={() => setDeletingDisk(disk)}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                          {canEdit && disk.media === 'disk' && (
                            <>
                              <Button
                                size="small"
                                component={RouterLink}
                                to={`/compute/instances/${encodeURIComponent(name)}/disks/${encodeURIComponent(disk.interface)}/resize`}
                              >
                                Resize
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                disabled={disk.interface === bootDiskInterface}
                                title={
                                  disk.interface === bootDiskInterface
                                    ? 'The boot disk stays attached'
                                    : undefined
                                }
                                onClick={() => setDetaching(disk)}
                              >
                                Detach
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!detail?.disks?.length && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          No disks reported.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </DetailSection>

            <DetailSection
              title="Snapshots"
              action={
                canEdit && (
                  <Button
                    size="small"
                    startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                    component={RouterLink}
                    to={`/compute/instances/${encodeURIComponent(name)}/snapshots/new`}
                  >
                    Take snapshot
                  </Button>
                )
              }
            >
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell>Taken</TableCell>
                      <TableCell>Memory</TableCell>
                      <TableCell align="right" sx={{ width: 190 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {snapshots.map((snap) => (
                      <TableRow key={snap.id} hover>
                        <TableCell>{snap.name}</TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>
                          {snap.description || '—'}
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>
                          {snap.createdAt ? timeAgo(snap.createdAt) : '—'}
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>
                          {snap.includesRam ? 'Included' : 'Disks only'}
                        </TableCell>
                        <TableCell align="right">
                          {canEdit && (
                            <>
                              <Button size="small" onClick={() => setRollingBack(snap)}>
                                Roll back
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                onClick={() => setDeletingSnapshot(snap)}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {snapshots.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          No snapshots.
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
                  // A guest with no cloud-init drive never reads any of
                  // this. Proxmox still answers with its defaults, and
                  // printing those would describe a machine that isn't
                  // there — so the absence is the whole answer.
                  ...(detail && !detail.cloudInit
                    ? [
                        {
                          label: 'Cloud-init',
                          value: unset(
                            'No cloud-init drive on this instance — these settings would not be read',
                          ),
                        },
                      ]
                    : [
                        // Proxmox omits a key left at its default, so
                        // an empty value is a real answer — but it's
                        // the hypervisor's default, not ours to
                        // invent. Each row says whose default fills it.
                        {
                          label: 'Cloud-init user',
                          value:
                            detail?.cloudInitUser || unset('Not set — the image decides'),
                        },
                        {
                          label: 'IP configuration',
                          value:
                            detail?.ipConfig ||
                            unset('Not set — the image decides, usually DHCP'),
                        },
                        {
                          label: 'Nameservers',
                          value:
                            detail?.nameservers ||
                            unset("Not set — the Proxmox host's own resolvers"),
                        },
                        {
                          label: 'Search domain',
                          value:
                            detail?.searchDomain ||
                            unset("Not set — the Proxmox host's own"),
                        },
                        {
                          label: 'Upgrade packages on boot',
                          value: detail?.upgradePackages ? 'Yes' : 'No',
                        },
                        { label: 'Datasource format', value: detail?.datasource || '—' },
                      ]),
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
                              color: 'text.secondary',
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
                    label: 'Hypervisor',
                    value: hypervisor ? `${hypervisor.name} (${hypervisor.type})` : inst.hypervisorId,
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
              <Paper variant="outlined" sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
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

        {tab === 'backups' && (
          <>
            {backupsLoading && (
              <Typography color="text.secondary">Loading backups…</Typography>
            )}
            {backups?.error && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {backups.error}
              </Alert>
            )}
            {backups && !backups.supported && (
              <Alert severity="info" sx={{ mb: 2 }}>
                This hypervisor keeps no backup catalog.
              </Alert>
            )}
            {/* Never backed up is a finding about the guest, not an
                empty table — the hypervisor's job either covers this
                one or it doesn't. */}
            {backups?.supported && !backups.error && backups.backups.length === 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                No backups exist for this instance.
              </Alert>
            )}
            {backups && backups.stale && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                The newest backup is more than {backups.staleAfterDays} days old.
              </Alert>
            )}
            {backups && backups.backups.length > 0 && (
              <DetailSection
                title={`${backups.backups.length} backup${
                  backups.backups.length === 1 ? '' : 's'
                }`}
              >
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Created</TableCell>
                        <TableCell>Datastore</TableCell>
                        <TableCell align="right">Size</TableCell>
                        <TableCell>Format</TableCell>
                        <TableCell>Archive</TableCell>
                        <TableCell align="right" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {backups.backups.map((backup) => (
                        <TableRow key={backup.id} hover>
                          <TableCell>
                            {backup.createdAt
                              ? new Date(backup.createdAt * 1000).toLocaleString()
                              : '—'}
                          </TableCell>
                          <TableCell>{backup.storage}</TableCell>
                          <TableCell align="right">
                            {formatBytes(backup.sizeBytes)}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            {backup.format || '—'}
                          </TableCell>
                          <TableCell
                            sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}
                          >
                            {backup.name}
                          </TableCell>
                          <TableCell align="right">
                            {canEdit && (
                              <Tooltip
                                title={
                                  backup.protected
                                    ? 'Protected on the hypervisor'
                                    : 'Delete this restore point'
                                }
                              >
                                <span>
                                  <IconButton
                                    size="small"
                                    disabled={backup.protected}
                                    onClick={() => setDeletingBackup(backup)}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </DetailSection>
            )}
          </>
        )}

        {tab === 'os' && (
          <>
            {osLoading && <Typography color="text.secondary">Loading OS info…</Typography>}
            {osInfo && !osInfo.available && (
              <Alert severity="info" sx={{ mb: 2 }}>
                No guest agent is responding. OS details need the QEMU guest agent
                installed and running in the guest.
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
                          <OSIcon name={osInfo.name} size={18} />
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

            {/* Below the guest agent's own report: what an inventory
                service found inside the machine. Different source,
                different collection time, so it says both. */}
            <GuestInventory instance={inst.name} />
          </>
        )}

        {tab === 'console' && (
          <>
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

      <ConfirmDeleteDialog
        open={deleting}
        title={`Delete ${inst.name}?`}
        body={
          <>
            This destroys the virtual machine and its disks. Snapshots and backups
            taken of it are not removed, but nothing else brings it back.
          </>
        }
        confirmPhrase={inst.name}
        confirmLabel="to delete it"
        pending={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />

      <ConfirmDeleteDialog
        open={Boolean(deletingDisk)}
        title={`Delete ${deletingDisk?.name}?`}
        body={
          <>
            This destroys the volume and everything on it. Nothing is attached to
            it, so nothing will report it missing.
          </>
        }
        confirmPhrase={deletingDisk?.name}
        confirmLabel="the volume name"
        pending={deleteDisk.isPending}
        onCancel={() => setDeletingDisk(null)}
        onConfirm={() => deletingDisk && deleteDisk.mutate(deletingDisk.interface)}
      />

      <ConfirmDeleteDialog
        open={Boolean(rollingBack)}
        title={`Roll ${name} back to ${rollingBack?.name}?`}
        body={
          <>
            Everything written since that snapshot is discarded. The snapshot itself
            is kept.
            {rollingBack && !rollingBack.includesRam && (
              <> That snapshot holds disks only, so the guest comes back powered off.</>
            )}
          </>
        }
        confirmPhrase={rollingBack?.name}
        confirmLabel="the snapshot name"
        actionLabel="Roll back"
        pending={rollback.isPending}
        onCancel={() => setRollingBack(null)}
        onConfirm={() => rollingBack && rollback.mutate(rollingBack.name)}
      />

      <ConfirmDeleteDialog
        open={Boolean(deletingSnapshot)}
        title={`Delete snapshot ${deletingSnapshot?.name}?`}
        body={
          <>
            The restore point goes; {name} itself is untouched and keeps running
            exactly as it is.
          </>
        }
        pending={removeSnapshot.isPending}
        onCancel={() => setDeletingSnapshot(null)}
        onConfirm={() => deletingSnapshot && removeSnapshot.mutate(deletingSnapshot.name)}
      />

      <ConfirmDeleteDialog
        open={Boolean(detaching)}
        title={`Detach ${detaching?.interface} from ${name}?`}
        body={
          <>
            The disk stays on the hypervisor as an unused volume and can be
            attached again. Nothing on it is erased.
            {inst?.status === 'RUNNING' && (
              <> This instance is running; unmount the disk inside it first.</>
            )}
          </>
        }
        actionLabel="Detach"
        pending={detachDisk.isPending}
        onCancel={() => setDetaching(null)}
        onConfirm={() => detaching && detachDisk.mutate(detaching.interface)}
      />

      <ConfirmDeleteDialog
        open={Boolean(deletingBackup)}
        title={`Delete this backup of ${inst.name}?`}
        body={`${deletingBackup?.name} — ${formatBytes(
          deletingBackup?.sizeBytes ?? 0,
        )} taken ${
          deletingBackup?.createdAt
            ? new Date(deletingBackup.createdAt * 1000).toLocaleString()
            : 'at an unknown time'
        }. Deleting the archive doesn't touch the guest, but this restore point is gone.`}
        confirmPhrase="I UNDERSTAND"
        confirmLabel="to delete this restore point"
        pending={removeBackup.isPending}
        onCancel={() => setDeletingBackup(null)}
        onConfirm={() => deletingBackup && removeBackup.mutate(deletingBackup)}
      />
    </Box>
  )
}
