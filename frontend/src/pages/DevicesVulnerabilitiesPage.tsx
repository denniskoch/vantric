import { useState } from 'react'
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
  TablePagination,
  TableRow,
} from '@mui/material'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { timeAgo } from '../format'

/**
 * Every CVE across the estate, worst first.
 *
 * The per-instance tab answers "what does this machine carry". This
 * answers the question you actually ask when something lands: who has
 * it. Sorted by that count, because with hundreds of CVEs the one on
 * twelve machines matters more than the one on a laptop.
 *
 * Columns appear only when the data does. A free Fleet reports no CVSS
 * and no EPSS, so a Severity column would say MINIMAL for everything —
 * which reads as a judgement rather than as an absence. On a tier that
 * scores, the columns come back on their own.
 */
export default function DevicesVulnerabilitiesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['inventoryVulnerabilities'],
    queryFn: api.listInventoryVulnerabilities,
    refetchInterval: 300000,
  })

  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(25)

  const all = data?.vulnerabilities ?? []
  // Only render what the service actually fills in.
  const hasScores = all.some((v) => v.cvssScore > 0)
  const hasEPSS = all.some((v) => v.epss > 0)
  const hasExploited = all.some((v) => v.knownExploited)

  const rows = [...all].sort(
    (a, b) =>
      Number(b.knownExploited) - Number(a.knownExploited) ||
      b.hosts - a.hosts ||
      b.cvssScore - a.cvssScore ||
      a.cve.localeCompare(b.cve),
  )
  const shown = rows.slice(page * perPage, page * perPage + perPage)

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
              <TableCell align="right">Affected hosts</TableCell>
              <TableCell>Detected</TableCell>
              {hasScores && <TableCell>Severity</TableCell>}
              {hasEPSS && <TableCell align="right">Exploit probability</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((v) => (
              <TableRow key={v.cve} hover>
                <TableCell>
                  {/* Stays in the console: who has it and what to
                      upgrade is the question, and NVD is a click away
                      from there. */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Link
                      component={RouterLink}
                      to={`/devices/vulnerabilities/${encodeURIComponent(v.cve)}`}
                      underline="hover"
                    >
                      {v.cve}
                    </Link>
                    {hasExploited && v.knownExploited && (
                      <Chip
                        label="Exploited"
                        size="small"
                        sx={{ fontSize: 10, height: 18, bgcolor: '#fce8e6', color: '#d93025' }}
                      />
                    )}
                  </Box>
                </TableCell>
                <TableCell align="right">{v.hosts || '—'}</TableCell>
                <TableCell sx={{ color: '#5f6368' }}>{timeAgo(v.detectedAt)}</TableCell>
                {hasScores && (
                  <TableCell>
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
                      {v.severity} {v.cvssScore.toFixed(1)}
                    </Box>
                  </TableCell>
                )}
                {hasEPSS && (
                  <TableCell align="right">
                    {v.epss > 0 ? `${(v.epss * 100).toFixed(1)}%` : '—'}
                  </TableCell>
                )}
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
      {rows.length > 0 && (
        <TablePagination
          component="div"
          count={rows.length}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={perPage}
          rowsPerPageOptions={[25, 50, 100]}
          onRowsPerPageChange={(e) => {
            setPerPage(Number(e.target.value))
            setPage(0)
          }}
        />
      )}
    </Box>
  )
}
