import { useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material'
import FormPage from '../components/FormPage'
import SelectField from '../components/SelectField'
import { api } from '../api/client'

/**
 * One backup, taken now.
 *
 * THE SCHEDULE IS NOT ENOUGH ON ITS OWN. The nightly job runs at 21:00;
 * the moment you want a restore point is the ten minutes before you
 * upgrade something. Same vzdump, same archive, same list — only the
 * trigger differs.
 */
export default function TakeBackupPage() {
  const { name = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Containers and instances share this page because they share the
  // call; which one is in the path is which one this is.
  const kind = location.pathname.startsWith('/compute/containers') ? 'containers' : 'instances'
  const back = `/compute/${kind}/${encodeURIComponent(name)}`

  const [storage, setStorage] = useState('')
  const [mode, setMode] = useState('snapshot')
  const [notes, setNotes] = useState('')
  const [keep, setKeep] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: api.listInstances })
  const { data: containers = [] } = useQuery({ queryKey: ['containers'], queryFn: api.listContainers })
  const { data: datastores = [] } = useQuery({ queryKey: ['datastores'], queryFn: api.listDatastores })

  const guest = [...instances, ...containers].find((g) => g.name === name)
  const pools = datastores.filter(
    (d) => d.hypervisorId === guest?.hypervisorId && (d.content ?? '').includes('backup'),
  )

  const take = useMutation({
    mutationFn: () =>
      api.takeBackup(kind, name, { storage, mode, notes, protected: keep }),
    onSuccess: () => {
      // The archive isn't written yet — the bell follows the task.
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      navigate(back)
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <FormPage
      title={`Back up ${name}`}
      backTo={back}
      backLabel={name}
      error={error}
      onDismissError={() => setError(null)}
      primaryLabel="Take backup"
      primaryDisabled={storage === ''}
      pending={take.isPending}
      onPrimary={() => {
        setError(null)
        take.mutate()
      }}
    >
      <SelectField
        label="Write to"
        value={storage}
        onChange={(e) => setStorage(e.target.value)}
        fullWidth
      >
        <MenuItem value="">Pick one</MenuItem>
        {pools.map((d) => (
          <MenuItem key={d.name} value={d.name}>
            {d.name}
          </MenuItem>
        ))}
      </SelectField>

      <SelectField label="Mode" value={mode} onChange={(e) => setMode(e.target.value)} fullWidth>
        <MenuItem value="snapshot">Snapshot</MenuItem>
        <MenuItem value="suspend">Suspend</MenuItem>
        <MenuItem value="stop">Stop</MenuItem>
      </SelectField>

      <TextField
        label="Note"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        helperText="Optional. What you were about to change is a good note."
        fullWidth
      />

      {/* ON BY DEFAULT, unlike a scheduled job's archives. The reason to
          take one by hand is that something is about to happen, which is
          exactly the archive a keep-daily rule should not quietly prune
          in a fortnight. */}
      <FormControlLabel
        control={<Checkbox checked={keep} onChange={(e) => setKeep(e.target.checked)} />}
        label={
          <Typography sx={{ fontSize: 14 }}>
            Keep regardless of retention
          </Typography>
        }
      />

      {guest?.status === 'RUNNING' && mode !== 'snapshot' && (
        <Typography variant="body2" color="text.secondary">
          {name} is running and this {mode === 'stop' ? 'stops' : 'suspends'} it while the
          backup is written.
        </Typography>
      )}
    </FormPage>
  )
}
