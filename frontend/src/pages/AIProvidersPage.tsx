import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, IconButton, Menu, MenuItem, Typography } from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import AddIcon from '@mui/icons-material/Add'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import ProviderName from '../components/ProviderName'
import CellLines from '../components/CellLines'
import EnabledIcon from '../components/EnabledIcon'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'
import { api } from '../api/client'
import type { AIGatewayKey, AIGatewayProvider } from '../api/client'

/**
 * What the gateway can reach, and with which credentials.
 *
 * A different question from Provider accounts, which is what's LEFT at
 * each provider. This is the gateway's own configuration, read from
 * it — the daily 90%. Adding a provider or rotating an upstream key
 * stays in the gateway's own console, where the blast radius is.
 *
 * Keys are shown MASKED, as the gateway masks them. A key is listed so
 * you can tell which one is configured, not so it can be copied.
 */
export default function AIProvidersPage() {
  const { data: providers = [], isLoading, error } = useQuery({
    queryKey: ['aiGatewayProviders'],
    queryFn: api.listAIGatewayProviders,
    refetchInterval: 5 * 60_000,
  })

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canAdmin } = usePermissions()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<AIGatewayProvider | null>(null)
  const [dropping, setDropping] = useState<AIGatewayProvider | null>(null)
  const [droppingKey, setDroppingKey] = useState<{ provider: string; key: AIGatewayKey } | null>(
    null,
  )
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: can } = useQuery({ queryKey: ['aiCapabilities'], queryFn: api.aiCapabilities })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['aiGatewayProviders'] })

  const disconnect = useMutation({
    mutationFn: (name: string) => api.deleteAIGatewayProvider(name),
    onSuccess: () => {
      setDropping(null)
      invalidate()
    },
    onError: (e: Error) => {
      setDropping(null)
      setActionError(e.message)
    },
  })
  const removeKey = useMutation({
    mutationFn: (t: { provider: string; keyId: string }) =>
      api.deleteAIGatewayKey(t.provider, t.keyId),
    onSuccess: () => {
      setDroppingKey(null)
      invalidate()
    },
    onError: (e: Error) => {
      setDroppingKey(null)
      setActionError(e.message)
    },
  })

  // WRITING IS OWNER-ONLY HERE, unlike virtual keys and budgets: a
  // provider carries a vendor API key, which is a standing grant of
  // spend. The middleware enforces it; this only decides what to offer.
  const mayEdit = Boolean(can?.providers) && canAdmin

  const columns = useMemo<ColumnDef<AIGatewayProvider, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Provider',
        meta: { nowrap: true },
        accessorFn: (p) => p.name,
        cell: ({ row }) => <ProviderName name={row.original.name} />,
      },
      // The name and the key itself are two columns, not one cell
      // holding both. A provider with two keys stacks a line in each,
      // and top-aligned rows keep line one against line one.
      {
        id: 'keyNames',
        header: 'Key name',
        enableSorting: false,
        meta: {
          nowrap: true,
          filterText: (p: AIGatewayProvider) => p.keys.map((k) => k.name).join(' '),
        },
        cell: ({ row }) =>
          row.original.keys.length === 0 ? (
            // A provider the gateway knows of but holds no key for
            // can't serve anything. Said, rather than left as a zero
            // in the column to the left.
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              no key — this provider can't be reached
            </Typography>
          ) : (
            <CellLines>
              {row.original.keys.map((k) => (
                <Box key={k.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {/* Leading, not trailing. Whether a key is in use is
                      the first thing about it, and a badge at the end
                      of a name only announces the unusual case — which
                      leaves the ordinary one saying nothing. */}
                  <EnabledIcon
                    enabled={k.enabled}
                    on="In use"
                    off="Disabled on the gateway"
                  />
                  <Box
                    component={mayEdit ? 'button' : 'span'}
                    onClick={
                      mayEdit
                        ? () => navigate(`/ai/providers/${row.original.name}/keys/${k.id}`)
                        : undefined
                    }
                    sx={
                      mayEdit
                        ? {
                            border: 0,
                            background: 'none',
                            p: 0,
                            font: 'inherit',
                            color: 'primary.main',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }
                        : undefined
                    }
                  >
                    {k.name}
                  </Box>
                  {k.models.length > 0 && k.models[0] !== '*' && (
                    <Chip
                      label={`${k.models.length} model${k.models.length === 1 ? '' : 's'}`}
                      size="small"
                      sx={{ fontSize: 10, height: 18 }}
                    />
                  )}
                </Box>
              ))}
            </CellLines>
          ),
      },
      {
        id: 'keyValues',
        header: 'Key',
        enableSorting: false,
        meta: { nowrap: true },
        // A local provider needs no secret, so the gateway stores the
        // host as the "key" and leaves its value empty — Ollama's two
        // are machine names. Blank would read as "we didn't look", so
        // the absence is written out.
        cell: ({ row }) => (
          <CellLines>
            {row.original.keys.map((k) => (
              <Typography
                key={k.id}
                sx={{
                  fontSize: 12,
                  color: 'text.secondary',
                  fontFamily: k.masked ? 'monospace' : undefined,
                  fontStyle: k.masked ? undefined : 'italic',
                }}
              >
                {k.masked || 'no secret'}
              </Typography>
            ))}
          </CellLines>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { hug: true },
        cell: ({ row }) => (
          <IconButton
            size="small"
            aria-label={`Actions for ${row.original.name}`}
            onClick={(e) => {
              setMenuAnchor(e.currentTarget)
              setSelected(row.original)
            }}
          >
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
        ),
      },
    ],
    [mayEdit, navigate],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Providers"
        description="The model providers your gateway is configured to reach, and the keys it holds for each."
        actions={
          mayEdit && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => navigate('/ai/providers/new')}
            >
              Connect
            </Button>
          )
        }
      />

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      <DataTable
        rows={providers}
        columns={columns}
        getRowId={(p) => p.name}
        alignTop
        initialSort={[{ id: 'name', desc: false }]}
        filterPlaceholder="Filter by provider or key name"
        empty={isLoading ? 'Loading…' : 'The gateway has no providers configured.'}
      />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          disabled={!mayEdit}
          onClick={() => {
            if (selected) navigate(`/ai/providers/${selected.name}/keys/new`)
            setMenuAnchor(null)
          }}
        >
          <VpnKeyIcon fontSize="small" sx={{ mr: 1 }} /> Add key
        </MenuItem>
        {/* One key is the ordinary case, so editing it is one click
            from here as well as from the name in the row. */}
        <MenuItem
          disabled={!mayEdit || selected?.keys.length !== 1}
          onClick={() => {
            if (selected) navigate(`/ai/providers/${selected.name}/keys/${selected.keys[0].id}`)
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit key
        </MenuItem>
        <MenuItem
          disabled={!mayEdit || selected?.keys.length !== 1}
          onClick={() => {
            if (selected) setDroppingKey({ provider: selected.name, key: selected.keys[0] })
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Remove key
        </MenuItem>
        <MenuItem
          disabled={!mayEdit}
          onClick={() => {
            setDropping(selected)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Disconnect provider
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(dropping)}
        title={`Disconnect ${dropping?.name}?`}
        confirmPhrase={dropping?.name}
        body="The gateway loses this provider and the keys it holds for it. Anything routed here stops working."
        pending={disconnect.isPending}
        onCancel={() => setDropping(null)}
        onConfirm={() => dropping && disconnect.mutate(dropping.name)}
      />

      <ConfirmDeleteDialog
        open={Boolean(droppingKey)}
        title={`Remove ${droppingKey?.key.name}?`}
        body={`${droppingKey?.provider} loses this credential. The provider stays connected.`}
        pending={removeKey.isPending}
        onCancel={() => setDroppingKey(null)}
        onConfirm={() =>
          droppingKey && removeKey.mutate({ provider: droppingKey.provider, keyId: droppingKey.key.id })
        }
      />
    </Box>
  )
}
