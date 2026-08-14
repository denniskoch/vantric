import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { api } from '../api/client'

/** authentik's action names are snake_case; these read better and the
 *  rest fall through unchanged. */
const actionLabels: Record<string, string> = {
  login: 'Sign-in',
  login_failed: 'Sign-in failed',
  logout: 'Sign-out',
  user_write: 'User changed',
  authorize_application: 'App authorized',
  password_set: 'Password set',
  model_created: 'Created',
  model_updated: 'Updated',
  model_deleted: 'Deleted',
}

const failed = (action: string) => action.includes('fail') || action.includes('denied')

export default function IdentityEventsPage() {
  const [limit, setLimit] = useState(100)

  const { data: providers = [] } = useQuery({
    queryKey: ['identityProviders'],
    queryFn: api.listIdentityProviders,
  })
  const {
    data: events = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['identityEvents', limit],
    queryFn: () => api.listIdentityEvents(limit),
    enabled: providers.length > 0,
    refetchInterval: 30000,
    retry: false,
  })

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Events
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The provider's audit log, newest first — who signed in, what failed, and
        what changed.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      <TextField
        label="Show"
        size="small"
        select
        value={limit}
        onChange={(e) => setLimit(Number(e.target.value))}
        sx={{ width: 200, mb: 2 }}
      >
        {[50, 100, 250, 500].map((n) => (
          <MenuItem key={n} value={n}>
            Last {n} events
          </MenuItem>
        ))}
      </TextField>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Client IP</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Detail</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id} hover>
                <TableCell>
                  {event.created ? new Date(event.created * 1000).toLocaleString() : '—'}
                </TableCell>
                <TableCell sx={{ color: failed(event.action) ? '#d93025' : undefined }}>
                  {actionLabels[event.action] ?? event.action}
                </TableCell>
                <TableCell>{event.user || '—'}</TableCell>
                <TableCell>{event.clientIp || '—'}</TableCell>
                <TableCell sx={{ color: '#5f6368' }}>{event.app || '—'}</TableCell>
                <TableCell
                  sx={{
                    maxWidth: 280,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <Tooltip title={event.detail}>
                    <span>{event.detail || '—'}</span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No events.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
