import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  Tooltip,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { Subnet } from '../api/client'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'

/**
 * Address ranges and what each one is for.
 *
 * The console owns the manual ones, which is rare here and deliberate:
 * a lab without an IPAM has nowhere else to write this down, and the
 * Source column is what keeps it from becoming a second registry — a
 * range reported by another system carries that system's name and
 * can't be edited here.
 */
export default function NetworkSubnetsPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuSubnet, setMenuSubnet] = useState<Subnet | null>(null)
  const [confirming, setConfirming] = useState<Subnet | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: subnets = [], isLoading } = useQuery({
    queryKey: ['subnets'],
    queryFn: api.listSubnets,
  })

  const remove = useMutation({
    mutationFn: (subnet: Subnet) => api.deleteSubnet(subnet.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subnets'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  const editable = (subnet: Subnet | null) => subnet?.source === 'manual'

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Subnets"
        description="Address ranges in your lab, and what each one is for."
        actions={
          canEdit && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
              onClick={() => navigate('/network/subnets/create')}
            >
              Create subnet
            </Button>
          )
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
              <TableCell>Name</TableCell>
              <TableCell>Source</TableCell>
              <TableCell align="right">VLAN</TableCell>
              <TableCell>Stack type</TableCell>
              <TableCell>IPv4 range</TableCell>
              <TableCell>IPv4 gateway</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {subnets.map((subnet) => (
              <TableRow key={subnet.id} hover>
                <TableCell>
                  {subnet.name}
                  {subnet.description && (
                    <Box sx={{ fontSize: 11, color: 'text.secondary' }}>
                      {subnet.description}
                    </Box>
                  )}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{subnet.source}</TableCell>
                <TableCell align="right">
                  {/* Untagged is a real answer, not a missing one. */}
                  {subnet.vlan > 0 ? (
                    subnet.vlan
                  ) : (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      untagged
                    </Box>
                  )}
                </TableCell>
                <TableCell>{subnet.stackType}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {subnet.ipv4Range}
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {subnet.ipv4Gateway || '—'}
                </TableCell>
                <TableCell align="right">
                  {canEdit && (
                    <Tooltip
                      title={
                        editable(subnet)
                          ? ''
                          : `Reported by ${subnet.source} — edit it there`
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          disabled={!editable(subnet)}
                          onClick={(e) => {
                            setMenuAnchor(e.currentTarget)
                            setMenuSubnet(subnet)
                          }}
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {subnets.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No subnets recorded yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (menuSubnet) navigate(`/network/subnets/${menuSubnet.id}/edit`)
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setConfirming(menuSubnet)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      {/* One click: this is a note about a range, not the range
          itself, and re-typing it costs a minute. */}
      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Delete ${confirming?.name}?`}
        body={`This removes the console's record of ${confirming?.ipv4Range}. Nothing on the network changes.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
