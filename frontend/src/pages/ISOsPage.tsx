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
import type { ISO } from '../api/client'
import { formatBytes } from '../format'
import { useHypervisorNames } from '../useHypervisorNames'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'

export default function ISOsPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const queryClient = useQueryClient()
  const hypervisorName = useHypervisorNames()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuISO, setMenuISO] = useState<ISO | null>(null)
  const [confirming, setConfirming] = useState<ISO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: isos = [], isLoading } = useQuery({
    queryKey: ['isos'],
    queryFn: api.listISOs,
  })

  const remove = useMutation({
    mutationFn: (iso: ISO) => api.deleteISO(iso.hypervisorId, iso.node, iso.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['isos'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  const columns = useMemo<ColumnDef<(typeof isos)[number], unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (iso) => iso.name,
        cell: ({ row }) => <OSName name={row.original.name} />,
      },
      { id: 'storage', header: 'Datastore', accessorFn: (iso) => iso.storage },
      { id: 'node', header: 'Node', accessorFn: (iso) => iso.node },
      {
        id: 'size',
        header: 'Size',
        accessorFn: (iso) => iso.sizeBytes,
        meta: { align: 'right' },
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
      {
        id: 'createdAt',
        header: 'Uploaded',
        accessorFn: (iso) => iso.createdAt,
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
                setMenuISO(row.original)
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

      <DataTable
        rows={isos}
        columns={columns}
        getRowId={(iso) => `${iso.hypervisorId}/${iso.id}`}
        initialSort={[{ id: 'name', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No ISO images found on your servers.'}
      />

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
          confirming ? hypervisorName(confirming.hypervisorId) : ''
        }. Instances currently booting from it will lose the media.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
