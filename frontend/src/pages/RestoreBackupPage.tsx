import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import SelectField from '../components/SelectField'
import { formatBytes } from '../format'

/**
 * Turning an archive back into a guest.
 *
 * A PAGE, NOT A DIALOG, and not only because of the house rule: this is
 * the form with the most dangerous checkbox in the console on it, and a
 * dialog is where people click through without reading.
 *
 * THE SAFE RESTORE IS THE DEFAULT. It arrives with a free guest id
 * already filled in, so the thing that happens if you press Restore
 * without touching anything is a second guest beside the original —
 * which cannot lose data and is what you want most of the time.
 * Replacing the original is a deliberate second choice that makes you
 * type its name.
 */
export default function RestoreBackupPage() {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const hypervisorId = search.get('hypervisor') ?? ''
  const volumeId = search.get('volume') ?? ''
  const node = search.get('node') ?? ''

  const [vmid, setVMID] = useState('')
  const [storage, setStorage] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [start, setStart] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: backups = [] } = useQuery({ queryKey: ['backups'], queryFn: api.listBackups })
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: api.listInstances })
  const { data: datastores = [] } = useQuery({ queryKey: ['datastores'], queryFn: api.listDatastores })
  const { data: free } = useQuery({
    queryKey: ['nextVMID', hypervisorId],
    queryFn: () => api.nextVMID(hypervisorId),
    enabled: hypervisorId !== '',
  })

  const archive = backups.find((b) => b.hypervisorId === hypervisorId && b.id === volumeId)

  // The free id, once, as the starting value — not as a live default,
  // or a background refetch would overwrite what somebody typed.
  useEffect(() => {
    if (free && vmid === '') setVMID(String(free.vmid))
  }, [free])

  // What is at the id being restored onto, if anything. This is the
  // whole difference between "a second copy" and "that guest is gone".
  const target = instances.find(
    (i) => i.hypervisorId === hypervisorId && i.driverId === vmid.trim(),
  )
  const targetRunning = target?.status === 'RUNNING' || target?.status === 'STAGING'

  const restore = useMutation({
    mutationFn: () =>
      api.restoreBackup({
        hypervisorId,
        node,
        volumeId,
        guestType: archive?.guestType ?? 'qemu',
        vmid: Number(vmid),
        storage,
        overwrite,
        start,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      navigate('/compute/instances')
    },
    onError: (e: Error) => setError(e.message),
  })

  const idValid = /^\d+$/.test(vmid.trim()) && Number(vmid) > 0
  const namedCorrectly = !target || !overwrite || confirmName === target.name
  const ready = idValid && (!target || overwrite) && namedCorrectly && !targetRunning

  return (
    <Box sx={{ p: 3, maxWidth: 760 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/compute/backups')}>
          Backups
        </Button>
      </Box>
      <PageHeader title="Restore backup" />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
        <Box>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Restoring</Typography>
          <Typography sx={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>
            {archive?.name ?? volumeId}
          </Typography>
          {archive && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
              {formatBytes(archive.sizeBytes)}
              {archive.createdAt
                ? `, taken ${new Date(archive.createdAt * 1000).toLocaleString()}`
                : ''}
              {archive.guestName ? ` from ${archive.guestName}` : ''} · {archive.guestType} ·{' '}
              {node}
            </Typography>
          )}
        </Box>

        <TextField
          label="Restore as guest ID"
          size="small"
          fullWidth
          value={vmid}
          onChange={(e) => {
            setVMID(e.target.value)
            setOverwrite(false)
            setConfirmName('')
          }}
          error={vmid !== '' && !idValid}
          helperText={
            !idValid && vmid !== ''
              ? 'A guest id is a number'
              : target
                ? `In use by ${target.name}`
                : free
                  ? `${free.vmid} is free`
                  : ' '
          }
        />

        <SelectField
          label="Storage"
          size="small"
          fullWidth
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
        >
          <MenuItem value="">Same as the backup</MenuItem>
          {datastores
            .filter((d) => d.hypervisorId === hypervisorId && (d.content ?? '').includes('images'))
            .map((d) => (
              <MenuItem key={d.name} value={d.name}>
                {d.name}
              </MenuItem>
            ))}
        </SelectField>

        {/* THE DANGEROUS PATH, and it only appears once the id you typed
            actually belongs to something. Offering it against a free id
            would be offering to overwrite nothing. */}
        {target && (
          <Alert severity="warning">
            <Typography sx={{ fontSize: 13, mb: 1 }}>
              Restoring over <strong>{target.name}</strong> deletes it and its disks first.
            </Typography>
            {targetRunning ? (
              // The same rule instance deletion follows: destroying
              // disks under a running machine is refused, not warned
              // about.
              <Typography sx={{ fontSize: 13 }}>
                It is running. Stop it, or pick a free guest ID.
              </Typography>
            ) : (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={overwrite}
                      onChange={(e) => {
                        setOverwrite(e.target.checked)
                        setConfirmName('')
                      }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: 14 }}>Replace {target.name}</Typography>
                  }
                />
                {overwrite && (
                  <TextField
                    size="small"
                    fullWidth
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={target.name}
                    label={`Type ${target.name} to confirm`}
                    sx={{ mt: 1, bgcolor: 'background.paper' }}
                  />
                )}
              </>
            )}
          </Alert>
        )}

        {/* OFF BY DEFAULT, unlike a create. A restored guest can carry
            the same address, hostname and cluster identity as one still
            running, and two of those on a network is its own outage. */}
        <FormControlLabel
          control={<Checkbox checked={start} onChange={(e) => setStart(e.target.checked)} />}
          label={
            <Typography sx={{ fontSize: 14 }}>
              Start after restoring
              <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 1 }}>
                it may hold the original's address and hostname
              </Typography>
            </Typography>
          }
        />
      </Paper>

      <Box
        sx={{ display: 'flex', gap: 1, pt: 2, mt: 2, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <Button
          variant="contained"
          color={overwrite ? 'error' : 'primary'}
          disabled={!ready || restore.isPending}
          onClick={() => restore.mutate()}
        >
          {overwrite ? `Replace ${target?.name}` : 'Restore'}
        </Button>
        <Button onClick={() => navigate('/compute/backups')}>Cancel</Button>
      </Box>
    </Box>
  )
}
