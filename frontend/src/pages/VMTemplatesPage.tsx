import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
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
import EditIcon from '@mui/icons-material/Edit'
import { api } from '../api/client'
import type { Image } from '../api/client'
import { useHypervisorNames } from '../useHypervisorNames'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import { OSIcon } from '../components/OSName'
import { templateIdentity } from '../osIdentity'
import { usePermissions } from '../user'

// VM templates (Proxmox template VMs) — the sources "create instance"
// clones from. Deleting one destroys a VM and its disks, unlike the
// file-based CT template and ISO listings.
export default function VMTemplatesPage() {
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const hypervisorName = useHypervisorNames()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuTemplate, setMenuTemplate] = useState<Image | null>(null)
  const [confirming, setConfirming] = useState<Image | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['images'],
    queryFn: () => api.listImages(),
  })
  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: api.listInstances,
  })

  // Instances record the template they were cloned from; surface that
  // count so a template isn't deleted blind.
  const clonesOf = (tpl: Image) =>
    instances.filter((i) => i.hypervisorId === tpl.hypervisorId && i.imageId === tpl.id).length

  const remove = useMutation({
    mutationFn: (tpl: Image) => api.deleteImage(tpl.hypervisorId, tpl.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] })
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
        // Sorts on the DERIVED title, which is what the row leads with —
        // sorting on tpl.name would order by a filename the eye reads
        // second. See osIdentity.
        header: 'Name',
        accessorFn: (tpl) => templateIdentity(tpl).title,
        cell: ({ row }) => {
          const id = templateIdentity(row.original)
          return (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ width: 16, mt: 0.25 }}>
                <OSIcon name={`${row.original.name} ${id.family}`} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Box>{id.title}</Box>
                {id.title !== row.original.name && (
                  <Box sx={{ fontSize: 11, color: 'text.secondary' }}>{row.original.name}</Box>
                )}
              </Box>
            </Box>
          )
        },
      },
      {
        id: 'family',
        header: 'Operating system',
        accessorFn: (tpl) => {
          const id = templateIdentity(tpl)
          return id.family === 'Other' ? undefined : `${id.family} ${id.version ?? ''}`.trim()
        },
        cell: ({ row }) => {
          const id = templateIdentity(row.original)
          if (id.family === 'Other') return '—'
          return (
            <>
              {id.family}
              {id.version && ` ${id.version}`}
            </>
          )
        },
      },
      { id: 'id', header: 'ID', accessorFn: (tpl) => tpl.id },
      {
        id: 'node',
        header: 'Node',
        accessorFn: (tpl) => tpl.node,
        cell: ({ row }) => row.original.node || '—',
      },
      {
        id: 'clones',
        header: 'Instances',
        accessorFn: (tpl) => clonesOf(tpl) || undefined,
        meta: { align: 'right' },
        cell: ({ row }) => clonesOf(row.original) || '—',
      },
      {
        id: 'createdAt',
        header: 'Built',
        meta: { nowrap: true },
        accessorFn: (tpl) => tpl.createdAt,
        cell: ({ row }) => builtOn(row.original.createdAt),
      },
      {
        id: 'notes',
        header: 'Notes',
        accessorFn: (tpl) => templateIdentity(tpl).notes,
        cell: ({ row }) => (
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {templateIdentity(row.original).notes || '—'}
          </Box>
        ),
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
                setMenuTemplate(row.original)
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          ) : null,
      },
    ],
    [canEdit, clonesOf],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="VM templates"
        actions={
          canEdit && (
            <Button
              component={RouterLink}
              to="/compute/vm-templates/build"
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
            >
              Build template
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
        rows={templates}
        columns={columns}
        getRowId={(tpl) => `${tpl.hypervisorId}/${tpl.id}`}
        initialSort={[{ id: 'name', desc: false }]}
        empty={isLoading ? 'Loading…' : 'No VM templates found on your servers.'}
      />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (menuTemplate) {
              navigate(`/compute/vm-templates/${menuTemplate.hypervisorId}/${menuTemplate.id}/description`)
            }
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit description
        </MenuItem>
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
        title={`Delete template ${confirming?.name}?`}
        body={
          <>
            This destroys template VM {confirming?.id} and its disks on{' '}
            {confirming ? hypervisorName(confirming.hypervisorId) : ''}. Instances already
            created from it keep running — they are full clones — but no new ones
            can be created from this template.
            {confirming && clonesOf(confirming) > 0 && (
              <>
                {' '}
                <strong>
                  {clonesOf(confirming)} instance
                  {clonesOf(confirming) === 1 ? '' : 's'} still record
                  {clonesOf(confirming) === 1 ? 's' : ''} it as their source image.
                </strong>
              </>
            )}
          </>
        }
        confirmPhrase={confirming?.name}
        confirmLabel="to delete it"
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}

/** The hypervisor records when a template VM was made; nobody should
 *  be typing that into a description. */
function builtOn(createdAt: number): string {
  if (!createdAt) return '—'
  return new Date(createdAt * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
