import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import LockIcon from '@mui/icons-material/Lock'
import { api } from '../api/client'
import type { ExploitedFinding } from '../api/client'
import PageHeader from '../components/PageHeader'
import { severityColor, severityLabel } from '../severity'
import { timeAgo } from '../format'

/**
 * The Security overview leads with one thing: vulnerabilities CISA says
 * are being exploited right now that are ALSO on machines here.
 *
 * Either half alone is noise. The catalogue is 1,670 CVEs, nearly none
 * of which you run; the estate is four thousand, nearly none of which
 * anyone is exploiting. The overlap is what's worth a morning — three
 * in this lab, and three is a list somebody finishes.
 *
 * No score and no grade. A number that improves when you disconnect a
 * backend measures the console, not the lab.
 */
export default function SecurityOverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['securityOverview'],
    queryFn: api.securityOverview,
    // Slow beat. Posture doesn't change between blinks, and the estate
    // list behind this is not a small response.
    refetchInterval: 60000,
  })

  const exploited = data?.exploited ?? []

  return (
    <Box sx={{ p: 3, maxWidth: 1000 }}>
      <PageHeader title="Security Command Center" />

      {data && !data.configured && (
        <Alert severity="info">
          No inventory service is connected.{' '}
          <Link component={RouterLink} to="/devices/settings/inventory" underline="hover">
            Connect one
          </Link>{' '}
          to see this.
        </Alert>
      )}

      {data?.configured && !data.supported && (
        <Alert severity="info">
          This inventory service can't produce an estate-wide vulnerability list. Each machine
          still lists its own under Devices.
        </Alert>
      )}

      {/* An unreadable catalogue is stated, never rendered as an empty
          list: "nothing is being exploited" is the one wrong answer
          this page must not give by accident. */}
      {data?.error && <Alert severity="warning">{data.error}</Alert>}

      {isLoading && <Typography color="text.secondary">Checking…</Typography>}

      {/* The same count cell the Cloud overview uses, down to being a
          link into the list it counts — one grid slot wide, so more can
          sit beside it as the section grows. */}
      {data?.supported && data.tracked > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' },
            gap: 2,
            mb: 3,
          }}
        >
          <Paper
            component={RouterLink}
            to="/security/vulnerabilities"
            variant="outlined"
            sx={{
              p: 2,
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              '&:hover': { bgcolor: 'surface.subtle', borderColor: 'primary.main' },
            }}
          >
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Vulnerabilities</Typography>
            <Typography sx={{ fontSize: 28, color: 'text.primary', lineHeight: 1.3 }}>
              {data.tracked.toLocaleString()}
            </Typography>
          </Paper>
        </Box>
      )}

      {data?.configured && data.supported && !data.error && exploited.length === 0 && (
        <Alert severity="success" icon={<LockIcon />}>
          None of the {data.tracked.toLocaleString()} vulnerabilities on your machines are in
          CISA's catalogue of {data.catalogued.toLocaleString()} known-exploited flaws.
        </Alert>
      )}

      {exploited.length > 0 && (
        <>
          <Alert severity="error" icon={<LocalFireDepartmentIcon />} sx={{ mb: 2 }}>
            <strong>
              {exploited.length === 1
                ? '1 exploitable vulnerability exists in your environment.'
                : `${exploited.length} exploitable vulnerabilities exist in your environment.`}
            </strong>
          </Alert>
          <Stack spacing={1.5}>
            {exploited.map((f) => (
              <Finding key={f.cve} finding={f} />
            ))}
          </Stack>
        </>
      )}

    </Box>
  )
}

function Finding({ finding }: { finding: ExploitedFinding }) {
  const score = severityLabel(finding.severity, finding.cvssScore)
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, display: 'flex', gap: 1.5, borderLeft: '3px solid', borderLeftColor: 'error.main' }}
    >
      <LocalFireDepartmentIcon fontSize="small" sx={{ color: 'error.main', mt: 0.25 }} />
      <Box sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
          <Link
            component={RouterLink}
            to={`/security/vulnerabilities/${encodeURIComponent(finding.cve)}`}
            underline="hover"
            sx={{ fontWeight: 500 }}
          >
            {finding.cve}
          </Link>
          {score && (
            <Box component="span" sx={{ fontSize: 13, color: severityColor[finding.severity] }}>
              {score}
            </Box>
          )}
          {finding.ransomware && (
            <Box component="span" sx={{ fontSize: 12, color: 'error.main' }}>
              used in ransomware
            </Box>
          )}
        </Box>
        <Typography variant="body2">{finding.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          {finding.product}
          {finding.hosts > 0 &&
            ` · on ${finding.hosts} ${finding.hosts === 1 ? 'machine' : 'machines'}`}
          {finding.addedAt > 0 && ` · catalogued ${timeAgo(finding.addedAt)}`}
        </Typography>
      </Box>
    </Paper>
  )
}
