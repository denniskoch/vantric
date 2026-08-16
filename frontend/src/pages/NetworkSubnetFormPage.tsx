import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, MenuItem, Paper, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { ipv4AddressError, ipv4CIDRError, vlanIDError } from '../validation'

/**
 * Recording an address range, or correcting one.
 *
 * A page rather than a dialog, like every other form here — it can be
 * linked to, survives a reload, and has room for the IPv6 pair when
 * dual-stack arrives.
 */
export default function NetworkSubnetFormPage() {
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [stackType, setStackType] = useState('IPv4')
  const [vlan, setVLAN] = useState('')
  const [ipv4Range, setIPv4Range] = useState('')
  const [ipv4Gateway, setIPv4Gateway] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: existing } = useQuery({
    queryKey: ['subnet', id],
    queryFn: () => api.getSubnet(id!),
    enabled: editing,
  })

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setStackType(existing.stackType)
    setVLAN(existing.vlan > 0 ? String(existing.vlan) : '')
    setIPv4Range(existing.ipv4Range)
    setIPv4Gateway(existing.ipv4Gateway)
    setDescription(existing.description)
  }, [existing])

  const save = useMutation({
    mutationFn: () => {
      const body = { name, stackType, vlan: Number(vlan) || 0, ipv4Range, ipv4Gateway, description }
      return editing ? api.updateSubnet(id!, body) : api.createSubnet(body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subnets'] })
      queryClient.invalidateQueries({ queryKey: ['subnet', id] })
      navigate('/network/subnets')
    },
    onError: (e: Error) => setError(e.message),
  })

  // Shown as soon as a field is wrong, not held back until submit —
  // a disabled button on its own never says why.
  const vlanError = vlanIDError(vlan)
  const rangeError = ipv4CIDRError(ipv4Range)
  const gatewayError = ipv4AddressError(ipv4Gateway, ipv4Range)
  const complete = name.trim() !== '' && ipv4Range.trim() !== ''
  const valid = complete && !vlanError && !rangeError && !gatewayError

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/network/subnets')}
        >
          Subnets
        </Button>
      </Box>
      <PageHeader title={editing ? 'Edit subnet' : 'Create subnet'} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
        <TextField
          label="Name"
          size="small"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="Description"
          size="small"
          fullWidth
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          helperText="What this range is for."
        />
        <TextField
          label="Source"
          size="small"
          fullWidth
          value={existing?.source ?? 'manual'}
          disabled
          helperText="Where this range came from. Typed in here is 'manual'."
        />
        <TextField
          label="Stack type"
          size="small"
          select
          fullWidth
          value={stackType}
          onChange={(e) => setStackType(e.target.value)}
        >
          <MenuItem value="IPv4">IPv4 (single-stack)</MenuItem>
        </TextField>
        <TextField
          label="VLAN"
          size="small"
          fullWidth
          value={vlan}
          onChange={(e) => setVLAN(e.target.value)}
          error={Boolean(vlanError)}
          helperText={vlanError ?? 'Optional. 1–4094; leave blank for untagged.'}
        />
        <TextField
          label="IPv4 range"
          size="small"
          fullWidth
          value={ipv4Range}
          onChange={(e) => setIPv4Range(e.target.value)}
          error={Boolean(rangeError)}
          helperText={rangeError ?? 'CIDR, for example 192.168.80.0/24'}
        />
        <TextField
          label="IPv4 gateway"
          size="small"
          fullWidth
          value={ipv4Gateway}
          onChange={(e) => setIPv4Gateway(e.target.value)}
          error={Boolean(gatewayError)}
          helperText={gatewayError ?? 'Optional. Must sit inside the range.'}
        />
      </Paper>

      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button variant="contained" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Save' : 'Create'}
        </Button>
        <Button onClick={() => navigate('/network/subnets')}>Cancel</Button>
        {!complete && (
          <Typography sx={{ alignSelf: 'center', fontSize: 12, color: 'text.secondary' }}>
            A name and an IPv4 range are required
          </Typography>
        )}
      </Box>
    </Box>
  )
}
