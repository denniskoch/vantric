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
  Tooltip,
} from '@mui/material'
import { api } from '../api/client'
import type { VulnerabilitySummary } from '../api/client'
import PageHeader from '../components/PageHeader'

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
export default function SecurityVulnerabilitiesPage() {
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
              {/* Replaces Detected, which answered "when did Fleet
                  first see this" — true of every row, useful on almost
                  none, and never the reason anyone opened this page. */}
              <TableCell>What it is</TableCell>
              <TableCell align="right">Affected hosts</TableCell>
              {hasScores && <TableCell>Severity</TableCell>}
              {hasEPSS && <TableCell align="right">Exploit probability</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((v) => (
              <TableRow key={v.cve} hover>
                {/* An identifier must not wrap: broken across two
                    lines it stops being scannable, which is the only
                    thing it's good for. */}
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {/* Stays in the console: who has it and what to
                      upgrade is the question, and NVD is a click away
                      from there. */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Link
                      component={RouterLink}
                      to={`/security/vulnerabilities/${encodeURIComponent(v.cve)}`}
                      underline="hover"
                    >
                      {v.cve}
                    </Link>
                    {v.knownExploited && (
                      <Tooltip title={v.exploitedName || "In CISA's catalogue of exploited vulnerabilities"}>
                        <Chip
                          label="Exploited"
                          size="small"
                          sx={{ fontSize: 10, height: 18, bgcolor: 'surface.errorTint', color: 'error.main' }}
                        />
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
                <TableCell sx={{ maxWidth: 460 }}>
                  <Describe v={v} />
                </TableCell>
                <TableCell align="right">{v.hosts || '—'}</TableCell>
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
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
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

/**
 * What the flaw actually is, in one line.
 *
 * CISA's name where there is one — "Apache Log4j2 Remote Code Execution
 * Vulnerability" is six words that beat any amount of prose — otherwise
 * NVD's description, clamped to the row with the whole thing on hover.
 * Clamped rather than truncated in code: a table row is the wrong place
 * to guess where a sentence ends, and the browser already does this.
 *
 * A CVE the enricher hasn't reached says so. Blank would read as "no
 * description exists", which is a different and wrong answer — the same
 * distinction the bucket scanner's "—" makes.
 */
function Describe({ v }: { v: VulnerabilitySummary }) {
  const text = v.exploitedName || v.description
  if (!text) {
    return (
      <Tooltip title="Descriptions are filled in by the background pass over the vulnerability database. This one hasn't been reached yet.">
        <Box component="span" sx={{ color: 'text.disabled', fontSize: 13 }}>
          Not looked up yet
        </Box>
      </Tooltip>
    )
  }
  return (
    <Tooltip title={text}>
      <Box
        sx={{
          fontSize: 13,
          color: 'text.secondary',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {text}
      </Box>
    </Tooltip>
  )
}
