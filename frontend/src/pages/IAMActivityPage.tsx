import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { usePaged } from '../components/usePaged'

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
export default function IAMActivityPage() {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.listAudit(),
    refetchInterval: 15000,
  })

  const term = filter.trim().toLowerCase()
  const matching = term
    ? entries.filter((e) =>
        [e.actorEmail, e.action, e.resource, e.path, e.error]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(term)),
      )
    : entries
  const { shown, pagination } = usePaged(matching, 25)

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Activity"
        description="Every change made through this console, and the account that made it."
      />

      <TextField
        size="small"
        placeholder="Filter by account, action or resource"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        sx={{ mb: 2, width: 360 }}
      />

      {!isLoading && entries.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Nothing recorded yet. Changes made from here — creating an instance, editing a
          description, connecting a backend — appear as they happen.
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 36 }} />
              <TableCell>When</TableCell>
              <TableCell>Account</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Resource</TableCell>
              <TableCell>Outcome</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((entry) => (
              <Fragment key={entry.id}>
                <TableRow hover>
                  <TableCell sx={{ width: 36 }}>
                    {(entry.payload || entry.error) && (
                      <IconButton
                        size="small"
                        aria-label={open === entry.id ? 'Hide details' : 'Show details'}
                        onClick={() => setOpen(open === entry.id ? null : entry.id)}
                      >
                        {open === entry.id ? (
                          <ExpandLessIcon sx={{ fontSize: 16 }} />
                        ) : (
                          <ExpandMoreIcon sx={{ fontSize: 16 }} />
                        )}
                      </IconButton>
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {new Date(entry.at * 1000).toLocaleString()}
                  </TableCell>
                  <TableCell>{entry.actorEmail || '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {entry.action}
                  </TableCell>
                  <TableCell>{entry.resource || '—'}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {entry.status >= 400 ? (
                        <ErrorIcon sx={{ fontSize: 16, color: '#d93025' }} />
                      ) : (
                        <CheckCircleIcon sx={{ fontSize: 16, color: '#188038' }} />
                      )}
                      <Box component="span" sx={{ fontSize: 12, color: '#5f6368' }}>
                        {entry.status}
                      </Box>
                    </Box>
                  </TableCell>
                </TableRow>
                {open === entry.id && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ bgcolor: '#f8f9fa' }}>
                      {entry.error && (
                        <Typography sx={{ fontSize: 12, color: '#d93025', mb: 1 }}>
                          {entry.error}
                        </Typography>
                      )}
                      <Typography sx={{ fontSize: 11, color: '#5f6368', mb: 1 }}>
                        {entry.method} {entry.path} · {entry.durationMs} ms · from{' '}
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
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && entries.length > 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: '#5f6368' }}>
                  Nothing matches "{filter}".
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {pagination}

      <Typography sx={{ fontSize: 11, color: '#80868b', mt: 1 }}>
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
