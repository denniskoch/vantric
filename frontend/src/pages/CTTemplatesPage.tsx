import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import OSName from '../components/OSName'
import PageHeader from '../components/PageHeader'
import type { CTTemplate } from '../api/client'
import { formatBytes } from '../format'
import { useHypervisorNames } from '../useHypervisorNames'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'

// CT templates (LXC root-filesystem tarballs) — the sources containers
// are provisioned from.
export default function CTTemplatesPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const queryClient = useQueryClient()
  const hypervisorName = useHypervisorNames()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuTemplate, setMenuTemplate] = useState<CTTemplate | null>(null)
  const [confirming, setConfirming] = useState<CTTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['ctTemplates'],
    queryFn: api.listCTTemplates,
  })

  const remove = useMutation({
    mutationFn: (tpl: CTTemplate) => api.deleteCTTemplate(tpl.hypervisorId, tpl.node, tpl.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ctTemplates'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  const columns = useMemo<ColumnDef<(typeof templates)[number], unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        meta: { nowrap: true },
        accessorFn: (tpl) => tpl.name,
        cell: ({ row }) => <OSName name={row.original.name} />,
      },
      { id: 'storage', header: 'Datastore', accessorFn: (tpl) => tpl.storage },
      { id: 'node', header: 'Node', accessorFn: (tpl) => tpl.node },
      {
        id: 'size',
        header: 'Size',
        accessorFn: (tpl) => tpl.sizeBytes,
        meta: { align: 'right', filterText: (tpl) => formatBytes(tpl.sizeBytes) },
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
      {
        id: 'createdAt',
        header: 'Uploaded',
        meta: { nowrap: true },
        accessorFn: (tpl) => tpl.createdAt,
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt * 1000).toLocaleDateString()
            : '—',
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { align: 'right', hug: true },
        cell: ({ row }) =>
          canEdit ? (
            <IconButton
              size="small"
              onClick={(e) => {
                setMenuAnchor(e.currentTarget)
                setMenuTemplate(row.original)
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
      <PageHeader title="Container templates" />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <DataTable
        rows={templates}
        columns={columns}
        filterPlaceholder="Filter by name, datastore or node"
        getRowId={(tpl) => `${tpl.hypervisorId}/${tpl.id}`}
        initialSort={[{ id: 'name', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No container templates found on your servers.'}
      />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setConfirming(menuTemplate)
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
        body={`This permanently removes the template from ${confirming?.storage} on ${
          confirming ? hypervisorName(confirming.hypervisorId) : ''
        }. Existing containers are unaffected; new ones can no longer be created from it.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
