import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TextField, Typography } from '@mui/material'
import FormPage from '../components/FormPage'
import { api } from '../api/client'
import { formatBytes } from '../format'

/**
 * Growing a disk that already exists.
 *
 * The current size is read from the guest rather than passed in the
 * URL, so the floor this enforces is what the hypervisor says right now
 * — a page left open while somebody else resized would otherwise offer
 * a number that is a shrink by the time it's submitted.
 */
export default function InstanceResizeDiskPage() {
  const { name = '', disk = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sizeGb, setSizeGb] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const { data: detail } = useQuery({
    queryKey: ['instanceDetail', name],
    queryFn: () => api.describeInstance(name),
    enabled: Boolean(name),
  })
  const current = detail?.disks?.find((d) => d.interface === disk)
  const currentGb = current ? Math.floor(current.sizeBytes / (1024 * 1024 * 1024)) : 0

  // Start one GB above what's there: the smallest change that is a
  // change, and never a number the hypervisor would refuse.
  useEffect(() => {
    if (currentGb > 0 && sizeGb === 0) setSizeGb(currentGb + 1)
  }, [currentGb, sizeGb])

  const resize = useMutation({
    mutationFn: () => api.resizeInstanceDisk(name, disk, sizeGb),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instanceDetail', name] })
      navigate(`/compute/instances/${encodeURIComponent(name)}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const sizeError =
    currentGb > 0 && sizeGb <= currentGb
      ? `${disk} is already ${currentGb} GB, and a disk can be grown but never shrunk`
      : ''

  return (
    <FormPage
      title={`Resize ${disk} on ${name}`}
      backTo={`/compute/instances/${encodeURIComponent(name)}`}
      backLabel={name}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Resize"
      primaryDisabled={Boolean(sizeError) || sizeGb < 1}
      pending={resize.isPending}
      onPrimary={() => {
        setError(null)
        resize.mutate()
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {current
          ? `${disk} is ${formatBytes(current.sizeBytes)} on ${current.storage || 'unknown storage'}.`
          : 'Reading this instance…'}
      </Typography>
      <TextField
        label="New size (GB)"
        type="number"
        value={sizeGb || ''}
        onChange={(e) => setSizeGb(Number(e.target.value))}
        error={Boolean(sizeError)}
        helperText={sizeError || 'The final size, not how much to add'}
        slotProps={{ htmlInput: { min: currentGb + 1 } }}
        sx={{ width: 200 }}
      />
      <Typography variant="body2" color="text.secondary">
        This grows the virtual disk. The guest then has to grow the partition
        and the filesystem on it — a cloud image with growpart does that on the
        next boot; anything else is <code>growpart</code> and{' '}
        <code>resize2fs</code> by hand.
      </Typography>
    </FormPage>
  )
}
