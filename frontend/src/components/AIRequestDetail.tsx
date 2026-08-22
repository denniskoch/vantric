import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Typography } from '@mui/material'
import { api } from '../api/client'

/**
 * One request's detail, fetched when its row is opened.
 *
 * The failure reason is only on the gateway's single-log endpoint, so
 * this can't be a column — and fetching it for every visible row to
 * fill one would be fifty calls to answer a question about one.
 */
export default function AIRequestDetail({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['aiRequest', id],
    queryFn: () => api.getAIRequest(id),
    staleTime: 5 * 60_000,
  })

  if (isLoading) {
    return (
      <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 1 }}>Loading…</Typography>
    )
  }
  if (error || !data) {
    return (
      <Typography sx={{ fontSize: 13, color: 'error.main', py: 1 }}>
        {(error as Error)?.message ?? 'No detail for this request.'}
      </Typography>
    )
  }

  return (
    <Box sx={{ py: 1 }}>
      {data.error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 13 }}>{data.error.message}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
            {/* ONE DIRECTION OF is_bifrost_error IS TRUSTWORTHY. The
                gateway sets it false on its own governance refusals —
                "Provider 'anthropic' is not allowed for this virtual
                key" arrives with is_bifrost_error: false — so reading
                false as "the provider rejected this" would name the
                wrong system on the one error where knowing which
                matters most. True is taken at its word; false claims
                nothing, and the classification and status say the rest. */}
            {data.error.fromGateway && 'Refused by the gateway · '}
            {[data.error.kind, data.error.statusCode && `HTTP ${data.error.statusCode}`]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          columnGap: 3,
          rowGap: 0.5,
        }}
      >
        <Field label="Caller" value={data.caller || '—'} />
        <Field label="Key used" value={data.credential || '—'} />
        {data.routingRule && <Field label="Routing rule" value={data.routingRule} />}
        <Field label="Kind" value={data.kind || '—'} />
        <Field label="Streamed" value={data.streamed ? 'Yes' : 'No'} />
        {/* Retries and the fallback position only mean something when
            they happened; zero on both is the ordinary case and says
            nothing worth a row. */}
        {data.retries > 0 && <Field label="Retries" value={String(data.retries)} />}
        {data.fallbackIndex > 0 && (
          <Field label="Fallback" value={`answered by choice ${data.fallbackIndex + 1}`} />
        )}
        {data.promptTokens !== undefined && (
          <Field
            label="Tokens"
            value={`${data.promptTokens.toLocaleString()} in · ${(data.completionTokens ?? 0).toLocaleString()} out`}
          />
        )}
        <Field label="Request id" value={data.id} mono />
      </Box>
    </Box>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, fontFamily: mono ? 'monospace' : undefined }}>
        {value}
      </Typography>
    </>
  )
}
