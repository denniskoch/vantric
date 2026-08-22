import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { AIGateway } from '../api/client'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import StatusIcon from '../components/StatusIcon'

/**
 * The AI gateway this console reads.
 *
 * The credential, kept in the section it serves — the same rule as DNS
 * providers under DNS and controllers under Network. What the gateway
 * knows shows up on the Requests page here.
 *
 * AUTH is a column rather than a footnote: Bifrost's management API is
 * open unless you turn it on, which is fine on a LAN and is worth
 * seeing plainly next to a gateway published anywhere else.
 */
export default function AIGatewaysPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<AIGateway | null>(null)
  const [deleting, setDeleting] = useState<AIGateway | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: gateways = [], isLoading } = useQuery({
    queryKey: ['aiGateways'],
    queryFn: api.listAIGateways,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAIGateway(id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['aiGateways'] })
      queryClient.invalidateQueries({ queryKey: ['aiRequests'] })
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Gateway"
        actions={
          <Button
            variant="contained"
            size="small"
            startIcon={<AddBoxIcon />}
            component={RouterLink}
            to="/ai/settings/gateway/add"
          >
            Connect
          </Button>
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>URL</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Auth</TableCell>
              <TableCell align="right">Requests</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {gateways.map((g) => (
              <TableRow key={g.id} hover>
                <TableCell>
                  <StatusIcon status={g.status === 'connected' ? 'RUNNING' : 'TERMINATED'} />
                </TableCell>
                <TableCell>{g.name}</TableCell>
                <TableCell>{g.type}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{g.baseUrl}</TableCell>
                <TableCell>{g.info?.version || (g.error ? '—' : '')}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {g.info ? (g.info.authEnabled ? 'Required' : 'Open') : '—'}
                </TableCell>
                <TableCell align="right">
                  {g.info ? g.info.requests.toLocaleString() : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setMenuAnchor(e.currentTarget)
                      setSelected(g)
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {gateways.some((g) => g.error) && (
              <TableRow>
                <TableCell colSpan={8} sx={{ color: 'error.main', fontSize: 12 }}>
                  {gateways.find((g) => g.error)?.error}
                </TableCell>
              </TableRow>
            )}
            {gateways.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No AI gateway connected.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (selected) navigate(`/ai/settings/gateway/${selected.id}/edit`)
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleting(selected)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Disconnect
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Disconnect ${deleting?.name}?`}
        body={
          <>
            This console stops reading {deleting?.name}. Nothing is removed from the
            gateway itself, and re-connecting brings the log back.
          </>
        }
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Box>
  )
}
