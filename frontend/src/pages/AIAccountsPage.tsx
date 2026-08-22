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
  Typography,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../api/client'
import type { AIAccount, AIAccountBalance } from '../api/client'
import PageHeader from '../components/PageHeader'
import ProviderName from '../components/ProviderName'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

/**
 * What's left where you pay.
 *
 * The gateway knows what went through it; nothing knows what remains
 * at each provider, and that answer otherwise lives behind one login
 * per provider. This is the connective work — except that here the
 * providers genuinely disagree about what they'll tell you, so the
 * page shows WHAT EACH ONE SAID rather than forcing four answers into
 * one column: credits in dollars, an allowance in characters, or spend
 * to date from a provider that won't say what's left.
 */
export default function AIAccountsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<AIAccount | null>(null)
  const [deleting, setDeleting] = useState<AIAccount | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['aiAccounts'],
    queryFn: api.listAIAccounts,
    // A balance moves when you spend, not when you look. Reading it
    // costs a request to somebody else's API, so this polls slowly.
    refetchInterval: 5 * 60_000,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAIAccount(id),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['aiAccounts'] })
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Provider accounts"
        description="What's left where you pay. The gateway knows what it sent; only the provider knows what remains."
        actions={
          <Button
            variant="contained"
            size="small"
            startIcon={<AddBoxIcon />}
            component={RouterLink}
            to="/ai/accounts/add"
          >
            Add
          </Button>
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
              <TableCell>Provider</TableCell>
              <TableCell>Name</TableCell>
              <TableCell align="right">Remaining</TableCell>
              <TableCell align="right">Used</TableCell>
              <TableCell align="right">Purchased</TableCell>
              <TableCell>Read</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <ProviderName name={a.type} />
                </TableCell>
                <TableCell>{a.name}</TableCell>
                <TableCell align="right">
                  <Remaining account={a} />
                </TableCell>
                <TableCell align="right">
                  {a.balance ? amount(a.balance, a.balance.used) : '—'}
                </TableCell>
                <TableCell align="right">
                  {a.balance?.granted ? amount(a.balance, a.balance.granted) : '—'}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  {a.balance ? new Date(a.balance.asOf).toLocaleTimeString() : '—'}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setMenuAnchor(e.currentTarget)
                      setSelected(a)
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {accounts.some((a) => a.error) && (
              <TableRow>
                <TableCell colSpan={7} sx={{ color: 'error.main', fontSize: 12 }}>
                  {accounts.find((a) => a.error)?.error}
                </TableCell>
              </TableRow>
            )}
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No provider accounts yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (selected) navigate(`/ai/accounts/${selected.id}/edit`)
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleting(selected)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Remove
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Remove ${deleting?.name}?`}
        body={<>The stored key is deleted. Nothing changes at {deleting?.type}.</>}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Box>
  )
}

/**
 * The number, or the reason there isn't one.
 *
 * "This provider has no balance API" and "we couldn't reach it" are
 * different facts and neither of them is a dash — the same rule the
 * SMBIOS serial follows. Only a provider that answered gets a figure.
 */
function Remaining({ account }: { account: AIAccount }) {
  if (account.status === 'unsupported') {
    return (
      <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
        no balance API
      </Typography>
    )
  }
  if (!account.balance) {
    return (
      <Typography component="span" sx={{ fontSize: 12, color: 'error.main' }}>
        unreadable
      </Typography>
    )
  }
  if (account.balance.kind === 'spend') {
    return (
      <Typography component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>
        {amount(account.balance, account.balance.used)} spent
      </Typography>
    )
  }
  const left = account.balance.remaining
  if (left === undefined) return <>—</>
  return (
    <Typography component="span" sx={{ fontSize: 13, color: left <= 0 ? 'error.main' : undefined }}>
      {amount(account.balance, left)}
    </Typography>
  )
}

/** A figure in the provider's own unit, because they don't share one. */
function amount(balance: AIAccountBalance, value: number): string {
  if (balance.unit === 'USD') return `$${value.toFixed(2)}`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ${balance.unit}`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K ${balance.unit}`
  return `${value} ${balance.unit}`
}
