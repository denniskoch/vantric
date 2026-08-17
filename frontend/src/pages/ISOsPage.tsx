import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
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
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import OSName from '../components/OSName'
import PageHeader from '../components/PageHeader'
import type { ISO } from '../api/client'
import { formatBytes } from '../format'
import { useServerNames } from '../useServerNames'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'

export default function ISOsPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const queryClient = useQueryClient()
  const serverName = useServerNames()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuISO, setMenuISO] = useState<ISO | null>(null)
  const [confirming, setConfirming] = useState<ISO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: isos = [], isLoading } = useQuery({
    queryKey: ['isos'],
    queryFn: api.listISOs,
  })

  const remove = useMutation({
    mutationFn: (iso: ISO) => api.deleteISO(iso.serverId, iso.node, iso.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['isos'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="ISOs"
        actions={
          canEdit && (
            <Button
              component={RouterLink}
              to="/compute/isos/add"
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
            >
              Add ISO
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
              <TableCell>Datastore</TableCell>
              <TableCell>Node</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Uploaded</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {isos.map((iso) => (
              <TableRow key={`${iso.serverId}/${iso.id}`} hover>
                <TableCell>
                  <OSName name={iso.name} />
                </TableCell>
                <TableCell>{iso.storage}</TableCell>
                <TableCell>{iso.node}</TableCell>
                <TableCell align="right">{formatBytes(iso.sizeBytes)}</TableCell>
                <TableCell>
                  {iso.createdAt ? new Date(iso.createdAt * 1000).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell align="right">
                  {canEdit && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        setMenuAnchor(e.currentTarget)
                        setMenuISO(iso)
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {isos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No ISO images found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setConfirming(menuISO)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Delete ${confirming?.name}?`}
        body={`This permanently removes the image from ${confirming?.storage} on ${
          confirming ? serverName(confirming.serverId) : ''
        }. Instances currently booting from it will lose the media.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
