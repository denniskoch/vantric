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
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import { api } from '../api/client'
import type { Image } from '../api/client'
import { useServerNames } from '../useServerNames'
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
  const serverName = useServerNames()
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
    instances.filter((i) => i.serverId === tpl.serverId && i.imageId === tpl.id).length

  const remove = useMutation({
    mutationFn: (tpl: Image) => api.deleteImage(tpl.serverId, tpl.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] })
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

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Operating system</TableCell>
              <TableCell>ID</TableCell>
              <TableCell>Server</TableCell>
              <TableCell>Zone</TableCell>
              <TableCell align="right">Instances</TableCell>
              <TableCell>Built</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.map((tpl) => {
              const id = templateIdentity(tpl)
              return (
              <TableRow key={`${tpl.serverId}/${tpl.id}`} hover>
                <TableCell>
                  {/* What it is, then what it's called. The raw name
                      stays visible because it's what Proxmox shows and
                      what you type when something goes wrong. */}
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ width: 16, mt: 0.25 }}>
                      <OSIcon name={`${tpl.name} ${id.family}`} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Box>{id.title}</Box>
                      {id.title !== tpl.name && (
                        <Box sx={{ fontSize: 11, color: 'text.secondary' }}>{tpl.name}</Box>
                      )}
                    </Box>
                  </Box>
                </TableCell>
                <TableCell>
                  {id.family === 'Other' ? (
                    '—'
                  ) : (
                    <>
                      {id.family}
                      {id.version && ` ${id.version}`}
                    </>
                  )}
                </TableCell>
                <TableCell>{tpl.id}</TableCell>
                <TableCell>{serverName(tpl.serverId)}</TableCell>
                <TableCell>{tpl.zone || '—'}</TableCell>
                <TableCell align="right">{clonesOf(tpl) || '—'}</TableCell>
                <TableCell>{builtOn(tpl.createdAt)}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{id.notes || '—'}</TableCell>
                <TableCell align="right">
                  {canEdit && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        setMenuAnchor(e.currentTarget)
                        setMenuTemplate(tpl)
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
              )
            })}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No VM templates found on your servers.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (menuTemplate) {
              navigate(`/compute/vm-templates/${menuTemplate.serverId}/${menuTemplate.id}/description`)
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
            {confirming ? serverName(confirming.serverId) : ''}. Instances already
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
