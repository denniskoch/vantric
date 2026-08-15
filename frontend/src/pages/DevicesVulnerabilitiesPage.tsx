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

/**
 * Every CVE across the estate, worst first.
 *
 * The per-instance tab answers "what does this machine carry". This
 * answers the question you actually ask when something lands: who has
 * it, and is it being exploited. Only the inventory service can count
 * that, so this is its number rather than one derived here.
 */
export default function DevicesVulnerabilitiesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['inventoryVulnerabilities'],
    queryFn: api.listInventoryVulnerabilities,
    refetchInterval: 300000,
  })

  const rows = [...(data?.vulnerabilities ?? [])].sort(
    (a, b) =>
      Number(b.knownExploited) - Number(a.knownExploited) ||
      b.cvssScore - a.cvssScore ||
      b.hosts - a.hosts,
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Vulnerabilities"
        description="Known CVEs across every machine your inventory service tracks, exploited ones first."
      />

      {data && !data.configured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No inventory service is connected.{' '}
          <Link component={RouterLink} to="/devices/settings/inventory" underline="hover">
            Connect one
          </Link>{' '}
          to see this.
        </Alert>
      )}

      {/* A missing feature reads differently from a broken connection,
          and this one is common: the roll-up is a paid feature in Fleet
          while the per-host list isn't. */}
      {data?.configured && !data.supported && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Your inventory service doesn't offer a fleet-wide vulnerability list — in
          Fleet this endpoint needs a recent version and a Premium licence. Each
          instance's OS Info tab still shows its own CVEs, which come from the host
          detail and are always available.
        </Alert>
      )}

      {data?.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {data.error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>CVE</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell align="right">Hosts</TableCell>
              <TableCell align="right">Exploit probability</TableCell>
              <TableCell>Published</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.cve} hover>
                <TableCell>
                  {/* Stays in the console: who has it and what to
                      upgrade is the question, and NVD is a click away
                      from there. */}
                  <Link
                    component={RouterLink}
                    to={`/devices/vulnerabilities/${encodeURIComponent(v.cve)}`}
                    underline="hover"
                  >
                    {v.cve}
                  </Link>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      component="span"
                      sx={{
                        color:
                          v.severity === 'CRITICAL' || v.severity === 'HIGH'
                            ? '#d93025'
                            : v.severity === 'MEDIUM'
                              ? '#e37400'
                              : '#5f6368',
                      }}
                    >
                      {v.severity}
                    </Box>
                    {v.cvssScore > 0 && (
                      <Box component="span" sx={{ fontSize: 11, color: '#80868b' }}>
                        {v.cvssScore.toFixed(1)}
                      </Box>
                    )}
                    {v.knownExploited && (
                      <Chip
                        label="Exploited"
                        size="small"
                        sx={{ fontSize: 10, height: 18, bgcolor: '#fce8e6', color: '#d93025' }}
                      />
                    )}
                  </Box>
                </TableCell>
                <TableCell align="right">{v.hosts || '—'}</TableCell>
                <TableCell align="right">
                  {v.epss > 0 ? `${(v.epss * 100).toFixed(1)}%` : '—'}
                </TableCell>
                <TableCell sx={{ color: '#5f6368' }}>
                  {v.publishedAt ? new Date(v.publishedAt * 1000).toLocaleDateString() : '—'}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : data?.configured && data.supported
                      ? 'No known vulnerabilities across your machines.'
                      : 'Nothing to show.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
