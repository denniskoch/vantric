import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Chip, Link, Typography } from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import ProviderName from '../components/ProviderName'
import FilterSelect from '../components/FilterSelect'
import { api } from '../api/client'
import type { AIModelPrice } from '../api/client'

/**
 * What each model costs, as the gateway prices it.
 *
 * READ FROM THE GATEWAY, NOT FROM THE REGISTRY BEHIND IT. The rule
 * elsewhere is that the price list is linked and never copied, and it
 * still holds: this console keeps no prices. The gateway has already
 * resolved a catalog from whichever registry it syncs against, and
 * that resolved catalog is the thing that actually produced every cost
 * figure on the Requests and Virtual keys pages — so reading it is the
 * same move every other section makes.
 *
 * PER MILLION TOKENS, because $0.000003 is not a price anybody can
 * compare. The gateway holds and multiplies by the per-token figure;
 * turning it into the unit vendors quote is this page's only
 * arithmetic, and it is why the page exists.
 *
 * NO PRICE IS NOT A FREE MODEL. Over half the catalog carries none —
 * every self-hosted model, and a long tail nobody has priced — so
 * those read "not priced" and sort after everything real, the same
 * rule the unscored CVEs follow. A zero here would say ollama and
 * GPT-5 cost the same.
 */
/**
 * A NEGATIVE COST IS A SENTINEL, NOT A PRICE. OpenRouter's `auto`
 * models — the ones that pick an upstream per request — carry -1,
 * because what they cost isn't knowable until the router has chosen.
 * Taken literally that renders as -$1,000,000.00 per million and sorts
 * as the cheapest thing in the catalog, which is the free-model lie
 * wearing a minus sign. Anything below zero reads as no price.
 */
const priceOf = (v?: number) => (v == null || v < 0 ? undefined : v)

export default function AIModelPricesPage() {
  const [provider, setProvider] = useState('')
  const [priced, setPriced] = useState('')

  const {
    data: models = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['aiModelPrices'],
    queryFn: api.listAIModelPrices,
    // A price list changes when the gateway next syncs its registry,
    // which is hours. Polling it at list speed would be one megabyte a
    // minute for a number that didn't move.
    staleTime: 30 * 60_000,
  })

  const providers = useMemo(
    () => [...new Set(models.map((m) => m.provider))].sort(),
    [models],
  )

  const rows = useMemo(
    () =>
      models.filter(
        (m) =>
          (provider === '' || m.provider === provider) &&
          (priced === '' ||
            (priced === 'priced'
              ? priceOf(m.inputPerToken) != null
              : priceOf(m.inputPerToken) == null)),
      ),
    [models, provider, priced],
  )

  // A column that would be empty on every row isn't drawn — the same
  // rule the request log's cost column follows. Caching is priced by
  // three providers here and nothing at all by the rest.
  const anyCacheRead = rows.some((m) => priceOf(m.cacheReadPerToken) != null)
  const anyCacheWrite = rows.some((m) => priceOf(m.cacheWritePerToken) != null)
  const anyContext = rows.some((m) => m.maxInputTokens)

  const columns = useMemo<ColumnDef<AIModelPrice, unknown>[]>(() => {
    // `say` distinguishes the two kinds of missing price. On Input and
    // Output an absence is THE FINDING — that model's traffic can't be
    // costed at all, which is why most of the request log has no cost.
    // On the cache columns it is the ordinary case, since most models
    // have no prompt caching to price, and four columns all saying "not
    // priced" would bury the two where it means something.
    const cost = (
      id: string,
      header: string,
      pick: (m: AIModelPrice) => number | undefined,
      say = true,
    ): ColumnDef<AIModelPrice, unknown> => ({
      id,
      header,
      meta: { align: 'right' as const, nowrap: true },
      // Sorted on the raw number, so an absent price lands at one end
      // rather than wherever its rendered text happens to sort.
      accessorFn: (m) => priceOf(pick(m)) ?? -1,
      cell: ({ row }) => <Price perToken={priceOf(pick(row.original))} say={say} />,
    })
    return [
      {
        id: 'name',
        header: 'Model',
        meta: { nowrap: true },
        accessorFn: (m) => m.name,
        cell: ({ row }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {row.original.name}
            {row.original.deprecated && (
              <Chip label="deprecated" size="small" sx={{ fontSize: 10, height: 18 }} />
            )}
          </Box>
        ),
      },
      {
        id: 'provider',
        header: 'Provider',
        meta: { nowrap: true },
        accessorFn: (m) => m.provider,
        cell: ({ row }) => <ProviderName name={row.original.provider} />,
      },
      cost('input', 'Input', (m) => m.inputPerToken),
      cost('output', 'Output', (m) => m.outputPerToken),
      ...(anyCacheRead
        ? [cost('cacheRead', 'Cache read', (m) => m.cacheReadPerToken, false)]
        : []),
      ...(anyCacheWrite
        ? [cost('cacheWrite', 'Cache write', (m) => m.cacheWritePerToken, false)]
        : []),
      ...(anyContext
        ? [
            {
              id: 'context',
              header: 'Context',
              meta: { align: 'right' as const, nowrap: true },
              accessorFn: (m: AIModelPrice) => m.maxInputTokens ?? 0,
              cell: ({ row }: { row: { original: AIModelPrice } }) => (
                <Tokens count={row.original.maxInputTokens} />
              ),
            } as ColumnDef<AIModelPrice, unknown>,
            {
              id: 'maxOutput',
              header: 'Max output',
              meta: { align: 'right' as const, nowrap: true },
              accessorFn: (m: AIModelPrice) => m.maxOutputTokens ?? 0,
              cell: ({ row }: { row: { original: AIModelPrice } }) => (
                <Tokens count={row.original.maxOutputTokens} />
              ),
            } as ColumnDef<AIModelPrice, unknown>,
          ]
        : []),
    ]
  }, [anyCacheRead, anyCacheWrite, anyContext])

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Model prices"
        description="What your gateway charges each call against, per million tokens."
      />

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 2 }}>
        These are the numbers your gateway multiplies by, synced from{' '}
        <Link href="https://getbifrost.ai/datasheet" target="_blank" rel="noreferrer">
          its price registry
        </Link>
        . A router picks an upstream per request, so what you were charged can differ.
      </Alert>

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <FilterSelect
          anyLabel="Any provider"
          value={provider}
          onChange={setProvider}
          options={providers.map((p) => ({ value: p, label: p }))}
        />
        <FilterSelect
          anyLabel="Priced and not"
          value={priced}
          onChange={setPriced}
          options={[
            { value: 'priced', label: 'Priced' },
            { value: 'unpriced', label: 'Not priced' },
          ]}
        />
      </Box>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(m) => `${m.provider}/${m.name}`}
        initialSort={[{ id: 'input', desc: true }]}
        filterPlaceholder="Filter by model"
        empty={isLoading ? 'Loading…' : 'The gateway publishes no model catalog.'}
      />
    </Box>
  )
}

/**
 * A per-token cost as a per-million price.
 *
 * Precision follows the size: the cheap models here run to $0.02 per
 * million and a fixed two decimals would round half the catalog to
 * $0.00, which is the free-model lie again in a different disguise.
 */
function Price({ perToken, say }: { perToken?: number; say: boolean }) {
  if (perToken == null) {
    return say ? (
      <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
        not priced
      </Typography>
    ) : (
      <Box component="span" sx={{ color: 'text.disabled' }}>
        —
      </Box>
    )
  }
  const perMillion = perToken * 1_000_000
  const digits = perMillion >= 1 ? 2 : perMillion >= 0.01 ? 3 : 4
  return <>${perMillion.toFixed(digits)}</>
}

/** A context window in the units the vendors quote it in. */
function Tokens({ count }: { count?: number }) {
  if (!count) return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
  if (count >= 1_000_000) return <>{(count / 1_000_000).toFixed(count % 1_000_000 ? 1 : 0)}M</>
  if (count >= 1_000) return <>{Math.round(count / 1_000)}K</>
  return <>{count}</>
}
