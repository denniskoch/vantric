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
import { templateIdentity } from '../osIdentity'
import { OSIcon } from '../components/OSName'

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
  const [hypervisorId, setServerId] = useState('')
  const [node, setZone] = useState('')
  const [cpus, setCpus] = useState(2)
  const [memoryMb, setMemoryMb] = useState(2048)
  // OS and storage
  const [imageId, setImageId] = useState('')
  // Empty until someone picks: the family otherwise follows whichever
  // template is selected, which is what makes a prefilled image show
  // its own family without a second piece of state to keep in step.
  const [familyChoice, setFamilyChoice] = useState('')
  // Blank means "use the instance name", which is resolved at submit —
  // so typing a name after visiting this field still does the right
  // thing, and clearing it deliberately is impossible to confuse with
  // never having touched it.
  const [serial, setSerial] = useState('')
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
    queryKey: ['image', hypervisorId, imageId],
    queryFn: () => api.describeImage(hypervisorId, imageId),
    enabled: Boolean(hypervisorId) && Boolean(imageId),
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

  const { data: servers = [] } = useQuery({ queryKey: ['hypervisors'], queryFn: api.listHypervisors })
  const { data: nodes = [] } = useQuery({
    queryKey: ['nodes', hypervisorId],
    queryFn: () => api.listNodes(hypervisorId),
    enabled: Boolean(hypervisorId),
  })
  const { data: images = [] } = useQuery({
    queryKey: ['images', hypervisorId],
    queryFn: () => api.listImages(hypervisorId),
    enabled: Boolean(hypervisorId),
  })
  const { data: bridges = [] } = useQuery({ queryKey: ['bridges'], queryFn: api.listBridges })

  // Bridges are per-node, so only the chosen node's are attachable.
  const zoneBridges = bridges.filter((b) => b.hypervisorId === hypervisorId && b.node === node)
  const bridge = zoneBridges.find((b) => b.name === netBridge)

  const connected = servers.filter((s) => s.status === 'connected')
  if (!hypervisorId && connected.length > 0) {
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
        serial: serial.trim() || name,
        name,
        hypervisorId,
        node,
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
    nameRe.test(name) && Boolean(hypervisorId) && Boolean(node) && !cpuError && !memoryError
  const osValid = Boolean(imageId) && diskGb >= 1
  const valid = machineValid && osValid

  const hypervisorName = servers.find((s) => s.id === hypervisorId)?.name
  // Templates, read for what they are. The family list is whatever is
  // actually on the server — a lab shows what it has, not a catalogue
  // of what it could have.
  const identified = images.map((img) => ({ img, id: templateIdentity(img) }))
  const families = [...new Set(identified.map((i) => i.id.family))].sort((a, b) =>
    a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b),
  )
  const chosen = identified.find((i) => i.img.id === imageId)
  const family = familyChoice || chosen?.id.family || ''
  const versions = identified
    .filter((i) => i.id.family === family)
    .sort((a, b) => compareVersions(b.id.version, a.id.version))

  // Picking a family picks its newest release, the way choosing
  // "Debian" should already have answered "which one" for most people.
  const chooseFamily = (next: string) => {
    setFamilyChoice(next)
    const newest = identified
      .filter((i) => i.id.family === next)
      .sort((a, b) => compareVersions(b.id.version, a.id.version))[0]
    setImageId(newest?.img.id ?? '')
  }

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
        ? `${cpus} vCPU, ${formatMemory(memoryMb)}, ${hypervisorName}/${node}`
        : 'Name, server, node, size',
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
                  <ErrorIcon sx={{ fontSize: 14, color: 'error.main', mr: 1.5 }} />
                ) : (
                  <CircleIcon sx={{ fontSize: 8, color: 'text.secondary', mr: 2.2, ml: 0.4 }} />
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
                value={hypervisorId}
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
                label="Node"
                size="small"
                select
                value={node}
                onChange={(e) => setZone(e.target.value)}
                disabled={!hypervisorId}
                fullWidth
              >
                {nodes.map((z) => (
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
              {/* Two steps, the way a cloud console asks it: which
                  system, then which release. Both come from reading the
                  templates rather than from a catalogue anyone has to
                  maintain — see osIdentity. */}
              <TextField
                label="Operating system"
                size="small"
                select
                value={family}
                onChange={(e) => chooseFamily(e.target.value)}
                disabled={!hypervisorId}
                helperText={
                  !hypervisorId
                    ? 'Select a server first (Machine configuration)'
                    : images.length === 0
                      ? 'No templates found on this server'
                      : 'Read from the templates on this server'
                }
                fullWidth
              >
                {families.map((f) => (
                  <MenuItem key={f} value={f}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 16 }}>
                        <OSIcon name={f} />
                      </Box>
                      {f}
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Version"
                size="small"
                select
                value={imageId}
                onChange={(e) => setImageId(e.target.value)}
                disabled={!family}
                helperText={
                  chosen
                    ? `${chosen.img.name} · ${chosen.img.node}${
                        chosen.img.architecture ? ` · ${chosen.img.architecture}` : ''
                      }${chosen.img.createdAt ? `, built ${builtOn(chosen.img.createdAt)}` : ''}`
                    : 'Which release to clone'
                }
                slotProps={{
                  // The closed field shows the name only; the two-line
                  // form belongs in the open list.
                  select: { renderValue: (v) => versions.find((x) => x.img.id === v)?.id.title ?? '' },
                }}
                fullWidth
              >
                {versions.map(({ img, id }) => (
                  <MenuItem key={img.id} value={img.id}>
                    <Box>
                      <Box>{id.title}</Box>
                      <Box sx={{ fontSize: 11, color: 'text.secondary' }}>
                        {img.name}
                        {img.createdAt ? ` · built ${builtOn(img.createdAt)}` : ''}
                      </Box>
                    </Box>
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
                disabled={!node}
                helperText={
                  !node
                    ? 'Pick a node first (Machine configuration)'
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
              <TextField
                label="Serial number"
                size="small"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder={name}
                helperText={
                  'Written to the guest\'s SMBIOS before it first boots, where device ' +
                  'inventory reads it as hardware_serial. Blank leaves it unset — which is ' +
                  'what a hypervisor does by default, and why a fleet of VMs can look ' +
                  'like one host. Defaults to the instance name.'
                }
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

/** Newest first, comparing 24.04 against 9 as numbers rather than text. */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('.').map((n) => Number(n) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function builtOn(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
