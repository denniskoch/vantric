import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
import ScheduleBuilder from '../components/ScheduleBuilder'
import RetentionBuilder from '../components/RetentionBuilder'

/**
 * A backup job, written into the hypervisor.
 *
 * THE SCHEDULE IS CHECKED BY THE THING THAT WILL RUN IT. A systemd
 * calendar event has a grammar this console has no business
 * reimplementing, and "sat 2:00" versus "sat 02:00" is exactly the
 * mistake you find out about a week later. So the field is sent to the
 * hypervisor as it is typed and the next five runs come back — which
 * both validates it and answers the question you actually had.
 *
 * GUESTS ARE PICKED, NOT TYPED. A vmid is four digits with no feedback
 * if you get one wrong; the picker lists what is there, marks what
 * nothing else covers, and sends the numbers.
 */
export default function BackupScheduleFormPage() {
  const { id } = useParams<{ id: string }>()
  const [search] = useSearchParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [hypervisorID, setHypervisorID] = useState(search.get('hypervisor') ?? '')
  const [enabled, setEnabled] = useState(true)
  const [schedule, setSchedule] = useState('')
  const [storage, setStorage] = useState('')
  const [mode, setMode] = useState('snapshot')
  const [all, setAll] = useState(false)
  const [vmids, setVMIDs] = useState<number[]>([])
  const [retention, setRetention] = useState('keep-daily=14')
  const [notesTemplate, setNotesTemplate] = useState('{{guestname}}')
  const [mailTo, setMailTo] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: hypervisors = [] } = useQuery({
    queryKey: ['hypervisors'],
    queryFn: api.listHypervisors,
  })
  const { data: existing } = useQuery({
    queryKey: ['backupSchedules'],
    queryFn: api.listBackupSchedules,
    enabled: editing,
    select: (all) => all.find((j) => j.id === id),
  })
  const { data: datastores = [] } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
  })
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: api.listInstances })
  const { data: containers = [] } = useQuery({
    queryKey: ['containers'],
    queryFn: api.listContainers,
  })
  const { data: gaps = [] } = useQuery({ queryKey: ['backupGaps'], queryFn: api.listBackupGaps })

  useEffect(() => {
    if (!existing) return
    setHypervisorID(existing.hypervisorId)
    setEnabled(existing.enabled)
    setSchedule(existing.schedule)
    setStorage(existing.storage)
    setMode(existing.mode || 'snapshot')
    setAll(existing.all)
    setVMIDs(existing.vmids)
    setRetention(existing.retention)
    setNotesTemplate(existing.notesTemplate)
    setMailTo(existing.mailTo)
    setComment(existing.comment)
  }, [existing])

  // The hypervisor's own reading of the expression, which is both the
  // validation and the answer. Debounced by the query key settling.
  const { data: preview, error: previewError } = useQuery({
    queryKey: ['backupSchedulePreview', hypervisorID, schedule],
    queryFn: () => api.previewBackupSchedule(hypervisorID, schedule),
    enabled: hypervisorID !== '' && schedule.trim() !== '',
    retry: false,
  })

  // Guests on the chosen hypervisor, containers included: a backup job
  // covers both, and a picker that showed only VMs would quietly make
  // half the lab uncoverable.
  // driverId IS the vmid on Proxmox, as a string. One that isn't a
  // number belongs to a backend that doesn't identify guests this way,
  // and is left out rather than rendered as NaN.
  const guests = [
    ...instances.map((i) => ({ ...i, kind: 'VM' })),
    ...containers.map((c) => ({ ...c, kind: 'Container' })),
  ]
    .filter((g) => g.hypervisorId === hypervisorID && /^\d+$/.test(g.driverId))
    .map((g) => ({ vmid: Number(g.driverId), name: g.name, type: g.kind }))
    .sort((a, b) => a.vmid - b.vmid)

  const uncovered = new Set(
    gaps.filter((g) => g.hypervisorId === hypervisorID).map((g) => g.vmid),
  )

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        enabled,
        schedule: schedule.trim(),
        storage,
        node: '',
        mode,
        all,
        vmids: all ? [] : vmids,
        exclude: [],
        pool: '',
        retention: retention.trim(),
        compress: 'zstd',
        notesTemplate,
        mailTo: mailTo.trim(),
        comment: comment.trim(),
      }
      if (editing) await api.updateBackupSchedule(hypervisorID, id!, body)
      else await api.createBackupSchedule(hypervisorID, body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backupSchedules'] })
      queryClient.invalidateQueries({ queryKey: ['backupGaps'] })
      navigate('/compute/backup-schedules')
    },
    onError: (e: Error) => setError(e.message),
  })

  const complete =
    hypervisorID !== '' &&
    schedule.trim() !== '' &&
    storage !== '' &&
    (all || vmids.length > 0)

  return (
    <Box sx={{ p: 3, maxWidth: 760 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/compute/backup-schedules')}
        >
          Backup schedules
        </Button>
      </Box>
      <PageHeader title={editing ? 'Edit backup schedule' : 'Create backup schedule'} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
        <SelectField
          label="Hypervisor"
          size="small"
          fullWidth
          value={hypervisorID}
          disabled={editing}
          onChange={(e) => {
            setHypervisorID(e.target.value)
            // Storage and guests belong to the hypervisor that was
            // chosen, so they can't survive changing it.
            setStorage('')
            setVMIDs([])
          }}
          helperText={editing ? 'A job belongs to the hypervisor that runs it.' : undefined}
        >
          <MenuItem value="">Pick one</MenuItem>
          {hypervisors.map((h) => (
            <MenuItem key={h.id} value={h.id}>
              {h.name}
            </MenuItem>
          ))}
        </SelectField>

        <Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            label="Schedule"
            size="small"
            fullWidth
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            error={Boolean(schedule.trim() && previewError)}
            helperText={
              schedule.trim() && previewError
                ? "The hypervisor doesn't recognise that"
                : 'A calendar event: 21:00, sat 02:00, mon..fri 03:30.'
            }
          />
          {/* Beside the field, not instead of it: the builder covers
              what people schedule, the field covers what Proxmox
              accepts. */}
          <ScheduleBuilder onPick={setSchedule} />
          </Box>
          {preview && preview.length > 0 && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
              Next: {preview.slice(0, 3).map((t) => new Date(t).toLocaleString()).join(' · ')}
            </Typography>
          )}
        </Box>

        <SelectField
          label="Write to"
          size="small"
          fullWidth
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
          disabled={hypervisorID === ''}
        >
          <MenuItem value="">Pick one</MenuItem>
          {datastores
            // Only the pools on this hypervisor that can hold a backup:
            // pointing a job at a pool that takes images produces a job
            // that fails on its first run.
            .filter(
              (d) => d.hypervisorId === hypervisorID && (d.content ?? '').includes('backup'),
            )
            .map((d) => (
              <MenuItem key={d.name} value={d.name}>
                {d.name}
              </MenuItem>
            ))}
        </SelectField>

        <SelectField
          label="Mode"
          size="small"
          fullWidth
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          helperText="Snapshot keeps the guest running. Stop and suspend do not."
        >
          <MenuItem value="snapshot">Snapshot</MenuItem>
          <MenuItem value="suspend">Suspend</MenuItem>
          <MenuItem value="stop">Stop</MenuItem>
        </SelectField>

        <Box>
          <FormControlLabel
            control={<Checkbox checked={all} onChange={(e) => setAll(e.target.checked)} />}
            label="Back up every guest on this hypervisor"
            slotProps={{ typography: { sx: { fontSize: 14 } } }}
          />
          {!all && (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontSize: 13, mb: 1 }}>
                Guests {vmids.length > 0 && `(${vmids.length} selected)`}
              </Typography>
              <Paper
                variant="outlined"
                sx={{ maxHeight: 260, overflow: 'auto', px: 1, py: 0.5 }}
              >
                {hypervisorID === '' ? (
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', p: 1 }}>
                    Pick a hypervisor first.
                  </Typography>
                ) : (
                  guests.map((g) => (
                    <FormControlLabel
                      key={g.vmid}
                      sx={{ display: 'flex', ml: 0 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={vmids.includes(g.vmid)}
                          onChange={(e) =>
                            setVMIDs((current) =>
                              e.target.checked
                                ? [...current, g.vmid]
                                : current.filter((v) => v !== g.vmid),
                            )
                          }
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13 }}>
                          <Box component="span" sx={{ color: 'text.disabled', width: 42 }}>
                            {g.vmid}
                          </Box>
                          {g.name}
                          {/* The one thing this picker knows that the
                              hypervisor's own doesn't: which of these
                              nothing is backing up today. */}
                          {uncovered.has(g.vmid) && (
                            <Box component="span" sx={{ fontSize: 11, color: '#e37400' }}>
                              not covered
                            </Box>
                          )}
                        </Box>
                      }
                    />
                  ))
                )}
              </Paper>
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            label="Keep"
            size="small"
            fullWidth
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            error={retention.trim() === ''}
            helperText={
              retention.trim()
                ? "The hypervisor's own pruning rules, comma separated."
                : 'Nothing is pruned — every archive is kept until the datastore fills.'
            }
          />
          <RetentionBuilder value={retention} onPick={setRetention} />
        </Box>
        <TextField
          label="Notes template"
          size="small"
          fullWidth
          value={notesTemplate}
          onChange={(e) => setNotesTemplate(e.target.value)}
          helperText="What each archive is labelled with. {{guestname}} is the usual."
        />
        <TextField
          label="Email results to"
          size="small"
          fullWidth
          value={mailTo}
          onChange={(e) => setMailTo(e.target.value)}
          helperText="Optional."
        />
        <TextField
          label="Comment"
          size="small"
          fullWidth
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          helperText="Optional."
        />
        <FormControlLabel
          control={<Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
          label="Enabled"
          slotProps={{ typography: { sx: { fontSize: 14 } } }}
        />
      </Paper>

      <Box
        sx={{
          display: 'flex',
          gap: 1,
          pt: 2,
          mt: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Button
          variant="contained"
          disabled={!complete || save.isPending}
          onClick={() => save.mutate()}
        >
          {editing ? 'Save' : 'Create'}
        </Button>
        <Button onClick={() => navigate('/compute/backup-schedules')}>Cancel</Button>
        {!complete && (
          <Typography sx={{ alignSelf: 'center', fontSize: 12, color: 'text.secondary' }}>
            A hypervisor, a schedule, somewhere to write, and something to back up
          </Typography>
        )}
      </Box>
    </Box>
  )
}
