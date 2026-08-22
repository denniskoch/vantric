import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Link as RouterLink } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import OSName from '../components/OSName'
import PageHeader from '../components/PageHeader'
import type { CloudImage } from '../api/client'
import { formatBytes } from '../format'
import { useHypervisorNames } from '../useHypervisorNames'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'

export default function CloudImagesPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const queryClient = useQueryClient()
  const hypervisorName = useHypervisorNames()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuImage, setMenuImage] = useState<CloudImage | null>(null)
  const [confirming, setConfirming] = useState<CloudImage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: images = [], isLoading } = useQuery({
    queryKey: ['cloudImages'],
    queryFn: api.listCloudImages,
  })

  const remove = useMutation({
    mutationFn: (image: CloudImage) => api.deleteCloudImage(image.hypervisorId, image.node, image.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cloudImages'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  const columns = useMemo<ColumnDef<(typeof images)[number], unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        meta: { nowrap: true },
        accessorFn: (image) => image.name,
        cell: ({ row }) => <OSName name={row.original.name} />,
      },
      { id: 'storage', header: 'Datastore', accessorFn: (image) => image.storage },
      { id: 'node', header: 'Node', accessorFn: (image) => image.node },
      {
        id: 'size',
        header: 'Size',
        accessorFn: (image) => image.sizeBytes,
        meta: { align: 'right', filterText: (image) => formatBytes(image.sizeBytes) },
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
      {
        id: 'createdAt',
        header: 'Uploaded',
        meta: { nowrap: true },
        accessorFn: (image) => image.createdAt,
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt * 1000).toLocaleDateString()
            : '—',
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) =>
          canEdit ? (
            <IconButton
              size="small"
              onClick={(e) => {
                setMenuAnchor(e.currentTarget)
                setMenuImage(row.original)
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          ) : null,
      },
    ],
    [canEdit],
  )

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

      <DataTable
        rows={images}
        columns={columns}
        filterPlaceholder="Filter by name, datastore or node"
        getRowId={(image) => `${image.hypervisorId}/${image.id}`}
        initialSort={[{ id: 'name', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No cloud images found on your servers.'}
      />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setConfirming(menuImage)
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
          confirming ? hypervisorName(confirming.hypervisorId) : ''
        }. Templates already built from it are unaffected.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
