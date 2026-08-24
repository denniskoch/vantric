import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import AddIcon from '@mui/icons-material/Add'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import CellLines from '../components/CellLines'
import EnabledIcon from '../components/EnabledIcon'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'
import { api } from '../api/client'
import type { BackupSchedule } from '../api/client'

/**
 * The hypervisor's own backup jobs.
 *
 * THIS CONSOLE KEEPS NO SCHEDULE AND RUNS NOTHING. A job made here is
 * the same job the hypervisor's own UI shows, which is the whole
 * difference between managing a tool and replacing it — turn this
 * console off and your backups carry on.
 *
 * WHAT IS COVERED BY NOTHING LEADS THE PAGE, because it is the one
 * question the job list can't answer by being read. A job saying
 * "everything except these three" and a job naming fifteen guests are
 * the same coverage wearing different clothes, so the hypervisor is
 * asked instead — and on this lab the answer was 28 guests, including
 * the monitoring VM, the WireGuard VM and this console.
 */
export default function BackupSchedulesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<BackupSchedule | null>(null)
  const [deleting, setDeleting] = useState<BackupSchedule | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['backupSchedules'],
    queryFn: api.listBackupSchedules,
  })
  const { data: gaps = [] } = useQuery({
    queryKey: ['backupGaps'],
    queryFn: api.listBackupGaps,
  })
  const remove = useMutation({
    mutationFn: (job: BackupSchedule) => api.deleteBackupSchedule(job.hypervisorId, job.id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['backupSchedules'] })
      queryClient.invalidateQueries({ queryKey: ['backupGaps'] })
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  const columns = useMemo<ColumnDef<BackupSchedule, unknown>[]>(
    () => [
      {
        id: 'schedule',
        header: 'Runs',
        meta: { width: 150 },
        accessorFn: (j) => j.schedule,
        cell: ({ row }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <EnabledIcon
              enabled={row.original.enabled}
              on="Enabled"
              off="Disabled — this job does not run"
            />
            <span>{row.original.schedule}</span>
          </Box>
        ),
      },
      {
        id: 'nextRun',
        header: 'Next run',
        meta: { nowrap: true },
        accessorFn: (j) => j.nextRun,
        cell: ({ row }) =>
          row.original.nextRun > 0 ? (
            new Date(row.original.nextRun * 1000).toLocaleString()
          ) : (
            // A disabled job has no next run, and the hypervisor says so
            // by omitting it. Repeating the reason beats a dash.
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              not scheduled
            </Typography>
          ),
      },
      {
        id: 'covers',
        header: 'Covers',
        meta: {
          nowrap: true,
          // Searchable by vmid even though no vmid is drawn: somebody
          // who knows a guest is 2030 should still find the job that
          // holds it.
          filterText: (j: BackupSchedule) => j.vmids.join(' '),
        },
        enableSorting: false,
        accessorFn: (j) => (j.all ? -1 : j.vmids.length),
        cell: ({ row }) => <Covers job={row.original} />,
      },
      {
        id: 'storage',
        header: 'Writes to',
        meta: { nowrap: true },
        accessorFn: (j) => j.storage,
      },
      {
        id: 'retention',
        header: 'Keeps',
        meta: { nowrap: true },
        accessorFn: (j) => j.retention,
        cell: ({ row }) =>
          row.original.retention ? (
            <CellLines>
              {row.original.retention.split(',').map((rule) => (
                <span key={rule}>{rule.trim()}</span>
              ))}
            </CellLines>
          ) : (
            // NOT A BLANK. A job with no pruning keeps every archive it
            // ever wrote, which fills the datastore and then starts
            // failing — quietly, since the job itself looks fine.
            <Typography component="span" sx={{ fontSize: 12, color: '#e37400' }}>
              everything
            </Typography>
          ),
      },
      {
        id: 'mode',
        header: 'Mode',
        meta: { nowrap: true },
        accessorFn: (j) => j.mode,
      },
      {
        id: 'node',
        header: 'Node',
        meta: { nowrap: true },
        accessorFn: (j) => j.node,
        cell: ({ row }) => row.original.node || '—',
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { hug: true },
        cell: ({ row }) => (
          <IconButton
            size="small"
            aria-label={`Actions for ${row.original.id}`}
            onClick={(e) => {
              setMenuAnchor(e.currentTarget)
              setSelected(row.original)
            }}
          >
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
        ),
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Backup schedules"
        description="The backup jobs your hypervisors run. Edited here, kept there."
        actions={
          canEdit && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => navigate('/compute/backup-schedules/new')}
            >
              Create
            </Button>
          )
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* THE FINDING, NOT THE LIST. Twenty-eight names in chips is a
          wall you read by scrolling and act on by going somewhere else
          anyway — so the alert says the number and hands you the page
          that can do something about it. */}
      {gaps.length > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button
              size="small"
              color="inherit"
              onClick={() => navigate('/compute/backup-schedules/coverage')}
            >
              Review
            </Button>
          }
        >
          {gaps.length} guest{gaps.length === 1 ? '' : 's'} no schedule covers
        </Alert>
      )}

      <DataTable
        rows={schedules}
        columns={columns}
        getRowId={(j) => `${j.hypervisorId}/${j.id}`}
        alignTop
        initialSort={[{ id: 'schedule', desc: false }]}
        filterPlaceholder="Filter by schedule or storage"
        empty={isLoading ? 'Loading…' : 'No backup schedules on any hypervisor.'}
      />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          disabled={!canEdit}
          onClick={() => {
            if (selected)
              navigate(
                `/compute/backup-schedules/${selected.id}/edit?hypervisor=${selected.hypervisorId}`,
              )
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          disabled={!canEdit}
          onClick={() => {
            setDeleting(selected)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title="Delete this backup schedule?"
        body={
          <>
            The guests it covered stop being backed up. Existing archives are kept.
          </>
        }
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Box>
  )
}

/**
 * What a job backs up — HOW MANY, not which.
 *
 * This printed the vmid list underneath, which on a job covering
 * twenty-five guests is five lines of four-digit numbers that name
 * nothing. A vmid is an identifier you look a guest up BY, not one you
 * recognise a guest FROM. Opening the job shows the names against
 * checkboxes, which is where that question gets a real answer.
 */
function Covers({ job }: { job: BackupSchedule }) {
  if (job.all) {
    return (
      <>
        Every guest
        {job.exclude.length > 0 && ` except ${job.exclude.length}`}
      </>
    )
  }
  if (job.pool) return <>Pool {job.pool}</>
  return (
    <>
      {job.vmids.length} guest{job.vmids.length === 1 ? '' : 's'}
    </>
  )
}
