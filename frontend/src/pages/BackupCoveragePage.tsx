import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Typography,
} from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import FilterSelect from '../components/FilterSelect'
import SelectField from '../components/SelectField'
import { settle } from '../bulk'
import { usePermissions } from '../user'
import { api } from '../api/client'
import type { BackupGap } from '../api/client'

/**
 * The guests nothing backs up, and the one action worth taking on them.
 *
 * ITS OWN PAGE BECAUSE THE LIST IS LONG. This started as a row of chips
 * on the schedules page, which is a wall you read by scrolling and then
 * leave anyway to do anything about — so the alert there keeps the
 * number and this holds the names, the filters, and the button.
 *
 * ADDING TO AN EXISTING JOB IS THE DEFAULT ACTION, not creating a new
 * one. A lab that already runs a nightly job wants these guests in it;
 * a second job at a second time is how you end up with two retention
 * policies and no idea which applies.
 */
export default function BackupCoveragePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()
  const [picked, setPicked] = useState<string[]>([])
  const [matching, setMatching] = useState<string[]>([])
  const [hypervisor, setHypervisor] = useState('')
  const [node, setNode] = useState('')
  const [kind, setKind] = useState('')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { data: gaps = [], isLoading } = useQuery({
    queryKey: ['backupGaps'],
    queryFn: api.listBackupGaps,
  })
  const { data: hypervisors = [] } = useQuery({
    queryKey: ['hypervisors'],
    queryFn: api.listHypervisors,
  })
  const { data: schedules = [] } = useQuery({
    queryKey: ['backupSchedules'],
    queryFn: api.listBackupSchedules,
  })
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: api.listInstances })
  const { data: containers = [] } = useQuery({
    queryKey: ['containers'],
    queryFn: api.listContainers,
  })

  const nameOf = (id: string) => hypervisors.find((h) => h.id === id)?.name ?? id

  // THE NODE COMES FROM THE GUEST, not from the gap. The hypervisor
  // reports which guests no job covers and nothing else about them, so
  // the node — the thing worth filtering on — is joined from the
  // instance and container lists this console already holds.
  const nodeOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const i of instances) map.set(`${i.hypervisorId}/${i.driverId}`, i.node)
    for (const c of containers) map.set(`${c.hypervisorId}/${c.driverId}`, c.node)
    return map
  }, [instances, containers])

  const rows = useMemo(
    () =>
      gaps
        .map((g) => ({ ...g, node: nodeOf.get(`${g.hypervisorId}/${g.vmid}`) ?? '' }))
        .filter(
          (g) =>
            (hypervisor === '' || g.hypervisorId === hypervisor) &&
            (node === '' || g.node === node) &&
            (kind === '' || g.type === kind),
        ),
    [gaps, nodeOf, hypervisor, node, kind],
  )

  const rowID = (g: BackupGap) => `${g.hypervisorId}/${g.vmid}`
  const selected = rows.filter((g) => picked.includes(rowID(g)))

  // A GUEST CAN ONLY JOIN A JOB ON ITS OWN HYPERVISOR, so a selection
  // spanning two has no single answer — said out loud rather than
  // offering a picker that would write the wrong thing.
  const spans = [...new Set(selected.map((g) => g.hypervisorId))]
  const targetHypervisor = spans.length === 1 ? spans[0] : ''
  const jobs = schedules.filter((j) => j.hypervisorId === targetHypervisor && !j.all)

  const nodes = [...new Set(gaps.map((g) => nodeOf.get(`${g.hypervisorId}/${g.vmid}`) ?? ''))]
    .filter(Boolean)
    .sort()

  const add = useMutation({
    mutationFn: () =>
      settle([target], (id) =>
        api.addGuestsToBackupSchedule(
          targetHypervisor,
          id,
          selected.map((g) => g.vmid),
        ),
      ),
    onSuccess: () => {
      const n = selected.length
      setDone(`${n} guest${n === 1 ? '' : 's'} added.`)
      setPicked([])
      queryClient.invalidateQueries({ queryKey: ['backupGaps'] })
      queryClient.invalidateQueries({ queryKey: ['backupSchedules'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const columns = useMemo<ColumnDef<(typeof rows)[number], unknown>[]>(
    () => [
      { id: 'name', header: 'Guest', meta: { width: 260 }, accessorFn: (g) => g.name },
      { id: 'vmid', header: 'ID', meta: { nowrap: true }, accessorFn: (g) => g.vmid },
      {
        id: 'type',
        header: 'Type',
        meta: { nowrap: true },
        accessorFn: (g) => (g.type === 'lxc' ? 'Container' : 'VM'),
      },
      { id: 'node', header: 'Node', meta: { nowrap: true }, accessorFn: (g) => g.node || '—' },
      {
        id: 'hypervisor',
        header: 'Hypervisor',
        meta: { nowrap: true },
        accessorFn: (g) => nameOf(g.hypervisorId),
      },
    ],
    [hypervisors],
  )

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/compute/backup-schedules')}
        >
          Backup schedules
        </Button>
      </Box>
      <PageHeader title="Guests without a backup" />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 2 }}>
          {done}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <FilterSelect
          anyLabel="Any hypervisor"
          value={hypervisor}
          onChange={setHypervisor}
          options={hypervisors.map((h) => ({ value: h.id, label: h.name }))}
        />
        <FilterSelect
          anyLabel="Any node"
          value={node}
          onChange={setNode}
          options={nodes.map((n) => ({ value: n, label: n }))}
        />
        <FilterSelect
          anyLabel="VMs and containers"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'qemu', label: 'VMs' },
            { value: 'lxc', label: 'Containers' },
          ]}
        />
      </Box>

      {canEdit && selected.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            mb: 1,
            px: 1,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: 'surface.infoTint',
            borderColor: '#d2e3fc',
          }}
        >
          <IconButton size="small" aria-label="Clear selection" onClick={() => setPicked([])}>
            <CloseIcon fontSize="small" />
          </IconButton>
          <Typography sx={{ fontSize: 13, color: 'text.primary' }}>{selected.length}</Typography>
          {matching.length > selected.length && (
            <Button size="small" onClick={() => setPicked(matching)}>
              Select all {matching.length}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          {spans.length > 1 ? (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              A job only takes guests from its own hypervisor.
            </Typography>
          ) : jobs.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {nameOf(targetHypervisor)} has no job these can join —{' '}
              <Box
                component="span"
                sx={{ color: 'primary.main', cursor: 'pointer' }}
                onClick={() => navigate('/compute/backup-schedules/new')}
              >
                create one
              </Box>
            </Typography>
          ) : (
            <>
              <SelectField
                size="small"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                sx={{ minWidth: 280, bgcolor: 'background.paper' }}
              >
                <MenuItem value="">Add to which job?</MenuItem>
                {jobs.map((j) => (
                  <MenuItem key={j.id} value={j.id}>
                    {j.schedule} → {j.storage} ({j.vmids.length} guests)
                  </MenuItem>
                ))}
              </SelectField>
              <Button
                size="small"
                variant="contained"
                startIcon={<AddIcon />}
                disabled={target === '' || add.isPending}
                onClick={() => add.mutate()}
              >
                Add
              </Button>
            </>
          )}
        </Paper>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        selection={picked}
        onSelectionChange={setPicked}
        onFilteredChange={setMatching}
        getRowId={rowID}
        initialSort={[{ id: 'name', desc: false }]}
        filterPlaceholder="Filter by name or ID"
        empty={isLoading ? 'Loading…' : 'Every guest is covered by a schedule.'}
      />
    </Box>
  )
}
