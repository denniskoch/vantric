import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Chip, Typography } from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import ProviderName from '../components/ProviderName'
import CellLines from '../components/CellLines'
import EnabledIcon from '../components/EnabledIcon'
import { api } from '../api/client'
import type { AIVirtualKey } from '../api/client'

/**
 * The credentials the gateway issues to callers — one per service in
 * the lab, which is what makes the Caller column on the request log
 * mean something.
 *
 * THE SECRET IS NOT SHOWN, and it isn't withheld here — it never
 * arrives. The gateway returns each key's value in plaintext and the
 * driver drops it before it leaves the backend, because a console that
 * renders it turns every open browser tab into a way to spend money.
 * Copying one is what the gateway's own console is for.
 */
export default function AIVirtualKeysPage() {
  const { data: keys = [], isLoading, error } = useQuery({
    queryKey: ['aiVirtualKeys'],
    queryFn: api.listAIVirtualKeys,
    refetchInterval: 5 * 60_000,
  })

  const columns = useMemo<ColumnDef<AIVirtualKey, unknown>[]>(
    () => [
      { id: 'name', header: 'Name', meta: { nowrap: true }, accessorFn: (k) => k.name },
      {
        id: 'active',
        header: 'State',
        meta: { hug: true, nowrap: true },
        // Sorted on the word so disabled keys group, drawn as the mark
        // the provider keys use — a disabled key is a service whose
        // calls are being refused right now, and that deserves to look
        // like something rather than read like a column of the same
        // word twelve times.
        accessorFn: (k) => (k.active ? 'Active' : 'Disabled'),
        cell: ({ row }) => (
          <EnabledIcon
            enabled={row.original.active}
            on="Active — the gateway accepts this key"
            off="Disabled — calls with this key are refused"
          />
        ),
      },
      {
        id: 'requests',
        header: 'Requests',
        meta: { align: 'right', nowrap: true },
        accessorFn: (k) => k.activity?.requests,
        cell: ({ row }) =>
          row.original.activity ? row.original.activity.requests.toLocaleString() : '—',
      },
      {
        id: 'successRate',
        header: 'Succeeded',
        meta: { align: 'right', nowrap: true },
        accessorFn: (k) => k.activity?.requests ? k.activity.successRate : undefined,
        // A percentage over no requests is not 0%, it is nothing.
        cell: ({ row }) => {
          const a = row.original.activity
          if (!a || a.requests === 0) return '—'
          return (
            <Typography
              component="span"
              sx={{ fontSize: 13, color: a.successRate < 90 ? 'error.main' : undefined }}
            >
              {a.successRate.toFixed(1)}%
            </Typography>
          )
        },
      },
      {
        id: 'cost',
        header: 'Cost (est.)',
        meta: { align: 'right', nowrap: true },
        accessorFn: (k) => k.activity?.cost,
        cell: ({ row }) =>
          row.original.activity ? `$${row.original.activity.cost.toFixed(2)}` : '—',
      },
      {
        id: 'lastUsed',
        header: 'Last used',
        meta: { nowrap: true },
        accessorFn: (k) => usedAt(k),
        cell: ({ row }) => {
          const at = usedAt(row.original)
          if (!at) {
            // Never used at all — a live credential issued to something
            // that never called. Said in words, because a dash here
            // reads as "we didn't look".
            return (
              <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
                never used
              </Typography>
            )
          }
          return new Date(at).toLocaleDateString()
        },
      },
      {
        id: 'access',
        header: 'Allowed providers',
        enableSorting: false,
        meta: {
          nowrap: true,
          filterText: (k: AIVirtualKey) => k.access.map((a) => a.provider).join(' '),
        },
        // One provider per line, alphabetical. Wrapped in a row they
        // reordered themselves at every window width, so the same key
        // read differently on two screens.
        cell: ({ row }) =>
          row.original.access.length === 0 ? (
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              every provider
            </Typography>
          ) : (
            <CellLines>
              {[...row.original.access]
                .sort((a, b) => a.provider.localeCompare(b.provider))
                .map((a) => (
                  <Box key={a.provider} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <ProviderName name={a.provider} size={14} />
                    {/* "*" is the gateway's word for all of them, and
                        printing it raw would read as a wildcard nobody
                        typed. */}
                    {a.models.length > 0 && a.models[0] !== '*' && (
                      <Chip
                        label={`${a.models.length} model${a.models.length === 1 ? '' : 's'}`}
                        size="small"
                        sx={{ fontSize: 10, height: 18 }}
                      />
                    )}
                  </Box>
                ))}
            </CellLines>
          ),
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Virtual keys"
        description="The credentials your gateway issues to callers, what each may reach, and what each has actually done."
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        Cost is the gateway's own estimate, priced from its list. A router picks an
        upstream per request, so what you were charged can be higher or lower — read it
        as which caller is expensive, not as a bill.
      </Alert>

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      <DataTable
        rows={keys}
        columns={columns}
        getRowId={(k) => k.id}
        alignTop
        initialSort={[{ id: 'requests', desc: true }]}
        filterPlaceholder="Filter by name or provider"
        empty={isLoading ? 'Loading…' : 'The gateway has issued no virtual keys.'}
      />
    </Box>
  )
}

/** The last use, or nothing. The gateway sends a zero time for a key
 *  that has never been used, which parses to year 1 rather than to an
 *  absence — left alone it would render as 1/1/1. */
function usedAt(key: AIVirtualKey): string | undefined {
  const at = key.activity?.lastUsed
  if (!at) return undefined
  return new Date(at).getFullYear() > 1970 ? at : undefined
}
