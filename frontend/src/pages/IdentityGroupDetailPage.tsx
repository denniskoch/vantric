import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import PersonRemoveIcon from '@mui/icons-material/PersonRemove'
import { api } from '../api/client'
import type { IdentityUser } from '../api/client'
import DetailTable from '../components/DetailTable'
import { userKind } from '../identity'

export default function IdentityGroupDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState<IdentityUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['identityGroups'],
    queryFn: api.listIdentityGroups,
  })
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['identityUsers'],
    queryFn: api.listIdentityUsers,
  })

  const group = groups.find((g) => g.id === id)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['identityUsers'] })
    queryClient.invalidateQueries({ queryKey: ['identityGroups'] })
  }

  const addMember = useMutation({
    mutationFn: (user: IdentityUser) => api.addIdentityGroupMember(id, user.id),
    onSuccess: () => {
      setAdding(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })
  const removeMember = useMutation({
    mutationFn: (user: IdentityUser) => api.removeIdentityGroupMember(id, user.id),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  if (!group) {
    return (
      <Box sx={{ p: 3 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/identity/groups')}
        >
          Groups
        </Button>
        <Typography sx={{ mt: 2 }} color="text.secondary">
          {groupsLoading ? 'Loading group…' : 'That group no longer exists.'}
        </Typography>
      </Box>
    )
  }

  // Membership is already on each user, so the member list is a filter
  // rather than another round trip.
  const members = users.filter((user) => user.groups?.includes(group.name))
  const candidates = users.filter((user) => !user.groups?.includes(group.name))

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 1.5 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/identity/groups')}
        >
          Groups
        </Button>
        <Typography variant="h5">{group.name}</Typography>
        {group.superuser && (
          <Chip label="superuser" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
        )}
      </Box>

      <Box sx={{ px: 3, maxWidth: 1100 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {group.superuser && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Members of this group are administrators of the identity provider.
          </Alert>
        )}

        <DetailTable
          rows={[
            { label: 'Name', value: group.name },
            { label: 'Parent', value: group.parent || 'None' },
            { label: 'Members', value: group.members },
            { label: 'Grants administrator', value: group.superuser ? 'Yes' : 'No' },
          ]}
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 3, mb: 2 }}>
          <Autocomplete
            size="small"
            options={candidates}
            value={adding}
            onChange={(_, value) => setAdding(value)}
            getOptionLabel={(user) => `${user.username}${user.name ? ` — ${user.name}` : ''}`}
            sx={{ width: 360 }}
            renderInput={(params) => <TextField {...params} label="Add a member" />}
          />
          <Button
            variant="contained"
            size="small"
            disabled={!adding || addMember.isPending}
            onClick={() => adding && addMember.mutate(adding)}
          >
            Add
          </Button>
        </Box>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Username</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell>{user.username}</TableCell>
                  <TableCell>{user.name || '—'}</TableCell>
                  <TableCell>{user.email || '—'}</TableCell>
                  <TableCell>{userKind(user.kind)}</TableCell>
                  <TableCell sx={{ color: user.active ? undefined : '#d93025' }}>
                    {user.active ? 'Active' : 'Disabled'}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Remove from group">
                      <span>
                        <IconButton
                          size="small"
                          disabled={removeMember.isPending}
                          onClick={() => removeMember.mutate(user)}
                        >
                          <PersonRemoveIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    {usersLoading ? 'Loading…' : 'No members yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  )
}
