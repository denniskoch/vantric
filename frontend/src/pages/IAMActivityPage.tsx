import { useMemo } from 'react'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import { formatDuration } from '../format'
import PageHeader from '../components/PageHeader'

/**
 * Who did what.
 *
 * This console reaches every backend through one shared credential, so
 * Proxmox's own task log can only ever say the token's name. The
 * mapping from an action to a PERSON exists nowhere but here, which is
 * what makes this page the record rather than a convenience.
 *
 * The verb is the row; the payload is behind an expander, because most
 * of the time you want to know that somebody deleted an instance, and
 * occasionally you want to know exactly what they sent.
 */
/**
 * Most rows here are a request and measured in milliseconds. An SSH
 * session is a row too, and "2700000 ms" does not answer the question
 * that entry exists to answer — which is how long somebody held a shell.
 */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return formatDuration(ms / 1000)
}

export default function IAMActivityPage() {

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.listAudit(),
    refetchInterval: 15000,
  })


  const columns = useMemo<ColumnDef<(typeof entries)[number], unknown>[]>(
    () => [
      {
        id: 'at',
        header: 'When',
        meta: {
          nowrap: true,
          filterText: (entry) => new Date(entry.at * 1000).toLocaleString(),
        },
        accessorFn: (entry) => entry.at,
        cell: ({ row }) => new Date(row.original.at * 1000).toLocaleString(),
      },
      {
        id: 'actorEmail',
        header: 'Account',
        accessorFn: (entry) => entry.actorEmail,
        cell: ({ row }) => row.original.actorEmail || '—',
      },
      {
        id: 'action',
        header: 'Action',
        meta: { nowrap: true },
        accessorFn: (entry) => entry.action,
        cell: ({ row }) => (
          <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
            {row.original.action}
          </Box>
        ),
      },
      {
        id: 'resource',
        header: 'Resource',
        accessorFn: (entry) => entry.resource,
        cell: ({ row }) => row.original.resource || '—',
      },
      {
        id: 'status',
        header: 'Outcome',
        meta: { hug: true },
        // Sorted on the code, so failures group together — and searched
        // by it too, since "403" is a thing somebody types.
        accessorFn: (entry) => entry.status,
        filterFn: undefined,
        cell: ({ row }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {row.original.status >= 400 ? (
              <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
            ) : (
              <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
            )}
            <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              {row.original.status}
            </Box>
          </Box>
        ),
      },
      {
        id: 'path',
        header: 'Path',
        // Not shown as its own column before — it lived in the detail
        // row. It stays there; this column exists so the filter can
        // reach it, which is what the hand-written one did.
        accessorFn: (entry) => `${entry.method} ${entry.path}`,
      },
    ],
    [],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Activity"
        description="Every change made through this console, and the account that made it."
      />

      {!isLoading && entries.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Nothing recorded yet.
        </Alert>
      )}

      <DataTable
        rows={entries}
        columns={columns}
        getRowId={(entry) => entry.id}
        initialSort={[{ id: 'at', desc: true }]}
        filterPlaceholder="Filter by account, action, resource, path or status"
        empty={isLoading ? 'Loading…' : 'Nothing recorded yet.'}
        renderDetail={(entry) =>
          entry.payload || entry.error ? (
            <>
              {entry.error && (
                <Typography sx={{ fontSize: 12, color: 'error.main', mb: 1 }}>
                  {entry.error}
                </Typography>
              )}
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>
                {entry.method} {entry.path} · {formatElapsed(entry.durationMs)} · from{' '}
                {entry.remoteAddr || 'unknown'}
              </Typography>
              {entry.payload && (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.5,
                    fontSize: 11,
                    bgcolor: '#fff',
                    border: '1px solid #e8eaed',
                    borderRadius: 1,
                    overflowX: 'auto',
                    maxHeight: 320,
                  }}
                >
                  {pretty(entry.payload)}
                </Box>
              )}
            </>
          ) : null
        }
      />

      <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 1 }}>
        Secrets are replaced before a payload is stored — passwords, tokens and keys never
        reach this table. Entries are kept for 90 days.
      </Typography>
    </Box>
  )
}

/** The payload is stored as JSON; nobody reads it on one line. */
function pretty(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    return payload
  }
}
