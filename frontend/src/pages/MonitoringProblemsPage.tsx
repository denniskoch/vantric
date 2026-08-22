import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Chip, Link, Typography } from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import FilterSelect from '../components/FilterSelect'
import { api } from '../api/client'
import type { MonitoringProblem } from '../api/client'

/**
 * What the monitoring service says is on fire, worst first.
 *
 * Severity is Zabbix's own vocabulary, shown as its words — mapping
 * them onto ours would be deciding what Zabbix meant. Suppressed
 * problems are SHOWN, muted, rather than dropped: a maintenance window
 * is somebody's plan, and a console that hides the problem re-alerts
 * on it the moment the window ends.
 *
 * The empty state is an explicit all-clear. "Nothing is wrong" is a
 * claim this page makes on the service's authority, and an empty box
 * would make it by accident.
 */
export default function MonitoringProblemsPage() {
  const [severity, setSeverity] = useState('')

  const { data: providers = [] } = useQuery({
    queryKey: ['monitoringProviders'],
    queryFn: api.listMonitoringProviders,
  })
  const connected = providers.length > 0
  const { data: problems = [], isLoading, error } = useQuery({
    queryKey: ['monitoringProblems'],
    queryFn: api.listMonitoringProblems,
    enabled: connected,
    refetchInterval: 30_000,
  })

  const shown = useMemo(
    () => (severity ? problems.filter((p) => p.severity === severity) : problems),
    [problems, severity],
  )
  const severities = useMemo(
    () => [...new Set(problems.map((p) => p.severity))],
    [problems],
  )

  const columns = useMemo<ColumnDef<MonitoringProblem, unknown>[]>(
    () => [
      {
        id: 'severity',
        header: 'Severity',
        meta: { nowrap: true, hug: true },
        accessorFn: (p) => p.rank,
        cell: ({ row }) => <Severity problem={row.original} />,
      },
      {
        id: 'name',
        header: 'Problem',
        accessorFn: (p) => p.name,
        cell: ({ row }) => (
          <Typography
            component="span"
            sx={{ fontSize: 13, color: row.original.suppressed ? 'text.secondary' : undefined }}
          >
            {row.original.name}
          </Typography>
        ),
      },
      {
        id: 'host',
        header: 'Host',
        meta: { nowrap: true },
        accessorFn: (p) => p.host,
        cell: ({ row }) => row.original.host || '—',
      },
      {
        id: 'startedAt',
        header: 'Since',
        meta: { nowrap: true },
        accessorFn: (p) => p.startedAt,
        cell: ({ row }) => age(row.original.startedAt),
      },
      {
        id: 'acknowledged',
        header: 'Ack',
        meta: { hug: true, nowrap: true },
        accessorFn: (p) => (p.acknowledged ? 'Acknowledged' : ''),
        // A person has seen it, or nobody has. The second is the row
        // that needs a reader, so it's the louder of the two.
        cell: ({ row }) =>
          row.original.acknowledged ? (
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              yes
            </Typography>
          ) : (
            '—'
          ),
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Problems" />

      {!connected && !isLoading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No monitoring service is connected.{' '}
          <Link href="/monitoring/settings/service" underline="hover">
            Connect one
          </Link>{' '}
          to see this.
        </Alert>
      )}

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      {connected && (
        <>
          <Box sx={{ display: 'flex', mb: 2 }}>
            <FilterSelect
              value={severity}
              onChange={setSeverity}
              anyLabel="Any severity"
              options={severities.map((word) => ({ value: word, label: word }))}
            />
          </Box>

          <DataTable
            rows={shown}
            columns={columns}
            getRowId={(p) => p.id}
            initialSort={[{ id: 'severity', desc: true }]}
            filterPlaceholder="Filter by problem or host"
            empty={
              isLoading ? 'Loading…' : 'No active problems — the service reports all clear.'
            }
          />
        </>
      )}
    </Box>
  )
}

/** Zabbix's word, weighted like the CVE bands: colour only where it
 *  demands attention, so the colours stay information. */
function Severity({ problem }: { problem: MonitoringProblem }) {
  const color =
    problem.rank >= 4 ? '#d93025' : problem.rank === 3 ? '#e37400' : 'text.primary'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography component="span" sx={{ fontSize: 13, color, whiteSpace: 'nowrap' }}>
        {problem.severity}
      </Typography>
      {problem.suppressed && (
        <Chip label="suppressed" size="small" sx={{ fontSize: 10, height: 18 }} />
      )}
    </Box>
  )
}

/** How long it has been wrong — the second question about any alert. */
function age(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 24 * 3600) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / (24 * 3600))}d`
}
