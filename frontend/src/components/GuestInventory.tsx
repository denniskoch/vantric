import { useState } from 'react'
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
  Typography,
} from '@mui/material'
import { api } from '../api/client'
import type { Vulnerability } from '../api/client'

/**
 * What the agent inside this guest reports: its packages, and the CVEs
 * those versions carry.
 *
 * None of it is collected here. An inventory service (FleetDM) runs
 * osquery on the machine and owns the answer; this puts it beside the
 * machine's disks and addresses, which is the one view that service
 * can't produce because it has never heard of a hypervisor.
 *
 * Read on demand and never polled: it's someone else's database, and
 * the numbers only change as fast as their agent checks in — which is
 * why every panel says when it was last collected rather than implying
 * it's live.
 */
export default function GuestInventory({ instance }: { instance: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['instanceInventory', instance],
    queryFn: () => api.instanceInventory(instance),
  })

  if (isLoading || !data) return null

  // No inventory service connected at all: say so once, quietly, and
  // don't dress it up as a problem with this guest.
  if (!data.configured) {
    return (
      <Box sx={{ mt: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Connect a device inventory service (Devices → Settings → Inventory service) to see
          installed packages and known vulnerabilities for this guest.
        </Typography>
      </Box>
    )
  }

  if (data.error) {
    return (
      <Alert severity="warning" sx={{ mt: 3 }}>
        {data.error}
      </Alert>
    )
  }

  // Configured, reachable, and this machine isn't in it. That's a
  // finding — an unenrolled guest — not an empty table.
  if (!data.enrolled) {
    return (
      <Alert severity="info" sx={{ mt: 3 }}>
        This guest isn't enrolled in your inventory service. Nothing reports system
        UUID {data.uuid || '(unknown)'} — install the agent to see its packages and
        vulnerabilities here.
      </Alert>
    )
  }

  const detail = data.detail!
  const collected = detail.host.updatedAt
    ? new Date(detail.host.updatedAt * 1000).toLocaleString()
    : 'never'

  return (
    <>
      <Panel
        title="Vulnerabilities"
        collected={collected}
        empty="No known vulnerabilities in the installed packages."
        rows={detail.vulnerabilities.length}
      >
        <VulnerabilityTable vulnerabilities={detail.vulnerabilities} />
      </Panel>

      <Panel
        title="Installed packages"
        collected={collected}
        empty="The agent reported no packages."
        rows={detail.packages.length}
      >
        <PackageTable
          packages={detail.packages.map((p) => ({
            ...p,
            vulnerabilities: p.vulnerabilities ?? [],
          }))}
        />
      </Panel>
    </>
  )
}

function Panel({
  title,
  collected,
  empty,
  rows,
  children,
}: {
  title: string
  collected: string
  empty: string
  rows: number
  children: React.ReactNode
}) {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography sx={{ fontSize: 16, color: '#202124', mb: 1.5 }}>{title}</Typography>
      <Paper variant="outlined">
        {rows === 0 ? (
          <Typography sx={{ p: 2, fontSize: 13, color: '#5f6368' }}>{empty}</Typography>
        ) : (
          children
        )}
      </Paper>
      {/* The agent's clock, not ours: a package list is only as true as
          the last time the machine was asked. */}
      <Typography sx={{ fontSize: 11, color: '#80868b', mt: 0.5, textAlign: 'right' }}>
        Last collected: {collected}
      </Typography>
    </Box>
  )
}

/** Worst first — a list sorted by CVE number buries the one that matters. */
const severityRank: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  MINIMAL: 4,
}

const severityColor: Record<string, string> = {
  CRITICAL: '#d93025',
  HIGH: '#d93025',
  MEDIUM: '#e37400',
  LOW: '#5f6368',
  MINIMAL: '#5f6368',
}

function VulnerabilityTable({ vulnerabilities }: { vulnerabilities: Vulnerability[] }) {
  const sorted = [...vulnerabilities].sort(
    (a, b) =>
      (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
      b.cvssScore - a.cvssScore ||
      a.cve.localeCompare(b.cve),
  )
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>CVE</TableCell>
            <TableCell>Severity</TableCell>
            <TableCell>Package</TableCell>
            <TableCell>Installed</TableCell>
            <TableCell>Fixed in</TableCell>
            <TableCell>Published</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((v) => (
            <TableRow key={`${v.cve}/${v.package}`} hover>
              <TableCell>
                {v.detailsUrl ? (
                  <Link href={v.detailsUrl} target="_blank" rel="noreferrer" underline="hover">
                    {v.cve}
                  </Link>
                ) : (
                  v.cve
                )}
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box component="span" sx={{ color: severityColor[v.severity] ?? '#5f6368' }}>
                    {v.severity}
                  </Box>
                  {v.cvssScore > 0 && (
                    <Box component="span" sx={{ fontSize: 11, color: '#80868b' }}>
                      {v.cvssScore.toFixed(1)}
                    </Box>
                  )}
                  {/* Known exploited beats any score: it is being used. */}
                  {v.knownExploited && (
                    <Chip
                      label="Exploited"
                      size="small"
                      sx={{ fontSize: 10, height: 18, bgcolor: '#fce8e6', color: '#d93025' }}
                    />
                  )}
                </Box>
              </TableCell>
              <TableCell>{v.package}</TableCell>
              <TableCell>{v.installedVersion || '—'}</TableCell>
              {/* The difference between "patch this" and "wait". */}
              <TableCell>{v.resolvedInVersion || 'No fix published'}</TableCell>
              <TableCell>
                {v.publishedAt ? new Date(v.publishedAt * 1000).toLocaleDateString() : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function PackageTable({
  packages,
}: {
  packages: { name: string; version: string; source: string; vulnerabilities: Vulnerability[] }[]
}) {
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(10)
  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name))
  const shown = sorted.slice(page * perPage, page * perPage + perPage)
  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Package</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Source</TableCell>
              <TableCell align="right">Vulnerabilities</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((p) => (
              <TableRow key={`${p.source}/${p.name}/${p.version}`} hover>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.version}</TableCell>
                <TableCell sx={{ color: '#5f6368' }}>{sourceLabel(p.source)}</TableCell>
                <TableCell align="right">
                  {p.vulnerabilities.length > 0 ? (
                    <Box component="span" sx={{ color: '#d93025' }}>
                      {p.vulnerabilities.length}
                    </Box>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={sorted.length}
        page={page}
        onPageChange={(_, next) => setPage(next)}
        rowsPerPage={perPage}
        rowsPerPageOptions={[10, 25, 100]}
        onRowsPerPageChange={(e) => {
          setPerPage(Number(e.target.value))
          setPage(0)
        }}
      />
    </>
  )
}

/** osquery's table names, in words: deb_packages is a fact about where
 *  it came from, not a name anybody says out loud. */
function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    deb_packages: 'APT package',
    rpm_packages: 'RPM package',
    apk_packages: 'APK package',
    python_packages: 'Python package',
    npm_packages: 'npm package',
    programs: 'Windows program',
    apps: 'Application',
    chrome_extensions: 'Browser extension',
    homebrew_packages: 'Homebrew package',
  }
  return labels[source] ?? source
}
