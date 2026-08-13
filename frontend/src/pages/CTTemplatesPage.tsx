import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
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
  Typography,
} from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import VolumeName from '../components/VolumeName'
import type { CTTemplate } from '../api/client'
import { formatBytes } from '../format'
import { useServerNames } from '../useServerNames'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

// CT templates (LXC root-filesystem tarballs) — the sources containers
// are provisioned from.
export default function CTTemplatesPage() {
  const queryClient = useQueryClient()
  const serverName = useServerNames()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuTemplate, setMenuTemplate] = useState<CTTemplate | null>(null)
  const [confirming, setConfirming] = useState<CTTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['ctTemplates'],
    queryFn: api.listCTTemplates,
  })

  const remove = useMutation({
    mutationFn: (tpl: CTTemplate) => api.deleteCTTemplate(tpl.serverId, tpl.zone, tpl.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ctTemplates'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        CT templates
      </Typography>

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
              <TableCell>Server</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Uploaded</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.map((tpl) => (
              <TableRow key={`${tpl.serverId}/${tpl.id}`} hover>
                <TableCell>
                  <VolumeName name={tpl.name} />
                </TableCell>
                <TableCell>{tpl.storage}</TableCell>
                <TableCell>{serverName(tpl.serverId)}</TableCell>
                <TableCell>{tpl.zone}</TableCell>
                <TableCell align="right">{formatBytes(tpl.sizeBytes)}</TableCell>
                <TableCell>
                  {tpl.createdAt ? new Date(tpl.createdAt * 1000).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setMenuAnchor(e.currentTarget)
                      setMenuTemplate(tpl)
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No CT templates found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setConfirming(menuTemplate)
            setMenuAnchor(null)
          }}
          sx={{ color: '#d93025' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Delete ${confirming?.name}?`}
        body={`This permanently removes the template from ${confirming?.storage} on ${
          confirming ? serverName(confirming.serverId) : ''
        }. Existing containers are unaffected; new ones can no longer be created from it.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
