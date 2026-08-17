import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import type { Hypervisor, HypervisorRequest, HypervisorType } from '../api/client'
import FormPage from '../components/FormPage'
import { resourceNameError, resourceNameRe, urlError } from '../validation'

const emptyForm: HypervisorRequest = {
  name: '',
  type: 'proxmox',
  baseUrl: '',
  tokenId: '',
  secret: '',
  insecureTls: true,
}

const backTo = '/compute/hypervisors'

function HypervisorForm({ editing }: { editing: Hypervisor | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<HypervisorRequest>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          baseUrl: editing.baseUrl,
          tokenId: editing.tokenId,
          secret: '', // blank keeps the stored secret
          insecureTls: editing.insecureTls,
        }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => (editing ? api.updateHypervisor(editing.id, form) : api.createHypervisor(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hypervisors'] })
      navigate(backTo)
    },
    onError: (e: Error) => setError(e.message),
  })

  const isProxmox = form.type === 'proxmox'
  const nameError = resourceNameError(form.name)
  const baseUrlError = urlError(form.baseUrl)
  const valid =
    resourceNameRe.test(form.name) &&
    (!isProxmox ||
      (form.baseUrl !== '' &&
        !baseUrlError &&
        form.tokenId !== '' &&
        (form.secret !== '' || Boolean(editing?.hasSecret))))

  return (
    <FormPage
      title={editing ? `Edit ${editing.name}` : 'Add hypervisor'}
      backTo={backTo}
      backLabel="Hypervisors"
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel={editing ? 'Save' : 'Add'}
      primaryDisabled={!valid}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <TextField
        label="Name"
        size="small"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        error={Boolean(nameError)}
        helperText={nameError ?? 'Lowercase letters, numbers, hyphens. e.g. pve-1'}
        fullWidth
      />
      <TextField
        label="Type"
        size="small"
        select
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value as HypervisorType })}
        helperText="More hypervisors (ESXi, libvirt, …) planned"
        fullWidth
      >
        <MenuItem value="proxmox">Proxmox VE</MenuItem>
        <MenuItem value="mock">Mock (development)</MenuItem>
      </TextField>
      {isProxmox && (
        <>
          <TextField
            label="API URL"
            size="small"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder="https://pve.lan:8006"
            error={Boolean(baseUrlError)}
            helperText={baseUrlError ?? ' '}
            fullWidth
          />
          <TextField
            label="API token ID"
            size="small"
            value={form.tokenId}
            onChange={(e) => setForm({ ...form, tokenId: e.target.value })}
            placeholder="root@pam!labcloud"
            fullWidth
          />
          <TextField
            label="API token secret"
            size="small"
            type="password"
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            helperText={
              editing?.hasSecret
                ? 'Leave blank to keep the current secret'
                : 'From Datacenter → Permissions → API Tokens'
            }
            fullWidth
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={form.insecureTls}
                onChange={(e) => setForm({ ...form, insecureTls: e.target.checked })}
              />
            }
            label="Allow self-signed TLS certificate"
          />
        </>
      )}
    </FormPage>
  )
}

export default function HypervisorFormPage() {
  const { id } = useParams()
  const { data: hypervisors = [], isLoading } = useQuery({
    queryKey: ['hypervisors'],
    queryFn: api.listHypervisors,
    enabled: Boolean(id),
  })

  if (id && isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading hypervisor…</Typography>
      </Box>
    )
  }
  return <HypervisorForm editing={hypervisors.find((s) => s.id === id) ?? null} />
}
