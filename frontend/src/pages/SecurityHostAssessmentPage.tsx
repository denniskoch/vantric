import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Collapse,
  Link,
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
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { api } from '../api/client'
import type { InventoryHost, InventoryHostDetail } from '../api/client'
import PageHeader from '../components/PageHeader'
import SelectField from '../components/SelectField'
import DetailTable from '../components/DetailTable'
import { severityColor, severityLabel } from '../severity'
import { realSerial } from '../serial'
import { installedNeedingUpdate, newestOSInEstate } from '../remediation'
import type { Installed } from '../remediation'
import { OSIcon } from '../components/OSName'
import ErrorIcon from '@mui/icons-material/Error'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

/**
 * Assessing one endpoint at a time.
 *
 * Starts where it can stand up: pick a machine, see what it is. The
 * hosts come from the listing this console already makes, so choosing
 * one costs nothing — what goes below the picker is the part we grow.
 *
 * WHICH HOST IS IN THE URL, not in a useState. A machine's assessment
 * is a page about that machine — the thing you send someone, bookmark,
 * reload after a fix, or reach with the back button — and none of that
 * works when the only record of what you picked is component state.
 * Every other drill-in here already had an address; this one was a
 * dropdown over a page that never changed.
 */
/** Where a host's assessment lives. Empty id is the bare picker. */
function pathFor(id: string): string {
  return id ? `/security/host-assessment/${encodeURIComponent(id)}` : '/security/host-assessment'
}

export default function SecurityHostAssessmentPage() {
  const { hostId = '' } = useParams()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['inventoryHosts'],
    queryFn: api.listInventoryHosts,
  })

  const hosts = data?.hosts ?? []
  const host = hosts.find((h) => h.id === hostId)

  // The list carries what a machine IS; its vulnerabilities take the
  // detail call, so this only runs once a host is chosen.
  const { data: detail } = useQuery({
    queryKey: ['inventoryHost', hostId],
    queryFn: () => api.inventoryHost(hostId),
    enabled: Boolean(hostId),
  })

  const counts = countBySeverity(detail?.vulnerabilities ?? [])

  return (
    <Box sx={{ p: 3, maxWidth: 1120 }}>
      <PageHeader title="Host assessment" />

      {data && !data.configured && (
        <Alert severity="info">No inventory service is connected.</Alert>
      )}

      {(hosts.length > 0 || isLoading) && (
        <SelectField
          label="Host"
          size="small"
          value={hosts.some((h) => h.id === hostId) ? hostId : ''}
          onChange={(e) => navigate(pathFor(e.target.value))}
          sx={{ minWidth: 320, mb: 3 }}
        >
          <MenuItem value="">
            <em>Choose a host</em>
          </MenuItem>
          {hosts.map((h) => (
            <MenuItem key={h.id} value={h.id}>
              {h.name || h.hostname}
            </MenuItem>
          ))}
        </SelectField>
      )}

      {/* A LINK OUTLIVES THE MACHINE IT NAMES. A bookmark to a host
          that has since been retired — or a service swapped for
          another, which renumbers everything — would otherwise land on
          the bare picker and look like the link had simply lost its
          fragment. */}
      {hostId && data?.configured && hosts.length > 0 && !host && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          No host with this id. It may have been removed from the inventory service.
        </Alert>
      )}

      {host && (
        <DetailTable
          rows={[
            {
              label: 'Operating system',
              value: (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 16 }}>
                    <OSIcon name={`${host.osVersion} ${host.platform}`} />
                  </Box>
                  {host.osVersion || host.platform || '—'}
                </Box>
              ),
            },
            { label: 'Serial number', value: realSerial(host.serial) ?? '—' },
          ]}
        />
      )}

      {host && detail && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' },
            gap: 2,
            mt: 3,
          }}
        >
          {/* TINTED ONLY WHEN THERE IS SOMETHING IN IT. A red
              "Critical" card reading 0 is alarming about nothing, and
              four permanently coloured blocks would announce the bands
              rather than the finding. Low and unscored never tint:
              neither is a thing to be drawn to. */}
          {bands.map((band) => (
            <Paper
              key={band.severity}
              variant="outlined"
              sx={{
                p: 2,
                bgcolor: counts[band.severity] > 0 && band.tint ? band.tint : undefined,
              }}
            >
              <Typography sx={{ fontSize: 20, lineHeight: 1.3, color: band.color }}>
                {band.label}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{band.range}</Typography>
              <Typography sx={{ fontSize: 28, lineHeight: 1.4, color: 'text.primary' }}>
                {counts[band.severity]}
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{band.advice}</Typography>
            </Paper>
          ))}
        </Box>
      )}

      {host && detail && <Exploited detail={detail} />}

      {host && detail && <WhatToDo host={host} hosts={hosts} detail={detail} />}
    </Box>
  )
}

/**
 * The flaws on this machine that somebody is actually exploiting.
 *
 * It sits above the update list because it cuts across the bands: a
 * medium being used in the wild outranks a critical nobody has worked
 * out how to reach. And it renders only when there is something in it —
 * on this estate that's one host in twenty-one, which is the point. A
 * section that appears is a section worth reading.
 */
function Exploited({ detail }: { detail: InventoryHostDetail }) {
  // Which of these live in something already deleted. The scariest row
  // on the page is the one that most needs the distinction: a
  // known-exploited flaw in an app you cannot find is alarming for the
  // wrong reason until you are told where it is.
  const discarded = new Set(
    (detail.packages ?? []).filter((p) => p.discarded).map((p) => p.name),
  )
  const seen = new Set<string>()
  const rows = (detail.vulnerabilities ?? []).filter((v) => {
    if (!v.knownExploited || seen.has(v.cve)) return false
    seen.add(v.cve)
    return true
  })
  if (rows.length === 0) return null

  return (
    <Box sx={{ mt: 3 }}>
      <Typography sx={{ fontSize: 16, mb: 1.5 }}>Exploitable vulnerabilities</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>CVE</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>In</TableCell>
              <TableCell>Fixed in</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.cve} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LocalFireDepartmentIcon
                      fontSize="small"
                      aria-label="Known exploited"
                      sx={{ color: 'error.main', display: 'block' }}
                    />
                    <Link
                      component={RouterLink}
                      to={`/security/vulnerabilities/${encodeURIComponent(v.cve)}`}
                      underline="hover"
                    >
                      {v.cve}
                    </Link>
                  </Box>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', color: severityColor[v.severity] }}>
                  {severityLabel(v.severity, v.cvssScore) ?? (
                    <Box component="span" sx={{ color: 'text.disabled' }}>
                      Not scored
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {v.package}
                  {v.installedVersion ? ` ${v.installedVersion}` : ''}
                  {discarded.has(v.package) && (
                    <Typography sx={{ fontSize: 12, color: '#b06000' }}>
                      in the Trash — empty it to remove
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ color: v.resolvedInVersion ? 'text.primary' : 'text.secondary' }}>
                  {v.resolvedInVersion || 'No fix published'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}

/**
 * The short list. Four hundred vulnerabilities are half a dozen
 * actions, and this is that collapse — every number below comes from
 * the inventory service, and no version is suggested that nobody
 * reported.
 */
function WhatToDo({
  host,
  hosts,
  detail,
}: {
  host: InventoryHost
  hosts: InventoryHost[]
  detail: InventoryHostDetail
}) {
  const vulns = detail.vulnerabilities ?? []
  const osVulns = vulns.filter((v) => v.operatingSystem)
  const osExploited = osVulns.filter((v) => v.knownExploited).length
  // The newest of this machine's own OS family that something here is
  // already running — an upgrade this estate has demonstrably managed,
  // rather than whatever the vendor's website claims today.
  const newer = newestOSInEstate(host.osVersion, hosts)

  const apps = installedNeedingUpdate(detail.packages ?? [])

  // GROUPED BY SEVERITY, because the question this page is for is what
  // to fix first. Kind — an application you click update on, versus a
  // runtime four other things import — still decides how much of a
  // decision each row is, so it stays as the row's own subtitle rather
  // than as the heading. It was the heading once; on a security page
  // that made you read two lists to find the one critical thing.
  const groups = bands
    .map((band) => ({
      band,
      list: apps
        .filter((a) => (a.severity || 'UNSCORED') === band.severity)
        .sort((x, y) => y.worstScore - x.worstScore || y.count - x.count),
    }))
    .filter((g) => g.list.length > 0)

  if (!newer && apps.length === 0) return null

  return (
    <Box sx={{ mt: 3 }}>
      <Typography sx={{ fontSize: 16, mb: 1.5 }}>Updates required</Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {newer && (
          <Box sx={{ mb: apps.length ? 2 : 0 }}>
            <Typography sx={{ fontSize: 14 }}>
              Update {host.osVersion} to <strong>{newer}</strong>
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {osVulns.length > 0
                ? `Clears ${osVulns.length} vulnerabilities in the operating system` +
                  (osExploited > 0
                    ? `, ${osExploited} of them known-exploited.`
                    : '.')
                : 'Already running here on another machine.'}
            </Typography>
          </Box>
        )}

        {groups.map(({ band, list }) => (
          <Box key={band.severity} sx={{ mt: 2, '&:first-of-type': { mt: newer ? 2 : 0 } }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                pb: 0.75,
                mb: 0.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <SeverityMark severity={band.severity} color={band.color} />
              <Typography sx={{ fontSize: 14, color: band.color }}>
                {/* "Not scored" is already a whole phrase; the others
                    are adjectives that need the noun. */}
                {band.severity === 'UNSCORED' ? band.label : `${band.label} severity`}
              </Typography>
            </Box>
            {list.map((a) => (
              <AppRow key={`${a.name}-${a.version}`} app={a} color={band.color} />
            ))}
          </Box>
        ))}
      </Paper>
    </Box>
  )
}

/**
 * One thing to update, and the flaws behind its number.
 *
 * THE COUNT IS THE HEADLINE AND THE LIST IS THE ANSWER. "7
 * vulnerabilities" tells you the size of the problem and nothing about
 * whether it matters — one of those seven being in CISA's exploited
 * catalogue is a different Tuesday from seven mediums. Expanding is how
 * you find out without leaving the page.
 *
 * CLOSED BY DEFAULT, because the page's job is what to fix first: five
 * apps with their CVEs unfolded is the wall of text the count exists to
 * replace.
 */
function AppRow({ app, color }: { app: Installed; color: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Box>
      <Box
        onClick={() => setOpen((o) => !o)}
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 2,
          py: 0.75,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'surface.subtle' },
        }}
      >
        <ExpandMoreIcon
          sx={{
            fontSize: 18,
            color: 'text.disabled',
            alignSelf: 'center',
            transition: 'transform .15s',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 14 }}>
            {app.version ? `${app.name} ${app.version}` : app.name}
          </Typography>
          {/* How much of a decision this update is. An application is a
              click; a runtime is everything that imports it. */}
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {app.kind === 'runtime' ? 'Runtime / Library' : 'Application'}
            {/* WHY IT IS STILL LISTED AFTER BEING DELETED. The agent
                finds a bundle in the Trash and reports it like any
                other, which is right — it is on disk and can still be
                opened. But somebody would go looking in Applications
                and not find it, and the remedy is a different one, so
                the row says which. */}
            {app.discarded && (
              <Box component="span" sx={{ color: '#b06000' }}>
                {' · in the Trash — empty it rather than updating'}
              </Box>
            )}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 13, color, whiteSpace: 'nowrap' }}>
          {app.count} {app.count === 1 ? 'vulnerability' : 'vulnerabilities'}
        </Typography>
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 4.5, pb: 1 }}>
          {app.cves.map((v) => (
            <Box
              key={v.cve}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.4 }}
            >
              {/* The same mark the exploitable table uses, so one flaw
                  reads the same wherever you meet it. */}
              {v.knownExploited && (
                <LocalFireDepartmentIcon
                  sx={{ fontSize: 15, color: 'error.main', display: 'block' }}
                  aria-label="Known exploited"
                />
              )}
              <Link
                component={RouterLink}
                to={`/security/vulnerabilities/${encodeURIComponent(v.cve)}`}
                underline="hover"
                onClick={(e) => e.stopPropagation()}
                sx={{ fontSize: 13, whiteSpace: 'nowrap' }}
              >
                {v.cve}
              </Link>
              <Typography
                sx={{ fontSize: 12, color: severityColor[v.severity] ?? 'text.disabled' }}
              >
                {severityLabel(v.severity, v.cvssScore) ?? 'Not scored'}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography
                sx={{
                  fontSize: 12,
                  color: v.resolvedInVersion ? 'text.secondary' : 'text.disabled',
                  whiteSpace: 'nowrap',
                }}
              >
                {v.resolvedInVersion ? `Fixed in ${v.resolvedInVersion}` : 'No fix published'}
              </Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

/**
 * The NVD bands, with what each one means for somebody who has to act
 * on it rather than score it.
 */
const bands = [
  {
    severity: 'CRITICAL',
    label: 'Critical',
    range: '9.0 – 10.0',
    color: severityColor.CRITICAL,
    tint: 'surface.errorTint',
    advice: 'Fix right now. Flaws let attackers break in easily and control systems.',
  },
  {
    severity: 'HIGH',
    label: 'High',
    range: '7.0 – 8.9',
    color: severityColor.HIGH,
    tint: 'surface.errorTint',
    advice: 'Fix fast. Flaws cause major harm but might need some setup by an attacker.',
  },
  {
    severity: 'MEDIUM',
    label: 'Medium',
    range: '4.0 – 6.9',
    color: severityColor.MEDIUM,
    tint: 'surface.warningTint',
    advice: 'Fix soon. Flaws need specific conditions or user help to exploit.',
  },
  {
    severity: 'LOW',
    label: 'Low',
    range: '0.1 – 3.9',
    color: severityColor.LOW,
    tint: '',
    advice: 'Fix when free. Flaws cause very little harm and are hard to exploit.',
  },
  {
    // The catch-all, and the reason it exists: without it a machine
    // with 455 unassessed CVEs shows four zeroes and reads as clean.
    // "Nothing has looked" and "nothing was found" must not render the
    // same — the same rule that stopped unscored CVEs saying MINIMAL.
    severity: 'UNSCORED',
    label: 'Not scored',
    range: 'no rating yet',
    color: 'text.disabled',
    tint: '',
    advice: 'Nothing has rated these yet. Scores arrive as the vulnerability database is read.',
  },
]

/**
 * Counts one host's CVEs into those bands, by the severity the backend
 * already derived — so this page bands them the same way every other
 * page does rather than re-deriving from the score.
 *
 * A CVE is counted ONCE even where several packages carry it: the
 * question is how many flaws this machine has, not how many times each
 * appears in its package list.
 */
function countBySeverity(vulns: { cve: string; severity: string }[]): Record<string, number> {
  const seen = new Set<string>()
  const counts: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNSCORED: 0,
  }
  for (const v of vulns) {
    if (seen.has(v.cve)) continue
    seen.add(v.cve)
    counts[counts[v.severity] === undefined ? 'UNSCORED' : v.severity] += 1
  }
  return counts
}

/** The glyph beside a severity heading. Only the two bands that demand
 *  action get one — a mark on every heading is a mark that says
 *  nothing, the same reason Low and Not scored are never tinted. */
function SeverityMark({ severity, color }: { severity: string; color: string }) {
  if (severity === 'CRITICAL') return <ErrorIcon sx={{ fontSize: 18, color }} />
  if (severity === 'HIGH') return <WarningAmberIcon sx={{ fontSize: 18, color }} />
  return null
}
