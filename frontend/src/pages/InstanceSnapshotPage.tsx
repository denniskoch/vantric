import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, TextField, Typography } from '@mui/material'
import FormPage from '../components/FormPage'
import { api } from '../api/client'

/** Proxmox's own rule for a snapshot name. */
const snapshotNameRe = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

/**
 * Taking a snapshot.
 *
 * A page rather than a dialog for the reason every form here is one, and
 * because it has something to say: a snapshot of a RUNNING guest doesn't
 * capture memory unless you ask for it, so rolling back lands you at a
 * machine that was powered on and is now, from its own point of view,
 * recovering from a power cut.
 */
export default function InstanceSnapshotPage() {
  const { name = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [snapshotName, setSnapshotName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: instance } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name),
    enabled: Boolean(name),
  })

  const take = useMutation({
    mutationFn: () =>
      api.createInstanceSnapshot(name, {
        name: snapshotName,
        description: description || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      navigate(`/compute/instances/${encodeURIComponent(name)}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError =
    snapshotName && !snapshotNameRe.test(snapshotName)
      ? 'Letters, digits, hyphens and underscores, starting with a letter'
      : ''

  return (
    <FormPage
      title={`Snapshot ${name}`}
      backTo={`/compute/instances/${encodeURIComponent(name)}`}
      backLabel={name}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Take snapshot"
      primaryDisabled={!snapshotName || Boolean(nameError)}
      pending={take.isPending}
      onPrimary={() => {
        setError(null)
        take.mutate()
      }}
    >
      <TextField
        label="Name"
        value={snapshotName}
        onChange={(e) => setSnapshotName(e.target.value)}
        error={Boolean(nameError)}
        helperText={nameError || 'What you were about to change is a good name'}
        fullWidth
      />
      <TextField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        helperText="Optional"
        fullWidth
      />
      {instance?.status === 'RUNNING' && (
        <Alert severity="info">
          {name} is running, and this captures its disks but not its memory.
          Rolling back later gives you a machine that finds itself powered off —
          the same state as pulling the plug, which is fine for most things and
          not for a database mid-write.
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary">
        Snapshots live on the same storage as the disks they capture, and grow as
        the guest writes. They are not a backup.
      </Typography>
    </FormPage>
  )
}
