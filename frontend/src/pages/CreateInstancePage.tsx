import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
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
import { api } from '../api/client'

// GCP-style sectioned create flow: a left stepper with per-section
// summaries and a persistent Create/Cancel bar.
type SectionID = 'machine' | 'os' | 'networking' | 'security' | 'advanced'

const nameRe = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/

export default function CreateInstancePage() {
  const navigate = useNavigate()
  const [section, setSection] = useState<SectionID>('machine')
  const [error, setError] = useState<string | null>(null)

  // Machine configuration
  const [name, setName] = useState('')
  const [serverId, setServerId] = useState('')
  const [zone, setZone] = useState('')
  const [machineType, setMachineType] = useState('hl-standard-2')
  const [cpus, setCpus] = useState(2)
  const [memoryMb, setMemoryMb] = useState(2048)
  // OS and storage
  const [imageId, setImageId] = useState('')
  const [diskGb, setDiskGb] = useState(10)
  // Networking
  const [netBridge, setNetBridge] = useState('')
  const [vlanTag, setVlanTag] = useState(0)
  // Security
  const [cloudInitUser, setCloudInitUser] = useState('')
  const [sshKeys, setSshKeys] = useState('')
  // Advanced
  const [description, setDescription] = useState('')
  const [protection, setProtection] = useState(false)

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: machineTypes = [] } = useQuery({
    queryKey: ['machineTypes'],
    queryFn: api.listMachineTypes,
  })
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
        machineType,
        cpus: machineType === 'custom' ? cpus : undefined,
        memoryMb: machineType === 'custom' ? memoryMb : undefined,
        diskGb,
        imageId,
        netBridge: netBridge || undefined,
        vlanTag: vlanTag || undefined,
        cloudInitUser: cloudInitUser || undefined,
        sshKeys: sshKeys || undefined,
        description: description || undefined,
        protected: protection,
      }),
    onSuccess: () => navigate('/compute/instances'),
    onError: (e: Error) => setError(e.message),
  })

  const machineValid = nameRe.test(name) && Boolean(serverId) && Boolean(zone)
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
        ? `${machineType === 'custom' ? `${cpus} vCPU, ${memoryMb} MB` : machineType}, ${serverName}/${zone}`
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
      summary: netBridge
        ? `${netBridge}${vlanTag ? ` (VLAN ${vlanTag})` : ''}`
        : 'Image default network',
    },
    {
      id: 'security',
      label: 'Security',
      summary: sshKeys.trim() ? 'SSH keys configured' : 'VM access',
    },
    {
      id: 'advanced',
      label: 'Advanced',
      summary: protection ? 'Deletion protection on' : 'Description, protection',
    },
  ]

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
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

      <Box sx={{ display: 'flex', gap: 3, flex: 1, minHeight: 0 }}>
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
                helperText="Lowercase letters, numbers, hyphens. Must start with a letter."
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
                    ? 'No servers registered — add one under Bare Metal Solution → Servers'
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
              <Divider textAlign="left">Machine type</Divider>
              <TextField
                label="Machine type"
                size="small"
                select
                value={machineType}
                onChange={(e) => setMachineType(e.target.value)}
                fullWidth
              >
                {machineTypes.map((mt) => (
                  <MenuItem key={mt.name} value={mt.name}>
                    {mt.name} — {mt.description}
                  </MenuItem>
                ))}
                <MenuItem value="custom">custom — choose vCPU and memory</MenuItem>
              </TextField>
              {machineType === 'custom' && (
                <Box sx={{ display: 'flex', gap: 2 }}>
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
              )}
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
                value={netBridge}
                onChange={(e) => setNetBridge(e.target.value)}
                placeholder="vmbr0"
                helperText="Hypervisor network bridge for the primary interface"
                sx={{ maxWidth: 320 }}
              />
              <TextField
                label="VLAN tag"
                size="small"
                type="number"
                value={vlanTag || ''}
                onChange={(e) => setVlanTag(Number(e.target.value) || 0)}
                disabled={!netBridge}
                helperText="Optional 802.1Q VLAN tag"
                slotProps={{ htmlInput: { min: 1, max: 4094 } }}
                sx={{ maxWidth: 220 }}
              />
            </>
          )}

          {section === 'security' && (
            <>
              <Typography variant="h6">Security</Typography>
              <Typography variant="body2" color="text.secondary">
                VM access via cloud-init. Requires a cloud-init enabled image.
              </Typography>
              <TextField
                label="Login user"
                size="small"
                value={cloudInitUser}
                onChange={(e) => setCloudInitUser(e.target.value)}
                helperText="Leave blank to keep the image default"
                sx={{ maxWidth: 320 }}
              />
              <TextField
                label="SSH public keys"
                size="small"
                multiline
                minRows={4}
                value={sshKeys}
                onChange={(e) => setSshKeys(e.target.value)}
                placeholder="ssh-ed25519 AAAA... user@host"
                helperText="One key per line, added to the login user's authorized keys"
                fullWidth
              />
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
