import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MenuItem, TextField, Typography } from '@mui/material'
import FormPage from '../components/FormPage'
import SelectField from '../components/SelectField'
import { api } from '../api/client'

/**
 * A second disk for a guest that already exists.
 *
 * Its own page rather than a dialog, because anything you fill in gets
 * one — a modal here couldn't be linked to, wouldn't survive a reload,
 * and has nowhere to put the explanation of what the guest still has to
 * do afterwards.
 */
export default function InstanceAddDiskPage() {
  const { name = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [storage, setStorage] = useState('')
  const [sizeGb, setSizeGb] = useState(10)
  const [error, setError] = useState<string | null>(null)

  const { data: instance } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name),
    enabled: Boolean(name),
  })
  const { data: datastores = [] } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
  })
  // The same rule the create form and the container form apply: a VM
  // disk needs a pool that takes `images`, and it has to be on the node
  // this guest is actually running on.
  const pools = datastores.filter(
    (d) =>
      d.hypervisorId === instance?.hypervisorId && d.node === instance?.node &&
      d.content.includes('images'),
  )

  const add = useMutation({
    mutationFn: () => api.addInstanceDisk(name, { storage, sizeGb }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instanceDetail', name] })
      navigate(`/compute/instances/${encodeURIComponent(name)}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const sizeError = sizeGb < 1 ? 'A disk needs at least 1 GB' : ''

  return (
    <FormPage
      title={`Add a disk to ${name}`}
      backTo={`/compute/instances/${encodeURIComponent(name)}`}
      backLabel={name}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Add disk"
      primaryDisabled={!storage || Boolean(sizeError)}
      pending={add.isPending}
      onPrimary={() => {
        setError(null)
        add.mutate()
      }}
    >
      <SelectField
        label="Storage"
        value={storage}
        onChange={(e) => setStorage(e.target.value)}
        helperText={
          !instance
            ? 'Loading this instance'
            : pools.length === 0
              ? `No pool on ${instance.node} takes VM disks`
              : `Pools on ${instance.node}`
        }
        fullWidth
      >
        <MenuItem value="">Choose a pool</MenuItem>
        {pools.map((d) => (
          <MenuItem key={d.id} value={d.name}>
            {d.name} ({d.type})
          </MenuItem>
        ))}
      </SelectField>
      <TextField
        label="Size (GB)"
        type="number"
        value={sizeGb}
        onChange={(e) => setSizeGb(Number(e.target.value))}
        error={Boolean(sizeError)}
        helperText={sizeError || 'Can be grown later, never shrunk'}
        slotProps={{ htmlInput: { min: 1 } }}
        sx={{ width: 200 }}
      />
      <Typography variant="body2" color="text.secondary">
        The disk is attached to the next free SCSI slot. The guest still has to
        partition, format and mount it — adding one here gives the machine a
        block device, not a filesystem.
      </Typography>
    </FormPage>
  )
}
