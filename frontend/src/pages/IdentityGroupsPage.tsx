import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Chip,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

export default function IdentityGroupsPage() {
  const { data: providers = [] } = useQuery({
    queryKey: ['identityProviders'],
    queryFn: api.listIdentityProviders,
  })
  const {
    data: groups = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['identityGroups'],
    queryFn: api.listIdentityGroups,
    enabled: providers.length > 0,
    retry: false,
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Groups"
        description={
          <>
                Membership is usually what grants access to an application, and a
            superuser group is what makes someone an administrator.
          </>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Parent</TableCell>
              <TableCell align="right">Members</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.id} hover>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/identity/groups/${group.id}`}
                    underline="hover"
                  >
                    {group.name}
                  </Link>
                  {group.superuser && (
                    <Chip
                      label="superuser"
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18, ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell>{group.parent || '—'}</TableCell>
                <TableCell align="right">{group.members}</TableCell>
              </TableRow>
            ))}
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No groups.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
