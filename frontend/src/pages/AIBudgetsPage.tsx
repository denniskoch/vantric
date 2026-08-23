import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import { api } from '../api/client'
import type { AILimit } from '../api/client'
import AddIcon from '@mui/icons-material/Add'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { usePermissions } from '../user'

/**
 * The caps the gateway enforces, and what each applies to.
 *
 * A budget's scope is almost always a virtual key, which means the
 * name in the first column is the same name the request log shows as
 * the caller — the two pages describe the same service.
 *
 * Rate limit columns appear only when the gateway reports one, the
 * same rule the request log's cost column follows. This lab has none
 * configured, so today the table is budgets.
 */
export default function AIBudgetsPage() {
  const { data: limits = [], isLoading, error } = useQuery({
    queryKey: ['aiLimits'],
    queryFn: api.listAILimits,
    refetchInterval: 60_000,
  })

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<AILimit | null>(null)
  const [deleting, setDeleting] = useState<AILimit | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: can } = useQuery({ queryKey: ['aiCapabilities'], queryFn: api.aiCapabilities })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['aiLimits'] })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAILimit(id),
    onSuccess: () => {
      setDeleting(null)
      invalidate()
    },
    onError: (e: Error) => {
      setDeleting(null)
      setActionError(e.message)
    },
  })
  const reset = useMutation({
    mutationFn: (id: string) => api.resetAILimitUsage(id),
    onSuccess: invalidate,
    onError: (e: Error) => setActionError(e.message),
  })

  const rateLimited = limits.some((l) => l.rateLimit)

  const columns = useMemo<ColumnDef<AILimit, unknown>[]>(
    () => [
      {
        id: 'scopeName',
        header: 'Applies to',
        meta: { nowrap: true },
        accessorFn: (l) => l.scopeName,
        cell: ({ row }) => (
          <Box>
            <span>{row.original.scopeName || '—'}</span>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
              {scopeLabel(row.original.scope)}
            </Typography>
          </Box>
        ),
      },
      {
        id: 'model',
        header: 'Models',
        meta: { nowrap: true },
        accessorFn: (l) => l.model,
        // "*" is the gateway's word for all of them; printed raw it
        // reads as a wildcard somebody typed.
        cell: ({ row }) =>
          row.original.model === '*' || !row.original.model ? (
            <Typography component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>
              all models
            </Typography>
          ) : (
            row.original.model
          ),
      },
      {
        id: 'spend',
        header: 'Spend',
        meta: { nowrap: true, maxWidth: 220 },
        accessorFn: (l) => (l.budget ? l.budget.used / Math.max(l.budget.max, 0.0001) : undefined),
        cell: ({ row }) => <Spend limit={row.original} />,
      },
      {
        id: 'period',
        header: 'Resets',
        meta: { nowrap: true },
        accessorFn: (l) => l.budget?.period,
        cell: ({ row }) =>
          row.original.budget ? every(row.original.budget.period) : '—',
      },
      {
        id: 'lastReset',
        header: 'Last reset',
        meta: { nowrap: true },
        accessorFn: (l) => l.budget?.lastReset,
        cell: ({ row }) =>
          row.original.budget?.lastReset
            ? new Date(row.original.budget.lastReset).toLocaleDateString()
            : '—',
      },
      ...(rateLimited
        ? [
            {
              id: 'rate',
              header: 'Rate limit',
              enableSorting: false,
              meta: { nowrap: true as const },
              cell: ({ row }: { row: { original: AILimit } }) => {
                const r = row.original.rateLimit
                if (!r) return <>—</>
                const parts: string[] = []
                if (r.maxRequests !== undefined) {
                  parts.push(`${r.maxRequests.toLocaleString()} requests ${every(r.requestPeriod)}`)
                }
                if (r.maxTokens !== undefined) {
                  parts.push(`${r.maxTokens.toLocaleString()} tokens ${every(r.tokenPeriod)}`)
                }
                return <>{parts.join(' · ') || '—'}</>
              },
            } as ColumnDef<AILimit, unknown>,
          ]
        : []),
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { hug: true },
        cell: ({ row }: { row: { original: AILimit } }) => (
          <IconButton
            size="small"
            aria-label={`Actions for ${row.original.scopeName}`}
            onClick={(e) => {
              setMenuAnchor(e.currentTarget)
              setSelected(row.original)
            }}
          >
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
        ),
      } as ColumnDef<AILimit, unknown>,
    ],
    [rateLimited],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Budgets"
        description="What the gateway will let each caller spend, and how much of it is gone."
        actions={
          can?.limits &&
          canEdit && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => navigate('/ai/budgets/new')}
            >
              Create
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
        rows={limits}
        columns={columns}
        getRowId={(l) => l.id}
        alignTop
        initialSort={[{ id: 'spend', desc: true }]}
        filterPlaceholder="Filter by caller or model"
        empty={
          isLoading
            ? 'Loading…'
            : 'No budgets or rate limits are set. Every caller can spend without a cap.'
        }
      />
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          disabled={!can?.limits || !canEdit}
          onClick={() => {
            if (selected) navigate(`/ai/budgets/${selected.id}/edit`)
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        {/* Its own action, not a checkbox on the form: forgiving what
            has been spent is a decision, and a save that did it too
            would make the cap meaningless. */}
        <MenuItem
          disabled={!can?.limits || !canEdit || !selected?.budget}
          onClick={() => {
            if (selected) reset.mutate(selected.id)
            setMenuAnchor(null)
          }}
        >
          <RestartAltIcon fontSize="small" sx={{ mr: 1 }} /> Reset usage
        </MenuItem>
        <MenuItem
          disabled={!can?.limits || !canEdit}
          onClick={() => {
            setDeleting(selected)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Delete the cap on ${deleting?.scopeName}?`}
        body="That caller becomes uncapped. Nothing else changes."
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Box>
  )
}

/** Used against the cap, with the bar that makes it readable at a
 *  glance. A budget nobody set renders as words, not an empty bar. */
function Spend({ limit }: { limit: AILimit }) {
  const budget = limit.budget
  if (!budget) {
    return (
      <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
        no budget
      </Typography>
    )
  }
  const fraction = budget.max > 0 ? budget.used / budget.max : 0
  const spent = Math.min(100, fraction * 100)
  return (
    <Box sx={{ minWidth: 160 }}>
      <Typography sx={{ fontSize: 13 }}>
        ${budget.used.toFixed(2)}{' '}
        <Box component="span" sx={{ color: 'text.secondary' }}>
          of ${budget.max.toFixed(2)}
        </Box>
      </Typography>
      <LinearProgress
        variant="determinate"
        value={spent}
        sx={{
          mt: 0.5,
          height: 4,
          borderRadius: 2,
          // Past four fifths is the point at which a cap stops being
          // theoretical, the same threshold the datastores use.
          '& .MuiLinearProgress-bar': {
            bgcolor: fraction >= 0.8 ? 'error.main' : 'primary.main',
          },
        }}
      />

    </Box>
  )
}

/** The gateway's duration strings, as words. */
function every(period?: string): string {
  if (!period) return ''
  const words: Record<string, string> = {
    '1h': 'hourly',
    '1d': 'daily',
    '1w': 'weekly',
    '1M': 'monthly',
  }
  return words[period] ?? `every ${period}`
}

function scopeLabel(scope: string): string {
  const words: Record<string, string> = {
    virtual_key: 'virtual key',
    team: 'team',
    customer: 'customer',
  }
  return words[scope] ?? scope
}
