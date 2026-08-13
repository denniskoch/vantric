import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CircleIcon from '@mui/icons-material/Circle'
import ErrorIcon from '@mui/icons-material/Error'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { api } from '../api/client'
import { formatBytes } from '../format'

type SectionID = 'image' | 'template' | 'cloudinit' | 'hardware'

const nameRe = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/

export default function BuildTemplatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [section, setSection] = useState<SectionID>('image')
  const [error, setError] = useState<string | null>(null)

  // Source image
  const [serverId, setServerId] = useState('')
  const [sourceVolume, setSourceVolume] = useState('')
  // Template
  const [name, setName] = useState('')
  const [diskStorage, setDiskStorage] = useState('')
  const [diskGb, setDiskGb] = useState(20)
  const [cpus, setCpus] = useState(2)
  const [memoryMb, setMemoryMb] = useState(2048)
  // Cloud-init
  const [cloudInitUser, setCloudInitUser] = useState('')
  const [sshKeys, setSshKeys] = useState('')
  const [ipConfig, setIpConfig] = useState('dhcp')
  // Hardware
  const [bios, setBios] = useState('seabios')
  const [machineType, setMachineType] = useState('q35')
  const [netBridge, setNetBridge] = useState('')
  const [vlanTag, setVlanTag] = useState(0)
  const [enableAgent, setEnableAgent] = useState(true)

  const [buildId, setBuildId] = useState<string | null>(null)

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: cloudImages = [] } = useQuery({
    queryKey: ['cloudImages'],
    queryFn: api.listCloudImages,
  })
  const { data: datastores = [] } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
  })
  const { data: bridges = [] } = useQuery({ queryKey: ['bridges'], queryFn: api.listBridges })

  const connected = servers.filter((s) => s.status === 'connected')
  if (!serverId && connected.length > 0) setServerId(connected[0].id)

  const images = cloudImages.filter((i) => i.serverId === serverId)
  const image = images.find((i) => i.id === sourceVolume)
  // Disk storage must accept VM images and live on the image's node.
  // Bridges live on the image's node.
  const zoneBridges = bridges.filter(
    (b) => b.serverId === serverId && (!image || b.zone === image.zone),
  )
  const bridge = zoneBridges.find((b) => b.name === netBridge)
  const diskTargets = datastores.filter(
    (d) =>
      d.serverId === serverId &&
      d.active &&
      d.content.includes('images') &&
      (!image || d.zone === image.zone),
  )

  const { data: build } = useQuery({
    queryKey: ['templateBuild', buildId],
    queryFn: () => api.getTemplateBuild(buildId!),
    enabled: Boolean(buildId),
    refetchInterval: (query) => (query.state.data?.running === false ? false : 2000),
  })

  const start = useMutation({
    mutationFn: () =>
      api.buildTemplate(serverId, {
        name,
        zone: image!.zone,
        sourceVolume,
        diskStorage,
        diskGb,
        cpus,
        memoryMb,
        netBridge: netBridge || undefined,
        vlanTag: vlanTag || undefined,
        cloudInitUser: cloudInitUser || undefined,
        sshKeys: sshKeys || undefined,
        ipConfig: ipConfig || undefined,
        bios,
        machineType,
        enableAgent,
        description: `Cloud template built from ${image?.name ?? sourceVolume}`,
      }),
    onSuccess: (b) => setBuildId(b.id),
    onError: (e: Error) => setError(e.message),
  })

  const imageValid = Boolean(image)
  const templateValid = nameRe.test(name) && Boolean(diskStorage) && cpus >= 1 && memoryMb >= 128
  const valid = imageValid && templateValid

  const sections: { id: SectionID; label: string; summary: string; invalid?: boolean }[] = [
    {
      id: 'image',
      label: 'Cloud image',
      summary: image ? image.name : 'Disk image to import',
      invalid: !imageValid,
    },
    {
      id: 'template',
      label: 'Template',
      summary: templateValid ? `${name} — ${cpus} vCPU, ${memoryMb} MB, ${diskGb} GB` : 'Name and sizing',
      invalid: !templateValid,
    },
    {
      id: 'cloudinit',
      label: 'Cloud-init',
      summary: cloudInitUser ? `${cloudInitUser}, ${ipConfig}` : `Default user, ${ipConfig}`,
    },
    {
      id: 'hardware',
      label: 'Hardware',
      summary: `${bios}, ${machineType}, ${netBridge || 'no network'}`,
    },
  ]

  if (buildId) {
    const done = build && !build.running
    const failed = done && Boolean(build?.error)
    return (
      <Box sx={{ p: 3, maxWidth: 720 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Building template {name}
        </Typography>
        <Paper variant="outlined" sx={{ p: 3 }}>
          {!done && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {build?.step ?? 'Starting…'}
              </Typography>
              <LinearProgress />
            </>
          )}
          <Box sx={{ mt: done ? 0 : 2 }}>
            {(build?.steps ?? []).map((s, i) => (
              <Typography
                key={`${s}-${i}`}
                variant="body2"
                sx={{ color: '#5f6368', display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <CheckCircleIcon sx={{ fontSize: 14, color: '#188038' }} /> {s}
              </Typography>
            ))}
          </Box>
          {done && !failed && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Template {name} is ready (VM {build?.imageId}). It's now available in the
              create-instance flow.
            </Alert>
          )}
          {failed && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {build?.error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
            <Button
              variant="contained"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['images'] })
                navigate('/compute/vm-templates')
              }}
            >
              {done ? 'Done' : 'Run in background'}
            </Button>
            {failed && (
              <Button onClick={() => setBuildId(null)}>Back to the wizard</Button>
            )}
          </Box>
        </Paper>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/compute/vm-templates')}>
          Back
        </Button>
        <Typography variant="h5">Build a cloud template</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, ml: 9 }}>
        Imports a cloud disk image, attaches a cloud-init drive and serial console,
        then converts it to a template.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3, flex: 1, minHeight: 0 }}>
        <Paper variant="outlined" sx={{ width: 260, flexShrink: 0, alignSelf: 'flex-start' }}>
          <List dense disablePadding>
            {sections.map((sec) => (
              <ListItemButton
                key={sec.id}
                selected={section === sec.id}
                onClick={() => setSection(sec.id)}
                sx={{
                  py: 1.2,
                  borderLeft: section === sec.id ? '3px solid #1a73e8' : '3px solid transparent',
                }}
              >
                {sec.invalid ? (
                  <ErrorIcon sx={{ fontSize: 14, color: '#d93025', mr: 1.5 }} />
                ) : (
                  <CircleIcon sx={{ fontSize: 8, color: '#5f6368', mr: 2.2, ml: 0.4 }} />
                )}
                <ListItemText
                  primary={sec.label}
                  secondary={sec.summary}
                  slotProps={{
                    primary: { sx: { fontWeight: section === sec.id ? 500 : 400 } },
                    secondary: { sx: { fontSize: 11, wordBreak: 'break-all' } },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>

        <Paper
          variant="outlined"
          sx={{ flex: 1, maxWidth: 640, p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, alignSelf: 'flex-start' }}
        >
          {section === 'image' && (
            <>
              <Typography variant="h6">Cloud image</Typography>
              <TextField
                label="Server"
                size="small"
                select
                value={serverId}
                onChange={(e) => {
                  setServerId(e.target.value)
                  setSourceVolume('')
                  setDiskStorage('')
                }}
                fullWidth
              >
                {servers.map((s) => (
                  <MenuItem key={s.id} value={s.id} disabled={s.status !== 'connected'}>
                    {s.name} ({s.status})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Disk image"
                size="small"
                select
                value={sourceVolume}
                onChange={(e) => setSourceVolume(e.target.value)}
                helperText={
                  images.length === 0
                    ? "No cloud images on this server — download one into a datastore's import content first"
                    : 'qcow2/raw images in a datastore’s import content'
                }
                fullWidth
              >
                {images.map((img) => (
                  <MenuItem key={img.id} value={img.id}>
                    {img.name} — {img.zone} ({formatBytes(img.sizeBytes)})
                  </MenuItem>
                ))}
              </TextField>
              <Alert
                severity={images.length === 0 ? 'warning' : 'info'}
                sx={{ fontSize: 12 }}
                action={
                  <Button
                    size="small"
                    component={RouterLink}
                    to="/compute/cloud-images/add"
                  >
                    Add image
                  </Button>
                }
              >
                {images.length === 0
                  ? 'No cloud images on this server yet — import one from your distro’s cloud-image site first.'
                  : 'Need another? Import one from a URL or upload it.'}
              </Alert>
            </>
          )}

          {section === 'template' && (
            <>
              <Typography variant="h6">Template</Typography>
              <TextField
                label="Template name"
                size="small"
                value={name}
                onChange={(e) => setName(e.target.value)}
                helperText="Lowercase letters, numbers, hyphens. e.g. debian-13-cloud"
                fullWidth
              />
              <TextField
                label="Disk storage"
                size="small"
                select
                value={diskStorage}
                onChange={(e) => setDiskStorage(e.target.value)}
                helperText="Where the imported disk and cloud-init drive land"
                fullWidth
              >
                {diskTargets.map((d) => (
                  <MenuItem key={d.id} value={d.name}>
                    {d.name} — {d.type} ({formatBytes(d.totalBytes - d.usedBytes)} free)
                  </MenuItem>
                ))}
              </TextField>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Disk size (GB)"
                  size="small"
                  type="number"
                  value={diskGb}
                  onChange={(e) => setDiskGb(Number(e.target.value))}
                  helperText="Cloud images ship small; this grows the disk"
                  slotProps={{ htmlInput: { min: 1 } }}
                />
                <TextField
                  label="vCPUs"
                  size="small"
                  type="number"
                  value={cpus}
                  onChange={(e) => setCpus(Number(e.target.value))}
                  slotProps={{ htmlInput: { min: 1, max: 128 } }}
                />
                <TextField
                  label="Memory (MB)"
                  size="small"
                  type="number"
                  value={memoryMb}
                  onChange={(e) => setMemoryMb(Number(e.target.value))}
                  slotProps={{ htmlInput: { min: 128, step: 128 } }}
                />
              </Box>
            </>
          )}

          {section === 'cloudinit' && (
            <>
              <Typography variant="h6">Cloud-init</Typography>
              <Typography variant="body2" color="text.secondary">
                Baked into the template; instances cloned from it inherit these and can
                override them at create time.
              </Typography>
              <TextField
                label="Default user"
                size="small"
                value={cloudInitUser}
                onChange={(e) => setCloudInitUser(e.target.value)}
                helperText="Leave blank to keep the image's own default (debian, ubuntu, …)"
                sx={{ maxWidth: 320 }}
              />
              <TextField
                label="SSH public keys"
                size="small"
                multiline
                minRows={3}
                value={sshKeys}
                onChange={(e) => setSshKeys(e.target.value)}
                placeholder="ssh-ed25519 AAAA... user@host"
                helperText="One key per line"
                fullWidth
              />
              <TextField
                label="IP configuration"
                size="small"
                value={ipConfig}
                onChange={(e) => setIpConfig(e.target.value)}
                helperText="dhcp, or ip=192.168.1.50/24,gw=192.168.1.1"
                sx={{ maxWidth: 420 }}
              />
            </>
          )}

          {section === 'hardware' && (
            <>
              <Typography variant="h6">Hardware</Typography>
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    BIOS
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={bios}
                    onChange={(_, v: string | null) => v && setBios(v)}
                  >
                    <ToggleButton value="seabios" sx={{ textTransform: 'none', px: 2 }}>
                      SeaBIOS
                    </ToggleButton>
                    <ToggleButton value="ovmf" sx={{ textTransform: 'none', px: 2 }}>
                      UEFI (OVMF)
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    Chipset
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={machineType}
                    onChange={(_, v: string | null) => v && setMachineType(v)}
                  >
                    <ToggleButton value="q35" sx={{ textTransform: 'none', px: 2 }}>
                      q35
                    </ToggleButton>
                    <ToggleButton value="i440fx" sx={{ textTransform: 'none', px: 2 }}>
                      i440fx
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              </Box>
              {bios === 'ovmf' && (
                <Alert severity="info" sx={{ fontSize: 12 }}>
                  An EFI disk is created automatically. Make sure the cloud image
                  supports UEFI boot.
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Bridge"
                  size="small"
                  select
                  value={netBridge}
                  onChange={(e) => setNetBridge(e.target.value)}
                  helperText={
                    zoneBridges.length === 0
                      ? 'No bridges reported on this node'
                      : 'Blank leaves the template without a NIC'
                  }
                  sx={{ minWidth: 300 }}
                >
                  <MenuItem value="">
                    <em>No network</em>
                  </MenuItem>
                  {zoneBridges.map((b) => (
                    <MenuItem key={b.name} value={b.name}>
                      {b.name}
                      {b.comment ? ` — ${b.comment}` : ''}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="VLAN tag"
                  size="small"
                  type="number"
                  value={vlanTag || ''}
                  onChange={(e) => setVlanTag(Number(e.target.value) || 0)}
                  disabled={!netBridge || !bridge?.vlanAware}
                  helperText={
                    netBridge && bridge && !bridge.vlanAware
                      ? `${bridge.name} is not VLAN aware`
                      : ' '
                  }
                  slotProps={{ htmlInput: { min: 1, max: 4094 } }}
                />
              </Box>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={enableAgent}
                    onChange={(e) => setEnableAgent(e.target.checked)}
                  />
                }
                label="Enable the QEMU guest agent (cloud images ship it)"
              />
              <Typography variant="body2" color="text.secondary">
                A serial console is always configured — cloud images log to it and
                often carry no graphics driver.
              </Typography>
            </>
          )}
        </Paper>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 2, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={!valid || start.isPending}
          onClick={() => start.mutate()}
        >
          Build template
        </Button>
        <Button onClick={() => navigate('/compute/vm-templates')}>Cancel</Button>
      </Box>
    </Box>
  )
}
