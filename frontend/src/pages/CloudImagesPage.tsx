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
import type { CloudImage } from '../api/client'
import { formatBytes } from '../format'
import { useServerNames } from '../useServerNames'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'

export default function CloudImagesPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const queryClient = useQueryClient()
  const serverName = useServerNames()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuImage, setMenuImage] = useState<CloudImage | null>(null)
  const [confirming, setConfirming] = useState<CloudImage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: images = [], isLoading } = useQuery({
    queryKey: ['cloudImages'],
    queryFn: api.listCloudImages,
  })

  const remove = useMutation({
    mutationFn: (image: CloudImage) => api.deleteCloudImage(image.serverId, image.zone, image.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cloudImages'] })
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
        title="Cloud images"
        actions={
          canEdit && (
            <Button
              component={RouterLink}
              to="/compute/cloud-images/add"
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
            >
              Add cloud image
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
              <TableCell>Server</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Uploaded</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {images.map((image) => (
              <TableRow key={`${image.serverId}/${image.id}`} hover>
                <TableCell>
                  <OSName name={image.name} />
                </TableCell>
                <TableCell>{image.storage}</TableCell>
                <TableCell>{serverName(image.serverId)}</TableCell>
                <TableCell>{image.zone}</TableCell>
                <TableCell align="right">{formatBytes(image.sizeBytes)}</TableCell>
                <TableCell>
                  {image.createdAt ? new Date(image.createdAt * 1000).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell align="right">
                  {canEdit && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        setMenuAnchor(e.currentTarget)
                        setMenuImage(image)
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {images.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No cloud images found. Add one to build VM templates from.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setConfirming(menuImage)
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
        body={`This permanently removes the image from ${confirming?.storage} on ${
          confirming ? serverName(confirming.serverId) : ''
        }. Templates already built from it are unaffected.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
