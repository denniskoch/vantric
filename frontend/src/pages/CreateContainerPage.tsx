import { useState } from 'react'
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
import SelectField from '../components/SelectField'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CircleIcon from '@mui/icons-material/Circle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import SizeSlider, { cpuSlider, memorySlider } from '../components/SizeSlider'
import { formatMemory } from '../format'
import type { ContainerRequest } from '../api/client'
import OSName from '../components/OSName'
import {
  domainError,
  ipv4AddressError,
  ipv4CIDRError,
  resourceNameError,
  resourceNameRe,
  vlanIDError,
} from '../validation'

type SectionID = 'basics' | 'networking' | 'access' | 'advanced'

/**
 * Creating a container.
 *
 * Same sectioned template as Create instance, deliberately different
 * content. A VM clones a template that already carries a login, keys,
 * sizing and a disk, so most of that form is overrides and a blank
 * means "inherit". A container is extracted from a root-filesystem
 * tarball that carries none of it: the pool, the size, the addressing
 * and the way in all have to be stated here, because there is nothing
 * to inherit them from.
 */
export default function CreateContainerPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [section, setSection] = useState<SectionID>('basics')
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<ContainerRequest>({
    name: '',
    hypervisorId: '',
    node: '',
    template: '',
    storage: '',
    cpus: 1,
    memoryMb: 512,
    // Not Proxmox's 512: a container swapping out of the host's memory
    // is a surprise on a lab box that's already tight.
    swapMb: 0,
    diskGb: 8,
    netBridge: '',
    vlanTag: 0,
    dhcp: true,
    address: '',
    gateway: '',
    nameservers: '',
    searchDomain: '',
    password: '',
    sshKeys: '',
    // Unprivileged unless you say otherwise: root inside a privileged
    // container is root on the host if it ever gets out.
    unprivileged: true,
    nesting: false,
    startOnBoot: false,
    description: '',
    protected: false,
  })
  const set = (patch: Partial<ContainerRequest>) => setForm({ ...form, ...patch })

  const { data: hypervisors = [] } = useQuery({
    queryKey: ['hypervisors'],
    queryFn: api.listHypervisors,
  })
  const connected = hypervisors.filter((h) => h.status === 'connected')
  if (!form.hypervisorId && connected.length > 0) set({ hypervisorId: connected[0].id })

  // Everything placeable is per-hypervisor, so all three narrow.
  const { data: nodes = [] } = useQuery({
    queryKey: ['nodes', form.hypervisorId],
    queryFn: () => api.listNodes(form.hypervisorId),
    enabled: Boolean(form.hypervisorId),
  })
  const { data: templates = [] } = useQuery({
    queryKey: ['ctTemplates'],
    queryFn: api.listCTTemplates,
    enabled: Boolean(form.hypervisorId),
  })
  const { data: datastores = [] } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
    enabled: Boolean(form.hypervisorId),
  })
  const { data: bridges = [] } = useQuery({
    queryKey: ['bridges'],
    queryFn: api.listBridges,
    enabled: Boolean(form.hypervisorId),
  })

  if (!form.node && nodes.length > 0) set({ node: nodes[0].id })
  // A container's root filesystem needs a pool that takes rootdir
  // content — an iso-only datastore would be accepted here and refused
  // by the hypervisor.
  const onThisNode = <T extends { hypervisorId: string; node: string }>(items: T[]) =>
    items.filter((i) => i.hypervisorId === form.hypervisorId && i.node === form.node)
  // A root filesystem needs a pool that takes `rootdir` content; an
  // iso-only datastore would be accepted here and refused by the
  // hypervisor.
  const rootPools = onThisNode(datastores).filter((d) => d.content.includes('rootdir'))
  const nodeTemplates = onThisNode(templates)

  const create = useMutation({
    mutationFn: () => api.createContainer(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      // The work outlives the request and reports in the bell, so the
      // form doesn't sit spinning on it.
      navigate('/compute/containers')
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = resourceNameError(form.name)
  const addressError = form.dhcp ? null : ipv4CIDRError(form.address)
  // Checked against the address, so a gateway outside the subnet is
  // caught here rather than by a container that can't reach anything.
  const gatewayError =
    form.dhcp || !form.gateway ? null : ipv4AddressError(form.gateway, form.address)
  const searchError = form.searchDomain ? domainError(form.searchDomain) : null
  const vlanError = vlanIDError(String(form.vlanTag || ''))

  const basicsValid =
    resourceNameRe.test(form.name) &&
    Boolean(form.hypervisorId && form.node && form.template && form.storage) &&
    form.cpus > 0 &&
    form.memoryMb > 0 &&
    form.diskGb > 0
  const networkingValid = !addressError && !gatewayError && !searchError && !vlanError
  // No password and no key is a container nobody can log in to. The
  // backend refuses it too; this says so before you submit.
  const accessValid = Boolean(form.password || form.sshKeys.trim())

  const templateName = nodeTemplates.find((t) => t.id === form.template)?.name

  const sections: { id: SectionID; label: string; summary: string; invalid?: boolean }[] = [
    {
      id: 'basics',
      label: 'Container',
      summary: basicsValid
        ? `${form.cpus} vCPU, ${form.memoryMb} MB, ${form.diskGb} GB on ${form.node}`
        : 'Name, template, size, storage',
      invalid: !basicsValid,
    },
    {
      id: 'networking',
      label: 'Networking',
      summary: [form.netBridge || 'no bridge', form.dhcp ? 'DHCP' : form.address || 'static'].join(
        ', ',
      ),
      invalid: !networkingValid,
    },
    {
      id: 'access',
      label: 'Access',
      summary: accessValid
        ? [form.password ? 'root password' : null, form.sshKeys.trim() ? 'SSH key' : null]
            .filter(Boolean)
            .join(', ')
        : 'No way in yet',
      invalid: !accessValid,
    },
    {
      id: 'advanced',
      label: 'Advanced',
      summary: [
        form.unprivileged ? 'unprivileged' : 'PRIVILEGED',
        form.nesting ? 'nesting' : null,
        form.startOnBoot ? 'start on boot' : null,
      ]
        .filter(Boolean)
        .join(', '),
    },
  ]

  const valid = basicsValid && networkingValid && accessValid

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/compute/containers')}
        >
          Container instances
        </Button>
        <Typography variant="h5">Create a container</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {connected.length === 0 && (
        <Alert severity="info" sx={{ mb: 2, maxWidth: 680 }}>
          No hypervisor is connected, so there's nowhere to create a container.
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3 }}>
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

        <Paper
          variant="outlined"
          sx={{
            flex: 1,
            maxWidth: 640,
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            alignSelf: 'flex-start',
          }}
        >
          {section === 'basics' && (
            <>
              <Typography variant="h6">Container</Typography>

              <TextField
                label="Name"
                size="small"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                error={Boolean(nameError)}
                helperText={nameError ?? "Also the container's hostname"}
                fullWidth
              />
              <TextField
                label="Hypervisor"
                size="small"
                select
                value={form.hypervisorId}
                onChange={(e) =>
                  set({ hypervisorId: e.target.value, node: '', template: '', storage: '' })
                }
                fullWidth
              >
                {hypervisors.map((h) => (
                  <MenuItem key={h.id} value={h.id} disabled={h.status !== 'connected'}>
                    {h.name} ({h.status})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Node"
                size="small"
                select
                value={form.node}
                onChange={(e) => set({ node: e.target.value, template: '', storage: '' })}
                helperText="The host it runs on"
                fullWidth
              >
                {nodes.map((n) => (
                  <MenuItem key={n.id} value={n.id}>
                    {n.name}
                  </MenuItem>
                ))}
              </TextField>

              <Divider textAlign="left">Template</Divider>

              <TextField
                label="Container template"
                size="small"
                select
                value={form.template}
                onChange={(e) => set({ template: e.target.value })}
                helperText={
                  nodeTemplates.length === 0
                    ? 'No templates on this node — download one under Images and media'
                    : 'The root filesystem this container starts from'
                }
                fullWidth
              >
                {nodeTemplates.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    <OSName name={t.name} />
                  </MenuItem>
                ))}
              </TextField>

              <Divider textAlign="left">Size</Divider>

              <SizeSlider
                label="Cores"
                {...cpuSlider}
                value={form.cpus}
                onChange={(next) => set({ cpus: next })}
              />
              <SizeSlider
                label="Memory"
                {...memorySlider}
                value={form.memoryMb}
                onChange={(next) => set({ memoryMb: next })}
                caption={formatMemory(form.memoryMb)}
              />
              <TextField
                label="Swap (MB)"
                size="small"
                type="number"
                value={form.swapMb}
                onChange={(e) => set({ swapMb: Number(e.target.value) })}
                helperText="Out of the host's swap"
                sx={{ width: 160 }}
              />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Disk (GB)"
                  size="small"
                  type="number"
                  value={form.diskGb}
                  onChange={(e) => set({ diskGb: Number(e.target.value) })}
                  sx={{ width: 120 }}
                />
                <TextField
                  label="Storage"
                  size="small"
                  select
                  value={form.storage}
                  onChange={(e) => set({ storage: e.target.value })}
                  helperText={
                    rootPools.length === 0
                      ? 'No pool on this node takes container filesystems'
                      : 'Pool the root filesystem is created on'
                  }
                  sx={{ flex: 1 }}
                >
                  {rootPools.map((d) => (
                    <MenuItem key={d.id} value={d.name}>
                      {d.name} ({d.type})
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </>
          )}

          {section === 'networking' && (
            <>
              <Typography variant="h6">Networking</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: -1.5 }}>
                Set on the container's interface by the hypervisor, not through cloud-init — so it
                applies whether or not anything inside cooperates.
              </Typography>

              <SelectField
                label="Bridge"
                size="small"
                value={form.netBridge}
                onChange={(e) => set({ netBridge: e.target.value })}
                helperText="Leave blank for a container with no network"
                fullWidth
              >
                <MenuItem value="">
                  <em>No network</em>
                </MenuItem>
                {onThisNode(bridges).map((b) => (
                    <MenuItem key={`${b.node}/${b.name}`} value={b.name}>
                      {b.name}
                      {b.cidr ? ` — ${b.cidr}` : ''}
                  </MenuItem>
                ))}
              </SelectField>
              <TextField
                label="VLAN tag"
                size="small"
                type="number"
                value={form.vlanTag || ''}
                onChange={(e) => set({ vlanTag: Number(e.target.value) })}
                error={Boolean(vlanError)}
                helperText={vlanError ?? 'Blank or 0 for untagged'}
                sx={{ width: 160 }}
              />

              <Divider textAlign="left">Address</Divider>

              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.dhcp}
                    onChange={(e) => set({ dhcp: e.target.checked })}
                  />
                }
                label="Get an address by DHCP"
              />
              {!form.dhcp && (
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    label="Address"
                    size="small"
                    value={form.address}
                    onChange={(e) => set({ address: e.target.value })}
                    placeholder="192.168.80.50/24"
                    error={Boolean(addressError)}
                    helperText={addressError ?? 'With its prefix length'}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Gateway"
                    size="small"
                    value={form.gateway}
                    onChange={(e) => set({ gateway: e.target.value })}
                    placeholder="192.168.80.1"
                    error={Boolean(gatewayError)}
                    helperText={gatewayError ?? ' '}
                    sx={{ flex: 1 }}
                  />
                </Box>
              )}
              <TextField
                label="Nameservers"
                size="small"
                value={form.nameservers}
                onChange={(e) => set({ nameservers: e.target.value })}
                helperText="Space-separated; blank uses the host's"
                fullWidth
              />
              <TextField
                label="Search domain"
                size="small"
                value={form.searchDomain}
                onChange={(e) => set({ searchDomain: e.target.value })}
                error={Boolean(searchError)}
                helperText={searchError ?? "Blank uses the host's"}
                fullWidth
              />
            </>
          )}

          {section === 'access' && (
            <>
              <Typography variant="h6">Access</Typography>
              {/* Proxmox will happily build a container with neither, and
                  then there is no way in at all. */}
              {!accessValid && (
                <Alert severity="warning">
                  Set a root password or an SSH key, or there's no way in once it starts.
                </Alert>
              )}

              <TextField
                label="Root password"
                size="small"
                type="password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                helperText="Sent to the hypervisor, which hashes it"
                fullWidth
              />
              <TextField
                label="SSH public keys"
                size="small"
                multiline
                minRows={3}
                value={form.sshKeys}
                onChange={(e) => set({ sshKeys: e.target.value })}
                placeholder="ssh-ed25519 AAAA... you@host"
                helperText="One per line, authorized for root"
                fullWidth
              />
            </>
          )}

          {section === 'advanced' && (
            <>
              <Typography variant="h6">Advanced</Typography>

              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.unprivileged}
                    onChange={(e) => set({ unprivileged: e.target.checked })}
                  />
                }
                label="Unprivileged"
              />
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: -1.5 }}>
                A privileged container shares the host's user namespace, so root inside is
                root on {form.node || 'the host'} if it ever escapes.
              </Typography>

              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.nesting}
                    onChange={(e) => set({ nesting: e.target.checked })}
                  />
                }
                label="Allow nesting"
              />
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: -1.5 }}>
                Needed to run Docker or another container runtime inside this one.
              </Typography>

              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.startOnBoot}
                    onChange={(e) => set({ startOnBoot: e.target.checked })}
                  />
                }
                label="Start when the node boots"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.protected}
                    onChange={(e) => set({ protected: e.target.checked })}
                  />
                }
                label="Deletion protection"
              />

              <Divider />

              <TextField
                label="Description"
                size="small"
                multiline
                minRows={2}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                helperText="Written to the hypervisor's own notes field"
                fullWidth
              />
            </>
          )}
        </Paper>
      </Box>

      <Box
        sx={{
          display: 'flex',
          gap: 1,
          pt: 2,
          mt: 3,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Button
          variant="contained"
          disabled={!valid || create.isPending}
          onClick={() => create.mutate()}
        >
          Create
        </Button>
        <Button onClick={() => navigate('/compute/containers')}>Cancel</Button>
      </Box>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
        {templateName ? `From ${templateName}. ` : ''}
        Creating runs in the background and reports in the notification bell.
      </Typography>
    </Box>
  )
}
