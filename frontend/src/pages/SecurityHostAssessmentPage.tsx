import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, MenuItem, Paper, Typography } from '@mui/material'
import { api } from '../api/client'
import type { InventoryHost, InventoryHostDetail } from '../api/client'
import PageHeader from '../components/PageHeader'
import SelectField from '../components/SelectField'
import DetailTable from '../components/DetailTable'
import { severityColor } from '../severity'
import { newestOSInEstate, updateRoute } from '../remediation'
import { OSIcon } from '../components/OSName'

/**
 * Assessing one endpoint at a time.
 *
 * Starts where it can stand up: pick a machine, see what it is. The
 * hosts come from the listing this console already makes, so choosing
 * one costs nothing — what goes below the picker is the part we grow.
 */
export default function SecurityHostAssessmentPage() {
  const [hostId, setHostId] = useState('')

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
          value={hostId}
          onChange={(e) => setHostId(e.target.value)}
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
            { label: 'Serial number', value: host.serial || '—' },
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
          {bands.map((band) => (
            <Paper key={band.severity} variant="outlined" sx={{ p: 2 }}>
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

      {host && detail && <WhatToDo host={host} hosts={hosts} detail={detail} />}
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

  const apps = (detail.packages ?? [])
    .filter((p) => (p.vulnerabilities ?? []).length > 0)
    .map((p) => ({
      name: p.name,
      version: p.version,
      count: (p.vulnerabilities ?? []).length,
      route: updateRoute(host.platform, p.name),
    }))
    .sort((a, b) => b.count - a.count)

  const groups = new Map<string, typeof apps>()
  for (const a of apps) {
    groups.set(a.route.key, [...(groups.get(a.route.key) ?? []), a])
  }

  if (!newer && apps.length === 0) return null

  return (
    <Box sx={{ mt: 3 }}>
      <Typography sx={{ fontSize: 16, mb: 1.5 }}>What to do</Typography>
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

        {[...groups.entries()].map(([key, list]) => (
          <Box key={key} sx={{ mb: 1.5, '&:last-child': { mb: 0 } }}>
            <Typography sx={{ fontSize: 14 }}>{list[0].route.label}</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              {list
                .map((a) => `${a.name} ${a.version} (${a.count})`)
                .join(', ')}
            </Typography>
            {list[0].route.note && (
              <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
                {list[0].route.note}
              </Typography>
            )}
          </Box>
        ))}
      </Paper>
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
    advice: 'Fix right now. Flaws let attackers break in easily and control systems.',
  },
  {
    severity: 'HIGH',
    label: 'High',
    range: '7.0 – 8.9',
    color: severityColor.HIGH,
    advice: 'Fix fast. Flaws cause major harm but might need some setup by an attacker.',
  },
  {
    severity: 'MEDIUM',
    label: 'Medium',
    range: '4.0 – 6.9',
    color: severityColor.MEDIUM,
    advice: 'Fix soon. Flaws need specific conditions or user help to exploit.',
  },
  {
    severity: 'LOW',
    label: 'Low',
    range: '0.1 – 3.9',
    color: severityColor.LOW,
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
