import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Chip, Paper, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import ProviderName from '../components/ProviderName'
import FilterSelect from '../components/FilterSelect'
import { filterField } from '../components/filterButton'
import AIRequestDetail from '../components/AIRequestDetail'
import TimeRangePicker from '../components/TimeRangePicker'
import { ANY_TIME } from '../timeRange'
import type { TimeRange } from '../timeRange'
import { api } from '../api/client'
import type { AIRequest } from '../api/client'

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
  // The picker resolves a window when you choose it rather than
  // keeping a rule that re-evaluates — see timeRange.ts.
  const [range, setRange] = useState<TimeRange>(ANY_TIME)

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
    since: range.since,
    until: range.until,
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
    queryKey: [
      'aiStats',
      query.providers,
      query.models,
      query.status,
      query.search,
      query.since,
      query.until,
    ],
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

      {/* The range sits with the other filters, not up beside the
          title: it IS one, and it's the one you reach for before the
          rest. */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TimeRangePicker
          value={range}
          onChange={(next) => {
            setRange(next)
            // A new window is a new result set; page 4 of the old one
            // is not a place.
            setPage(0)
          }}
        />
        <FilterSelect
          value={provider}
          onChange={(v) => {
            setProvider(v)
            setPage(0)
          }}
          anyLabel="Any provider"
          options={(filters?.providers ?? []).map((p) => ({ value: p, label: p }))}
        />
        <FilterSelect
          value={model}
          onChange={(v) => {
            setModel(v)
            setPage(0)
          }}
          anyLabel="Any model"
          options={(filters?.models ?? []).map((m) => ({ value: m, label: m }))}
        />
        <FilterSelect
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(0)
          }}
          anyLabel="Any status"
          options={[
            { value: 'success', label: 'Succeeded' },
            { value: 'error', label: 'Failed' },
            { value: 'processing', label: 'In flight' },
          ]}
        />
        {/* The search keeps its box because it takes typing, but loses
            its label for the same reason the selects did: a row of
            filters shouldn't read as a form. */}
        <TextField
          size="small"
          placeholder="Search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          slotProps={{
            input: {
              startAdornment: (
                <SearchIcon sx={{ fontSize: 18, color: 'text.secondary', mr: 0.75 }} />
              ),
            },
          }}
          sx={{ ...filterField, minWidth: 220 }}
        />
      </Box>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchable={false}
        // Every row has a detail worth opening, and a failed one has
        // the reason — which the list endpoint doesn't carry.
        renderDetail={(r) => <AIRequestDetail id={r.id} />}
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
