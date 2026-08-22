import { useMemo } from 'react'
import DataTable from '../components/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Link,
  Tooltip,
} from '@mui/material'
import { api } from '../api/client'
import type { VulnerabilitySummary } from '../api/client'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import PageHeader from '../components/PageHeader'
import { severityColor, severityLabel } from '../severity'

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

  const all = data?.vulnerabilities ?? []
  // Only render what the service actually fills in.
  const hasScores = all.some((v) => v.cvssScore > 0)
  const hasEPSS = all.some((v) => v.epss > 0)


  const columns = useMemo<ColumnDef<VulnerabilitySummary, unknown>[]>(() => {
    const defs: ColumnDef<VulnerabilitySummary, unknown>[] = [
      {
        // The flame is its OWN column now. It used to sit inside the CVE
        // cell behind a fixed 18px spacer, which existed only to stop
        // three flames landing at three different offsets — a column
        // does that by construction. It also makes "show me the
        // exploited ones" a thing you can click rather than a fixed
        // default you cannot change.
        id: 'exploited',
        header: () => (
          <Tooltip title="Known exploited — sort to bring these together">
            <LocalFireDepartmentIcon
              fontSize="small"
              aria-label="Known exploited"
              sx={{ color: 'text.disabled', display: 'block' }}
            />
          </Tooltip>
        ),
        meta: { hug: true },
        accessorFn: (v) => v.knownExploited,
        cell: ({ row }) =>
          row.original.knownExploited ? (
            <Tooltip
              title={
                row.original.exploitedName
                  ? `Exploitable — ${row.original.exploitedName}`
                  : 'Exploitable — CISA lists this as one attackers have used'
              }
            >
              <LocalFireDepartmentIcon
                fontSize="small"
                aria-label="Known exploited"
                sx={{ color: 'error.main', display: 'block' }}
              />
            </Tooltip>
          ) : null,
      },
      {
        id: 'cve',
        header: 'CVE',
        // An identifier must not wrap: broken across two lines it stops
        // being scannable, which is the only thing it's good for.
        meta: { nowrap: true },
        accessorFn: (v) => v.cve,
        cell: ({ row }) => (
          <Link
            component={RouterLink}
            to={`/security/vulnerabilities/${encodeURIComponent(row.original.cve)}`}
            underline="hover"
          >
            {row.original.cve}
          </Link>
        ),
      },
    ]
    if (hasScores) {
      defs.push({
        id: 'severity',
        header: 'Severity',
        meta: {
          nowrap: true,
          filterText: (v) => severityLabel(v.severity, v.cvssScore) ?? 'not scored',
        },
        // NOT SCORED IS NOT A LOW SCORE. severityLabel returns null when
        // the service has no score, and undefined here sorts last in
        // both directions — so a descending sort doesn't open with a
        // screenful of flaws nobody has assessed, and an ascending one
        // doesn't rank them safer than a real LOW.
        accessorFn: (v) => (severityLabel(v.severity, v.cvssScore) ? v.cvssScore : undefined),
        cell: ({ row }) =>
          severityLabel(row.original.severity, row.original.cvssScore) ? (
            <Box component="span" sx={{ color: severityColor[row.original.severity] ?? '#5f6368' }}>
              {severityLabel(row.original.severity, row.original.cvssScore)}
            </Box>
          ) : (
            <Tooltip title="No score from the inventory service, and the vulnerability database hasn't been asked yet.">
              <Box component="span" sx={{ color: 'text.disabled' }}>
                Not scored
              </Box>
            </Tooltip>
          ),
      })
    }
    defs.push({
      id: 'description',
      header: 'Description',
      // What Describe renders, so searching for "log4j" finds the row
      // whose description says so — the reason this page has a filter.
      accessorFn: (v) => v.exploitedName || v.description,
      cell: ({ row }) => <Describe v={row.original} />,
    })
    defs.push({
      id: 'hosts',
      header: 'Affected hosts',
      meta: { align: 'right' },
      accessorFn: (v) => v.hosts || undefined,
      cell: ({ row }) => row.original.hosts || '—',
    })
    if (hasEPSS) {
      defs.push({
        id: 'epss',
        header: 'Exploit probability',
        meta: { align: 'right', nowrap: true },
        accessorFn: (v) => (v.epss > 0 ? v.epss : undefined),
        cell: ({ row }) =>
          row.original.epss > 0 ? `${(row.original.epss * 100).toFixed(1)}%` : '—',
      })
    }
    return defs
  }, [hasScores, hasEPSS])

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

      <DataTable
        rows={all}
        columns={columns}
        getRowId={(v) => v.cve}
        // The order this page has always opened in, now as a starting
        // point rather than a fixture: exploited first, then the ones on
        // the most machines, then the worst scored, then by id so the
        // list is stable between polls.
        initialSort={[
          { id: 'exploited', desc: true },
          { id: 'hosts', desc: true },
          { id: 'severity', desc: true },
          { id: 'cve', desc: false },
        ]}
        filterPlaceholder="Filter by CVE, description or severity"
        empty={
          isLoading
            ? 'Loading…'
            : data?.configured && data.supported
              ? 'No known vulnerabilities across your machines.'
              : 'Nothing to show.'
        }
      />
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
