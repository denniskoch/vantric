import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { api } from '../api/client'
import { BrandLabel } from '../components/BrandIcon'
import PageHeader from '../components/PageHeader'
import { appBrand } from '../brands'

export default function IdentityApplicationsPage() {
  const { data: providers = [] } = useQuery({
    queryKey: ['identityProviders'],
    queryFn: api.listIdentityProviders,
  })
  const {
    data: apps = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['identityApplications'],
    queryFn: api.listIdentityApplications,
    enabled: providers.length > 0,
    retry: false,
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Applications"
        description={
          <>
                Services your users sign in to through this provider, and the mechanism
            behind each one.
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
              <TableCell>Slug</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Launch</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {apps.map((app) => (
              <TableRow key={app.id} hover>
                <TableCell>
                  <BrandLabel icon={appBrand(app.name)} label={app.name} />
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{app.slug}</TableCell>
                <TableCell>{app.provider || '—'}</TableCell>
                <TableCell>{app.providerType || '—'}</TableCell>
                <TableCell>
                  {app.launchUrl ? (
                    <Link
                      href={app.launchUrl}
                      target="_blank"
                      rel="noreferrer"
                      underline="hover"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                    >
                      {app.launchUrl}
                      <OpenInNewIcon sx={{ fontSize: 14 }} />
                    </Link>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
            {apps.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No applications.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
