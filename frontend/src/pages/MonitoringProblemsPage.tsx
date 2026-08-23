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
            alignTop
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

/**
 * Zabbix's word on Zabbix's colour.
 *
 * THE PALETTE IS THEIRS, and carrying it is the same decision as
 * carrying the vocabulary: somebody who knows what Average looks like
 * in Zabbix should not have to read the word here. It is a deliberate
 * exception to this console's own palette, which is why the values are
 * written down rather than approximated from the theme.
 *
 * Keyed on the WORD, not the rank. Rank is "higher is worse" and says
 * nothing about how many steps a service uses — a provider with four
 * levels would land on the wrong colour. An unrecognised word gets no
 * tint at all, the same answer the provider marks give a vendor with no
 * logo.
 */
const zabbixSeverity: Record<string, string> = {
  Disaster: '#e45959',
  High: '#e97659',
  Average: '#ffa059',
  Warning: '#ffc859',
  Information: '#7499ff',
  'Not classified': '#97aab3',
}

function Severity({ problem }: { problem: MonitoringProblem }) {
  const tint = zabbixSeverity[problem.severity]
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        component="span"
        sx={{
          fontSize: 13,
          px: 0.75,
          py: 0.25,
          // Cells are top-aligned, so the tint's own padding would push
          // this word two pixels below the problem text beside it.
          mt: '-2px',
          // The house radius, and no border — a tint is a label, not a
          // pill.
          borderRadius: '4px',
          whiteSpace: 'nowrap',
          bgcolor: tint,
          color: tint ? '#202124' : 'text.primary',
        }}
      >
        {problem.severity}
      </Box>
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
