import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CircleIcon from '@mui/icons-material/Circle'
import ErrorIcon from '@mui/icons-material/Error'
import { api, emptyCloudInit } from '../api/client'
import type { CloudInitConfig } from '../api/client'
import {
  CloudInitAdvancedFields,
  CloudInitLoginFields,
  CloudInitNetworkFields,
} from '../components/CloudInitFields'
import { resourceNameError } from '../validation'

// GCP-style sectioned create flow: a left stepper with per-section
// summaries and a persistent Create/Cancel bar.
type SectionID = 'machine' | 'os' | 'networking' | 'security' | 'advanced'

const nameRe = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/

/** MB is what the hypervisor takes; GB is what you think in. */
function formatMemory(mb: number): string {
  if (!Number.isFinite(mb) || mb < 128) return ''
  return mb % 1024 === 0 ? `${mb / 1024} GB` : `${(mb / 1024).toFixed(1)} GB`
}

export default function CreateInstancePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [section, setSection] = useState<SectionID>('machine')
  const [error, setError] = useState<string | null>(null)

  // Machine configuration
  const [name, setName] = useState('')
  const [serverId, setServerId] = useState('')
  const [zone, setZone] = useState('')
  const [cpus, setCpus] = useState(2)
  const [memoryMb, setMemoryMb] = useState(2048)
  // OS and storage
  const [imageId, setImageId] = useState('')
  const [diskGb, setDiskGb] = useState(10)
  // Networking
  const [netBridge, setNetBridge] = useState('')
  const [vlanTag, setVlanTag] = useState(0)
  // Security (cloud-init)
  const [cloudInit, setCloudInit] = useState<CloudInitConfig>(emptyCloudInit)
  // Advanced
  const [description, setDescription] = useState('')
  const [protection, setProtection] = useState(false)
  // Whether sizing has been typed in. A template carries its own, and
  // adopting that is only helpful until someone has said otherwise.
  const [sizingTouched, setSizingTouched] = useState(false)

  // What the chosen template already carries. A template built here was
  // given a login, keys and a size; a clone inherits all of it, so the
  // form should show that rather than ask for it a second time.
  const { data: template } = useQuery({
    queryKey: ['image', serverId, imageId],
    queryFn: () => api.describeImage(serverId, imageId),
    enabled: Boolean(serverId) && Boolean(imageId),
    retry: false,
  })

  useEffect(() => {
    if (!template) return
    // Only fill what's still blank — picking an image must never
    // overwrite something already typed.
    setCloudInit((current) => ({
      ...current,
      user: current.user || template.cloudInitUser,
      sshKeys: current.sshKeys || (template.sshKeys ?? []).join('\n'),
      nameservers: current.nameservers || template.nameservers,
      searchDomain: current.searchDomain || template.searchDomain,
      datasource: current.datasource || template.datasource,
      upgradePackages: current.upgradePackages || template.upgradePackages,
    }))
    if (!sizingTouched) {
      if (template.cpus > 0) setCpus(template.cpus)
      if (template.memoryMb > 0) setMemoryMb(template.memoryMb)
      if (template.diskGb > 0) setDiskGb(template.diskGb)
    }
    // sizingTouched is read, not tracked: re-running on it would undo a
    // deliberate edit the moment it was made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template])

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: zones = [] } = useQuery({
    queryKey: ['zones', serverId],
    queryFn: () => api.listZones(serverId),
    enabled: Boolean(serverId),
  })
  const { data: images = [] } = useQuery({
    queryKey: ['images', serverId],
    queryFn: () => api.listImages(serverId),
    enabled: Boolean(serverId),
  })
  const { data: bridges = [] } = useQuery({ queryKey: ['bridges'], queryFn: api.listBridges })

  // Bridges are per-node, so only the chosen zone's are attachable.
  const zoneBridges = bridges.filter((b) => b.serverId === serverId && b.zone === zone)
  const bridge = zoneBridges.find((b) => b.name === netBridge)

  const connected = servers.filter((s) => s.status === 'connected')
  if (!serverId && connected.length > 0) {
    setServerId(connected[0].id)
  }

  const selectServer = (id: string) => {
    setServerId(id)
    setZone('')
    setImageId('')
  }

  const create = useMutation({
    mutationFn: () =>
      api.createInstance({
        name,
        serverId,
        zone,
        cpus,
        memoryMb,
        diskGb,
        imageId,
        netBridge: netBridge || undefined,
        vlanTag: vlanTag || undefined,
        cloudInit,
        description: description || undefined,
        protected: protection,
      }),
    // The clone runs in the background now, so this hands off to the
    // notification bell rather than waiting for a VM to exist.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      navigate('/compute/instances')
    },
    onError: (e: Error) => setError(e.message),
  })

  const cpuError = cpus < 1 || cpus > 128 ? 'Between 1 and 128' : ''
  const memoryError = memoryMb < 128 ? 'At least 128 MB' : ''

  const machineValid =
    nameRe.test(name) && Boolean(serverId) && Boolean(zone) && !cpuError && !memoryError
  const osValid = Boolean(imageId) && diskGb >= 1
  const valid = machineValid && osValid

  const serverName = servers.find((s) => s.id === serverId)?.name
  const imageName = images.find((i) => i.id === imageId)?.name

  const sections: {
    id: SectionID
    label: string
    summary: string
    invalid?: boolean
  }[] = [
    {
      id: 'machine',
      label: 'Machine configuration',
      summary: machineValid
        ? `${cpus} vCPU, ${formatMemory(memoryMb)}, ${serverName}/${zone}`
        : 'Name, server, zone, size',
      invalid: !machineValid,
    },
    {
      id: 'os',
      label: 'OS and storage',
      summary: osValid ? `${imageName}, ${diskGb} GB` : 'Image and boot disk',
      invalid: !osValid,
    },
    {
      id: 'networking',
      label: 'Networking',
      summary: [
        netBridge ? `${netBridge}${vlanTag ? ` (VLAN ${vlanTag})` : ''}` : 'image default',
        cloudInit.dhcp ? 'DHCP' : cloudInit.address || 'static',
      ].join(', '),
    },
    {
      id: 'security',
      label: 'Security',
      summary: [
        cloudInit.user || 'default user',
        cloudInit.sshKeys.trim() ? 'SSH keys' : null,
        cloudInit.password ? 'password' : null,
      ]
        .filter(Boolean)
        .join(', '),
    },
    {
      id: 'advanced',
      label: 'Advanced',
      summary: protection ? 'Deletion protection on' : 'Description, protection',
    },
  ]

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/compute/instances')}>
          Back
        </Button>
        <Typography variant="h5">Create an instance</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3 }}>
        {/* Section stepper */}
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
                    secondary: { sx: { fontSize: 11 } },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>

        {/* Active section form */}
        <Paper
          variant="outlined"
          sx={{ flex: 1, maxWidth: 640, p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, alignSelf: 'flex-start' }}
        >
          {section === 'machine' && (
            <>
              <Typography variant="h6">Machine configuration</Typography>
              <TextField
                label="Name"
                size="small"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={Boolean(resourceNameError(name))}
                helperText={
                  resourceNameError(name) ??
                  'Lowercase letters, numbers, hyphens. Must start with a letter.'
                }
                fullWidth
              />
              <TextField
                label="Server"
                size="small"
                select
                value={serverId}
                onChange={(e) => selectServer(e.target.value)}
                helperText={
                  servers.length === 0
                    ? 'No hypervisors registered — add one under Settings → Hypervisors'
                    : undefined
                }
                fullWidth
              >
                {servers.map((s) => (
                  <MenuItem key={s.id} value={s.id} disabled={s.status !== 'connected'}>
                    {s.name} ({s.status})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Zone"
                size="small"
                select
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                disabled={!serverId}
                fullWidth
              >
                {zones.map((z) => (
                  <MenuItem key={z.id} value={z.id}>
                    {z.name} ({z.status})
                  </MenuItem>
                ))}
              </TextField>
              <Divider textAlign="left">Size</Divider>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="vCPUs"
                  size="small"
                  type="number"
                  value={cpus}
                  onChange={(e) => {
                    setSizingTouched(true)
                    setCpus(Number(e.target.value))
                  }}
                  error={Boolean(cpuError)}
                  helperText={cpuError || 'Cores the guest sees'}
                  slotProps={{ htmlInput: { min: 1, max: 128 } }}
                  fullWidth
                />
                <TextField
                  label="Memory (MB)"
                  size="small"
                  type="number"
                  value={memoryMb}
                  onChange={(e) => {
                    setSizingTouched(true)
                    setMemoryMb(Number(e.target.value))
                  }}
                  error={Boolean(memoryError)}
                  helperText={memoryError || formatMemory(memoryMb)}
                  slotProps={{ htmlInput: { min: 128, step: 128 } }}
                  fullWidth
                />
              </Box>
            </>
          )}

          {section === 'os' && (
            <>
              <Typography variant="h6">Operating system and storage</Typography>
              <TextField
                label="Image"
                size="small"
                select
                value={imageId}
                onChange={(e) => setImageId(e.target.value)}
                disabled={!serverId}
                helperText={
                  !serverId
                    ? 'Select a server first (Machine configuration)'
                    : images.length === 0
                      ? 'No templates found on this server'
                      : 'Templates available on the selected server'
                }
                fullWidth
              >
                {images.map((img) => (
                  <MenuItem key={img.id} value={img.id}>
                    {img.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Boot disk size (GB)"
                size="small"
                type="number"
                value={diskGb}
                onChange={(e) => setDiskGb(Number(e.target.value))}
                slotProps={{ htmlInput: { min: 1 } }}
                sx={{ maxWidth: 220 }}
              />
            </>
          )}

          {section === 'networking' && (
            <>
              <Typography variant="h6">Networking</Typography>
              <Typography variant="body2" color="text.secondary">
                Leave blank to keep the image's network configuration.
              </Typography>
              <TextField
                label="Bridge"
                size="small"
                select
                value={netBridge}
                onChange={(e) => setNetBridge(e.target.value)}
                disabled={!zone}
                helperText={
                  !zone
                    ? 'Pick a zone first (Machine configuration)'
                    : zoneBridges.length === 0
                      ? 'No bridges reported on this node'
                      : "Leave blank to keep the image's own network"
                }
                sx={{ maxWidth: 420 }}
              >
                <MenuItem value="">
                  <em>Image default</em>
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
                    : 'Optional 802.1Q VLAN tag'
                }
                slotProps={{ htmlInput: { min: 1, max: 4094 } }}
                sx={{ maxWidth: 220 }}
              />
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2" color="text.secondary">
                Guest addressing, applied by cloud-init on first boot.
              </Typography>
              <CloudInitNetworkFields value={cloudInit} onChange={setCloudInit} />
            </>
          )}

          {section === 'security' && (
            <>
              <Typography variant="h6">Security and access</Typography>
              <Typography variant="body2" color="text.secondary">
                Applied by cloud-init on first boot. Requires a cloud-init enabled
                image — the templates built by the wizard are.
              </Typography>
              <CloudInitLoginFields value={cloudInit} onChange={setCloudInit} />
            </>
          )}

          {section === 'advanced' && (
            <>
              <Typography variant="h6">Advanced</Typography>
              <TextField
                label="Description"
                size="small"
                multiline
                minRows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={protection}
                    onChange={(e) => setProtection(e.target.checked)}
                  />
                }
                label="Enable deletion protection"
              />
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                Cloud-init
              </Typography>
              <CloudInitAdvancedFields value={cloudInit} onChange={setCloudInit} />
            </>
          )}
        </Paper>
      </Box>

      {/* Persistent action bar, GCP-style */}
      <Box
        sx={{
          display: 'flex',
          gap: 1,
          pt: 2,
          mt: 2,
          borderTop: '1px solid #dadce0',
        }}
      >
        <Button
          variant="contained"
          disabled={!valid || create.isPending}
          onClick={() => create.mutate()}
        >
          Create
        </Button>
        <Button onClick={() => navigate('/compute/instances')}>Cancel</Button>
      </Box>
    </Box>
  )
}
