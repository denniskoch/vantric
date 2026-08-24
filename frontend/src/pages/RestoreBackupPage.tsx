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
  Radio,
  RadioGroup,
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
 * TWO ANSWERS, AND NEITHER MENTIONS A GUEST ID. This asked for one at
 * first, prefilled with the next free number, which is what Proxmox's
 * own dialog does — and it is wrong here for the reason machine types
 * were: a vmid is an artefact of the hypervisor, and every other page
 * in this console names guests instead of numbering them. Veeam, Azure
 * Backup and AWS Backup all ask the same two questions this does.
 *
 * A NAME IS REQUIRED FOR A NEW GUEST, and not for tidiness: restoring
 * alongside a guest that still exists would otherwise produce two of
 * them answering to one name, and instance names here are unique.
 */
export default function RestoreBackupPage() {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const hypervisorId = search.get('hypervisor') ?? ''
  const volumeId = search.get('volume') ?? ''

  const [mode, setMode] = useState<'new' | 'replace'>('new')
  const [name, setName] = useState('')
  const [storage, setStorage] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [start, setStart] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: backups = [] } = useQuery({ queryKey: ['backups'], queryFn: api.listBackups })
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: api.listInstances })
  const { data: containers = [] } = useQuery({ queryKey: ['containers'], queryFn: api.listContainers })
  const { data: datastores = [] } = useQuery({ queryKey: ['datastores'], queryFn: api.listDatastores })

  const archive = backups.find((b) => b.hypervisorId === hypervisorId && b.id === volumeId)

  // The guest this archive came from, if it is still there. Its absence
  // is why "replace" is not always on offer: a backup outlives its
  // guest, and that is the case restores exist for.
  const original =
    archive &&
    [...instances, ...containers].find(
      (g) => g.hypervisorId === hypervisorId && g.driverId === String(archive.vmid),
    )
  const originalRunning = original?.status === 'RUNNING' || original?.status === 'STAGING'

  useEffect(() => {
    if (archive && name === '') setName(`${archive.guestName || archive.vmid}-restored`)
  }, [archive])

  const taken = [...instances, ...containers].some((g) => g.name === name.trim())
  const isContainer = archive?.guestType === 'lxc'

  const restore = useMutation({
    mutationFn: () =>
      api.restoreBackup({ hypervisorId, volumeId, mode, name, storage, start }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      navigate('/compute/instances')
    },
    onError: (e: Error) => setError(e.message),
  })

  const storageOK = !isContainer || storage !== ''
  const ready =
    storageOK &&
    (mode === 'new'
      ? name.trim() !== '' && !taken
      : Boolean(original) && !originalRunning && confirmName === original?.name)

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
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
          <Typography sx={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>
            {archive?.name ?? volumeId}
          </Typography>
          {archive && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
              {formatBytes(archive.sizeBytes)}
              {archive.createdAt
                ? `, taken ${new Date(archive.createdAt * 1000).toLocaleString()}`
                : ''}
              {archive.guestName ? `, from ${archive.guestName}` : ''}
            </Typography>
          )}
        </Box>

        <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'replace')}>
          <FormControlLabel
            value="new"
            control={<Radio size="small" />}
            label={<Typography sx={{ fontSize: 14 }}>Restore as a new guest</Typography>}
          />
          {mode === 'new' && (
            <Box sx={{ pl: 4, pb: 1 }}>
              <TextField
                label="Name"
                size="small"
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={taken}
                helperText={taken ? 'That name is taken' : ' '}
              />
            </Box>
          )}

          {/* Only where there is something to replace. A backup outlives
              its guest, and that is the case this page exists for. */}
          <FormControlLabel
            value="replace"
            disabled={!original}
            control={<Radio size="small" />}
            label={
              <Typography sx={{ fontSize: 14 }}>
                {original ? `Replace ${original.name}` : 'Replace the original'}
                {!original && (
                  <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 1 }}>
                    it no longer exists
                  </Typography>
                )}
              </Typography>
            }
          />
        </RadioGroup>

        {mode === 'replace' && original && (
          <Alert severity="warning">
            <Typography sx={{ fontSize: 13, mb: 1 }}>
              {original.name} and its disks are deleted first.
            </Typography>
            {originalRunning ? (
              <Typography sx={{ fontSize: 13}}>It is running. Stop it first.</Typography>
            ) : (
              <TextField
                size="small"
                fullWidth
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                label={`Type ${original.name} to confirm`}
                sx={{ bgcolor: 'background.paper' }}
              />
            )}
          </Alert>
        )}

        {/* A CONTAINER HAS TO BE TOLD. Omitting this on a VM restore
            puts the disks back where the archive says; a container
            restore defaults to `local` instead and fails there. The
            pools differ too — a container needs rootdir, a VM images. */}
        <SelectField
          label="Storage"
          size="small"
          fullWidth
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
          error={isContainer && storage === ''}
          helperText={isContainer && storage === '' ? 'Required for a container' : ' '}
        >
          {!isContainer && <MenuItem value="">Same as the backup</MenuItem>}
          {isContainer && <MenuItem value="">Pick one</MenuItem>}
          {datastores
            .filter(
              (d) =>
                d.hypervisorId === hypervisorId &&
                (d.content ?? '').includes(isContainer ? 'rootdir' : 'images'),
            )
            .map((d) => (
              <MenuItem key={d.name} value={d.name}>
                {d.name}
              </MenuItem>
            ))}
        </SelectField>

        <FormControlLabel
          control={<Checkbox checked={start} onChange={(e) => setStart(e.target.checked)} />}
          label={
            <Typography sx={{ fontSize: 14 }}>
              Start after restoring
              {mode === 'new' && (
                <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 1 }}>
                  it may hold the original's address and hostname
                </Typography>
              )}
            </Typography>
          }
        />
      </Paper>

      <Box
        sx={{ display: 'flex', gap: 1, pt: 2, mt: 2, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <Button
          variant="contained"
          color={mode === 'replace' ? 'error' : 'primary'}
          disabled={!ready || restore.isPending}
          onClick={() => restore.mutate()}
        >
          {mode === 'replace' ? `Replace ${original?.name ?? ''}` : 'Restore'}
        </Button>
        <Button onClick={() => navigate('/compute/backups')}>Cancel</Button>
      </Box>
    </Box>
  )
}
