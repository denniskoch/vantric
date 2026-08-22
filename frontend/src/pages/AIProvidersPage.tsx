import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Chip, Typography } from '@mui/material'
import CellLines from '../components/CellLines'
import EnabledIcon from '../components/EnabledIcon'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import ProviderName from '../components/ProviderName'
import { api } from '../api/client'
import type { AIGatewayProvider } from '../api/client'

/**
 * What the gateway can reach, and with which credentials.
 *
 * A different question from Provider accounts, which is what's LEFT at
 * each provider. This is the gateway's own configuration, read from
 * it — the daily 90%. Adding a provider or rotating an upstream key
 * stays in the gateway's own console, where the blast radius is.
 *
 * Keys are shown MASKED, as the gateway masks them. A key is listed so
 * you can tell which one is configured, not so it can be copied.
 */
export default function AIProvidersPage() {
  const { data: providers = [], isLoading, error } = useQuery({
    queryKey: ['aiGatewayProviders'],
    queryFn: api.listAIGatewayProviders,
    refetchInterval: 5 * 60_000,
  })

  const columns = useMemo<ColumnDef<AIGatewayProvider, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Provider',
        meta: { nowrap: true },
        accessorFn: (p) => p.name,
        cell: ({ row }) => <ProviderName name={row.original.name} />,
      },
      // The name and the key itself are two columns, not one cell
      // holding both. A provider with two keys stacks a line in each,
      // and top-aligned rows keep line one against line one.
      {
        id: 'keyNames',
        header: 'Key name',
        enableSorting: false,
        meta: {
          nowrap: true,
          filterText: (p: AIGatewayProvider) => p.keys.map((k) => k.name).join(' '),
        },
        cell: ({ row }) =>
          row.original.keys.length === 0 ? (
            // A provider the gateway knows of but holds no key for
            // can't serve anything. Said, rather than left as a zero
            // in the column to the left.
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              no key — this provider can't be reached
            </Typography>
          ) : (
            <CellLines>
              {row.original.keys.map((k) => (
                <Box key={k.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {/* Leading, not trailing. Whether a key is in use is
                      the first thing about it, and a badge at the end
                      of a name only announces the unusual case — which
                      leaves the ordinary one saying nothing. */}
                  <EnabledIcon
                    enabled={k.enabled}
                    on="In use"
                    off="Disabled on the gateway"
                  />
                  <span>{k.name}</span>
                  {k.models.length > 0 && k.models[0] !== '*' && (
                    <Chip
                      label={`${k.models.length} model${k.models.length === 1 ? '' : 's'}`}
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
        id: 'keyValues',
        header: 'Key',
        enableSorting: false,
        meta: { nowrap: true },
        // A local provider needs no secret, so the gateway stores the
        // host as the "key" and leaves its value empty — Ollama's two
        // are machine names. Blank would read as "we didn't look", so
        // the absence is written out.
        cell: ({ row }) => (
          <CellLines>
            {row.original.keys.map((k) => (
              <Typography
                key={k.id}
                sx={{
                  fontSize: 12,
                  color: 'text.secondary',
                  fontFamily: k.masked ? 'monospace' : undefined,
                  fontStyle: k.masked ? undefined : 'italic',
                }}
              >
                {k.masked || 'no secret'}
              </Typography>
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
        title="Providers"
        description="The model providers your gateway is configured to reach, and the keys it holds for each."
      />

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      <DataTable
        rows={providers}
        columns={columns}
        getRowId={(p) => p.name}
        alignTop
        initialSort={[{ id: 'name', desc: false }]}
        filterPlaceholder="Filter by provider or key name"
        empty={isLoading ? 'Loading…' : 'The gateway has no providers configured.'}
      />
    </Box>
  )
}
