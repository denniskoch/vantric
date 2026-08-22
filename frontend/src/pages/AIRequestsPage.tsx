import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Chip, MenuItem, Paper, TextField, Typography } from '@mui/material'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import SelectField from '../components/SelectField'
import ProviderName from '../components/ProviderName'
import { api } from '../api/client'
import type { AIRequest } from '../api/client'

/** The windows Bifrost's own console offers, in hours. */
const periods: Record<string, number> = {
  'Last hour': 1,
  'Last 6 hours': 6,
  'Last 24 hours': 24,
  'Last 7 days': 24 * 7,
  'Last 30 days': 24 * 30,
}

/**
 * Every call the lab made to a model, as the gateway recorded it.
 *
 * SERVER-PAGED, unlike every other table here. This log is six figures
 * on a lab of one person, so the page asks for fifty rows at a time
 * and lets the gateway do the sorting — see DataTable's `server` prop,
 * which exists for this.
 *
 * The prompt and the answer are deliberately not here. They are the
 * most sensitive thing the gateway holds, they are one click away in
 * its own UI, and mirroring them would turn every browser tab into a
 * copy of the lab's conversations.
 */

// Bifrost sorts by four keys and no others, so a column that isn't one
// of them isn't offered as a sort — a header that reorders nothing is
// worse than a header that doesn't invite the click.
const sortKeys: Record<string, string> = {
  at: 'timestamp',
  latencyMs: 'latency',
  totalTokens: 'tokens',
  cost: 'cost',
}

export default function AIRequestsPage() {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'at', desc: true }])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState('')

  // The window is pinned when you pick it rather than recomputed on
  // every render. A sliding "last hour" would change the query on each
  // keystroke — refetching under the cursor, renumbering the pages
  // beneath you, and never settling.
  const since = useMemo(() => {
    const hours = periods[period]
    if (!hours) return undefined
    return new Date(Date.now() - hours * 3600_000).toISOString()
  }, [period])

  const sort = sorting[0]
  const query = {
    limit: pageSize,
    offset: page * pageSize,
    sortBy: sortKeys[sort?.id ?? 'at'] ?? 'timestamp',
    order: (sort?.desc === false ? 'asc' : 'desc') as 'asc' | 'desc',
    providers: provider ? [provider] : undefined,
    models: model ? [model] : undefined,
    status: status || undefined,
    search: search || undefined,
    since,
  }

  const { data: filters } = useQuery({ queryKey: ['aiFilters'], queryFn: api.getAIFilters })
  const { data, isLoading, error } = useQuery({
    queryKey: ['aiRequests', query],
    queryFn: () => api.listAIRequests(query),
    // A log is a moving target; refetching under the cursor as you read
    // a page is not help.
    refetchInterval: false,
  })
  const { data: stats } = useQuery({
    queryKey: ['aiStats', query.providers, query.models, query.status, query.search, query.since],
    queryFn: () => api.getAIStats({ ...query, limit: undefined, offset: undefined }),
  })

  const rows = data?.requests ?? []
  // The gateway prices per request from v2 on, and not before it. The
  // column appears when there is something in it rather than standing
  // empty on an older gateway — the same rule the estate CVE list
  // follows for a severity its service doesn't carry.
  const priced = rows.some((r) => r.cost !== undefined)

  const columns = useMemo<ColumnDef<AIRequest, unknown>[]>(
    () => [
      {
        id: 'at',
        header: 'When',
        meta: { nowrap: true },
        accessorFn: (r) => r.at,
        cell: ({ row }) => new Date(row.original.at).toLocaleString(),
      },
      {
        id: 'status',
        header: 'Status',
        meta: { hug: true },
        enableSorting: false,
        accessorFn: (r) => r.status,
        cell: ({ row }) => <StatusText status={row.original.status} />,
      },
      {
        id: 'provider',
        header: 'Provider',
        enableSorting: false,
        meta: { nowrap: true },
        accessorFn: (r) => r.provider,
        cell: ({ row }) => <ProviderName name={row.original.provider} />,
      },
      { id: 'model', header: 'Model', enableSorting: false, accessorFn: (r) => r.model },
      {
        id: 'caller',
        header: 'Caller',
        enableSorting: false,
        accessorFn: (r) => r.caller,
        cell: ({ row }) => row.original.caller || '—',
      },
      {
        id: 'latencyMs',
        header: 'Latency',
        meta: { align: 'right', nowrap: true },
        accessorFn: (r) => r.latencyMs,
        // A request that failed before the model answered has none.
        // "—" rather than 0, which would read as instant.
        cell: ({ row }) =>
          row.original.latencyMs === undefined ? '—' : formatMs(row.original.latencyMs),
      },
      {
        id: 'totalTokens',
        header: 'Tokens',
        meta: { align: 'right', nowrap: true },
        accessorFn: (r) => r.totalTokens,
        cell: ({ row }) =>
          row.original.totalTokens === undefined
            ? '—'
            : row.original.totalTokens.toLocaleString(),
      },
      ...(priced
        ? [
            {
              id: 'cost',
              header: 'Cost',
              meta: { align: 'right' as const, nowrap: true },
              accessorFn: (r: AIRequest) => r.cost,
              cell: ({ row }: { row: { original: AIRequest } }) =>
                row.original.cost === undefined ? '—' : `$${row.original.cost.toFixed(4)}`,
            } as ColumnDef<AIRequest, unknown>,
          ]
        : []),
    ],
    [priced],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Requests" />

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      {stats && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Stat label="Requests" value={stats.requests.toLocaleString()} />
          <Stat label="Succeeded" value={`${stats.successRate.toFixed(1)}%`} />
          <Stat label="Average latency" value={formatMs(stats.avgLatencyMs)} />
          <Stat label="Tokens" value={compact(stats.totalTokens)} />
          <Stat
            label="Cost"
            value={`$${stats.cost.toFixed(2)}`}
            // Local models are priced at nothing and still counted, so
            // this is a floor on what was spent rather than a total.
            note="priced traffic only"
          />
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <SelectField
          label="Provider"
          size="small"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value)
            setPage(0)
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Any provider</MenuItem>
          {(filters?.providers ?? []).map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </SelectField>
        <SelectField
          label="Model"
          size="small"
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            setPage(0)
          }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">Any model</MenuItem>
          {(filters?.models ?? []).map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </SelectField>
        <SelectField
          label="Time range"
          size="small"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value)
            setPage(0)
          }}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="">Any time</MenuItem>
          {Object.keys(periods).map((label) => (
            <MenuItem key={label} value={label}>
              {label}
            </MenuItem>
          ))}
        </SelectField>
        <SelectField
          label="Status"
          size="small"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(0)
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Any status</MenuItem>
          <MenuItem value="success">Succeeded</MenuItem>
          <MenuItem value="error">Failed</MenuItem>
          <MenuItem value="processing">In flight</MenuItem>
        </SelectField>
        <TextField
          label="Search"
          size="small"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          sx={{ minWidth: 220 }}
        />
      </Box>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchable={false}
        perPageOptions={[25, 50, 100]}
        server={{
          total: data?.total ?? 0,
          page,
          pageSize,
          sorting,
          onChange: (next) => {
            setPage(next.page)
            setPageSize(next.pageSize)
            setSorting(next.sorting)
          },
        }}
        empty={isLoading ? 'Loading…' : 'No requests match.'}
      />
    </Box>
  )
}

function StatusText({ status }: { status: string }) {
  const failed = status === 'error'
  return (
    <Typography
      component="span"
      sx={{ fontSize: 13, color: failed ? 'error.main' : 'text.primary' }}
    >
      {failed ? 'Failed' : status === 'success' ? 'Succeeded' : 'In flight'}
    </Typography>
  )
}

/** One figure per card, the same shape the Compute overview uses —
 *  five numbers in one undivided strip read as a sentence rather than
 *  as five separate answers. */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 160, flex: '1 1 160px' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 400 }}>{value}</Typography>
      {note && <Chip label={note} size="small" sx={{ fontSize: 10, height: 18, mt: 0.5 }} />}
    </Paper>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
