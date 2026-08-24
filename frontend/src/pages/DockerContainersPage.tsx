import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ArticleIcon from '@mui/icons-material/Article'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import FilterSelect from '../components/FilterSelect'
import CellLines from '../components/CellLines'
import { usePermissions } from '../user'
import { api } from '../api/client'
import type { DockerContainer } from '../api/client'
import ContainerLogsDialog from '../components/ContainerLogsDialog'

/**
 * Every container across every Docker host.
 *
 * STACK IS A COLUMN, NOT A PAGE. Compose grouping is derived from
 * labels the daemon itself doesn't understand, so it earns a column and
 * a filter; a page of its own would mostly be a count until there is a
 * compose file behind it to show.
 */
export default function DockerContainersPage() {
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()
  const [host, setHost] = useState('')
  const [stack, setStack] = useState('')
  const [state, setState] = useState('')
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<DockerContainer | null>(null)
  const [logsFor, setLogsFor] = useState<DockerContainer | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: hosts = [] } = useQuery({ queryKey: ['dockerHosts'], queryFn: api.listDockerHosts })
  const { data: containers = [], isLoading } = useQuery({
    queryKey: ['dockerContainers'],
    queryFn: api.listDockerContainers,
    refetchInterval: 10_000,
  })

  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? id
  // A host whose front door has writes disabled offers no actions, and
  // says so rather than failing when you press one.
  const writable = (id: string) => Boolean(hosts.find((h) => h.id === id)?.info?.writable)

  const act = useMutation({
    mutationFn: (v: { c: DockerContainer; action: string }) =>
      api.dockerContainerAction(v.c.hostId, v.c.id, v.action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dockerContainers'] }),
    onError: (e: Error) => setError(e.message),
  })

  const stacks = [...new Set(containers.map((c) => c.stack).filter(Boolean))].sort() as string[]
  const rows = containers.filter(
    (c) =>
      (host === '' || c.hostId === host) &&
      (stack === '' || c.stack === stack) &&
      (state === '' || c.state === state),
  )

  const columns = useMemo<ColumnDef<DockerContainer, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Container',
        meta: { width: 240 },
        accessorFn: (c) => c.name,
        cell: ({ row }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <StateDot container={row.original} />
            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {row.original.name}
            </Box>
          </Box>
        ),
      },
      {
        id: 'stack',
        header: 'Stack',
        meta: { width: 160 },
        accessorFn: (c) => c.stack ?? '',
        cell: ({ row }) =>
          row.original.stack ? (
            <Box>
              {row.original.stack}
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {row.original.service}
              </Typography>
            </Box>
          ) : (
            // Not every container is part of a stack — one started by
            // hand is ordinary, not a gap.
            <Box component="span" sx={{ color: 'text.disabled' }}>
              —
            </Box>
          ),
      },
      {
        id: 'status',
        header: 'Status',
        meta: { nowrap: true },
        accessorFn: (c) => c.status,
      },
      {
        id: 'image',
        header: 'Image',
        meta: { width: 260 },
        accessorFn: (c) => c.image,
        cell: ({ row }) => (
          <Box
            sx={{
              fontSize: 12,
              color: 'text.secondary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.original.image}
          </Box>
        ),
      },
      {
        id: 'ports',
        header: 'Ports',
        enableSorting: false,
        meta: { nowrap: true },
        accessorFn: (c) => c.ports.map((p) => p.public).join(' '),
        cell: ({ row }) =>
          row.original.ports.length === 0 ? (
            <Box component="span" sx={{ color: 'text.disabled' }}>
              —
            </Box>
          ) : (
            <CellLines>
              {row.original.ports.map((p) => (
                <span key={`${p.public}/${p.type}`}>
                  {p.public} → {p.private}
                  {p.type !== 'tcp' && `/${p.type}`}
                </span>
              ))}
            </CellLines>
          ),
      },
      {
        id: 'host',
        header: 'Host',
        meta: { nowrap: true },
        accessorFn: (c) => hostName(c.hostId),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { hug: true },
        cell: ({ row }) => (
          <IconButton
            size="small"
            aria-label={`Actions for ${row.original.name}`}
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
    [hosts],
  )

  const running = selected?.state === 'running'
  const mayAct = canEdit && Boolean(selected) && writable(selected!.hostId)

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Containers" />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <FilterSelect
          anyLabel="Any host"
          value={host}
          onChange={setHost}
          options={hosts.map((h) => ({ value: h.id, label: h.name }))}
        />
        <FilterSelect
          anyLabel="Any stack"
          value={stack}
          onChange={setStack}
          options={stacks.map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          anyLabel="Any state"
          value={state}
          onChange={setState}
          options={[
            { value: 'running', label: 'Running' },
            { value: 'exited', label: 'Exited' },
            { value: 'paused', label: 'Paused' },
            { value: 'restarting', label: 'Restarting' },
          ]}
        />
      </Box>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(c) => `${c.hostId}/${c.id}`}
        alignTop
        initialSort={[{ id: 'stack', desc: false }]}
        filterPlaceholder="Filter by container, stack, image or port"
        empty={isLoading ? 'Loading…' : 'No containers on any connected host.'}
      />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setLogsFor(selected)
            setMenuAnchor(null)
          }}
        >
          <ArticleIcon fontSize="small" sx={{ mr: 1 }} /> Logs
        </MenuItem>
        {/* The reason, not just a disabled row: a read-only front door
            is a deliberate setting on that host, not a fault here. */}
        <Tooltip
          title={
            selected && !writable(selected.hostId)
              ? `${hostName(selected.hostId)} is running read-only`
              : ''
          }
        >
          <span>
            <MenuItem
              disabled={!mayAct || running}
              onClick={() => {
                if (selected) act.mutate({ c: selected, action: 'start' })
                setMenuAnchor(null)
              }}
            >
              <PlayArrowIcon fontSize="small" sx={{ mr: 1 }} /> Start
            </MenuItem>
            <MenuItem
              disabled={!mayAct || !running}
              onClick={() => {
                if (selected) act.mutate({ c: selected, action: 'restart' })
                setMenuAnchor(null)
              }}
            >
              <RestartAltIcon fontSize="small" sx={{ mr: 1 }} /> Restart
            </MenuItem>
            <MenuItem
              disabled={!mayAct || !running}
              onClick={() => {
                if (selected) act.mutate({ c: selected, action: 'stop' })
                setMenuAnchor(null)
              }}
              sx={{ color: 'error.main' }}
            >
              <StopIcon fontSize="small" sx={{ mr: 1 }} /> Stop
            </MenuItem>
          </span>
        </Tooltip>
      </Menu>

      <ContainerLogsDialog container={logsFor} onClose={() => setLogsFor(null)} />
    </Box>
  )
}

/**
 * State as a dot, with health folded in.
 *
 * THREE STATES, NOT TWO. A running container with a failing healthcheck
 * is not the same as a stopped one and not the same as a healthy one —
 * and a container with NO healthcheck is none of those, so it gets the
 * plain running colour rather than being counted as unhealthy for not
 * being asked.
 */
function StateDot({ container }: { container: DockerContainer }) {
  const { state, health } = container
  const colour =
    state !== 'running'
      ? '#9aa0a6'
      : health === 'unhealthy'
        ? '#d93025'
        : health === 'starting'
          ? '#e37400'
          : '#1e8e3e'
  const label = health ? `${state} (${health})` : state
  return (
    <Tooltip title={label}>
      <Box
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colour, flexShrink: 0 }}
        aria-label={label}
      />
    </Tooltip>
  )
}
