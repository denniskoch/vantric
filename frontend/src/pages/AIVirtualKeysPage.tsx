import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Chip, Typography } from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import ProviderName from '../components/ProviderName'
import CellLines from '../components/CellLines'
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
        accessorFn: (k) => (k.active ? 'Active' : 'Disabled'),
        cell: ({ row }) => (
          <Typography
            component="span"
            sx={{ fontSize: 13, color: row.original.active ? undefined : 'text.secondary' }}
          >
            {row.original.active ? 'Active' : 'Disabled'}
          </Typography>
        ),
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
      {
        id: 'createdAt',
        header: 'Created',
        meta: { nowrap: true },
        accessorFn: (k) => k.createdAt,
        cell: ({ row }) =>
          row.original.createdAt ? new Date(row.original.createdAt).toLocaleDateString() : '—',
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Virtual keys"
        description="The credentials your gateway issues to callers, and what each one may reach. The secrets stay in the gateway."
      />

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
        initialSort={[{ id: 'name', desc: false }]}
        filterPlaceholder="Filter by name or provider"
        empty={isLoading ? 'Loading…' : 'The gateway has issued no virtual keys.'}
      />
    </Box>
  )
}
