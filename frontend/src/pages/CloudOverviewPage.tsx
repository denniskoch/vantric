import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Divider, LinearProgress, Paper, Skeleton, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WarningIcon from '@mui/icons-material/Warning'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import PageHeader from '../components/PageHeader'
import { api } from '../api/client'
import type { OverviewDatastore, OverviewProblem } from '../api/client'

/**
 * The Cloud overview: the console's front door.
 *
 * Every other page here answers a question you already knew to ask.
 * This one answers the first one — what's wrong right now — and it does
 * it without a new integration: the backend assembles it from the
 * backends already connected, so a lab with nothing wrong sees the
 * all-clear rather than an empty page.
 *
 * It polls slowly on purpose. This fans out to every hypervisor,
 * database server and provider at once, which is not something to do
 * every three seconds like a list page.
 */
export default function CloudOverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: 30000,
  })

  const counts = data?.counts
  const problems = data?.problems ?? []

  return (
    <Box sx={{ p: 3, maxWidth: 1100 }}>
      <PageHeader
        title="Cloud overview"
        description="What the lab looks like right now, across every backend this console is connected to."
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {(error as Error).message}
        </Alert>
      )}

      <Typography sx={{ fontSize: 16, color: 'text.primary', mb: 1.5 }}>
        Status
      </Typography>
      <Paper variant="outlined" sx={{ mb: 3 }}>
        {isLoading ? (
          <Box sx={{ p: 2 }}>
            <Skeleton height={22} />
            <Skeleton height={22} width="60%" />
          </Box>
        ) : problems.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2 }}>
            <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
            <Box>
              <Typography sx={{ fontSize: 14, color: 'text.primary' }}>
                Everything is reachable and nothing is running low
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Every hypervisor, database server and provider answered, no datastore is
                near full, and every guest is backed up and reporting an address.
              </Typography>
            </Box>
          </Box>
        ) : (
          problems.map((p, i) => (
            <Box key={p.title}>
              {i > 0 && <Divider />}
              <ProblemRow problem={p} />
            </Box>
          ))
        )}
      </Paper>

      <Typography sx={{ fontSize: 16, color: 'text.primary', mb: 1.5 }}>
        Resources
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        <Stat
          label="VM instances"
          value={counts && `${counts.running}/${counts.instances}`}
          hint="running"
          to="/compute/instances"
          loading={isLoading}
        />
        <Stat
          label="Container instances"
          value={counts && `${counts.containersRunning}/${counts.containers}`}
          hint="running"
          to="/compute/containers"
          loading={isLoading}
        />
        <Stat
          label="Hypervisors"
          value={counts?.hypervisors}
          to="/compute/settings/hypervisors"
          loading={isLoading}
        />
        <Stat
          label="Databases"
          value={counts?.databases}
          hint={
            counts && counts.databaseServers > 0
              ? `on ${counts.databaseServers} server${counts.databaseServers === 1 ? '' : 's'}`
              : undefined
          }
          to="/databases/databases"
          loading={isLoading}
        />
        <Stat label="DNS zones" value={counts?.dnsZones} to="/dns/zones" loading={isLoading} />
        <Stat
          label="Directory users"
          value={counts?.identityUsers}
          to="/identity/users"
          loading={isLoading}
        />
        <Stat
          label="Network clients"
          value={counts?.networkClients}
          to="/network/clients"
          loading={isLoading}
        />
        <Stat
          label="Console accounts"
          value={counts?.accounts}
          to="/iam/users"
          loading={isLoading}
        />
      </Box>

      {data && data.datastores.length > 0 && (
        <>
          <Typography sx={{ fontSize: 16, color: 'text.primary', mb: 1.5 }}>
            Storage
          </Typography>
          <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
            {data.datastores.map((ds) => (
              <DatastoreBar key={`${ds.hypervisorId}/${ds.node}/${ds.name}`} datastore={ds} />
            ))}
          </Paper>
        </>
      )}
    </Box>
  )
}

function ProblemRow({ problem }: { problem: OverviewProblem }) {
  const error = problem.severity === 'error'
  const Icon = error ? ErrorIcon : WarningIcon
  return (
    <Box
      component={RouterLink}
      to={problem.to}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        p: 2,
        textDecoration: 'none',
        color: 'inherit',
        '&:hover': { bgcolor: 'surface.subtle' },
      }}
    >
      <Icon sx={{ color: error ? '#d93025' : '#e37400', fontSize: 20 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, color: 'text.primary' }}>{problem.title}</Typography>
        {problem.detail && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.3 }}>
            {problem.detail}
          </Typography>
        )}
      </Box>
      <ChevronRightIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
    </Box>
  )
}

function Stat({
  label,
  value,
  hint,
  to,
  loading,
}: {
  label: string
  value?: string | number
  hint?: string
  to: string
  loading: boolean
}) {
  return (
    <Paper
      component={RouterLink}
      to={to}
      variant="outlined"
      sx={{
        p: 2,
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        '&:hover': { bgcolor: 'surface.subtle', borderColor: 'primary.main' },
      }}
    >
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 400, color: 'text.primary', lineHeight: 1.3 }}>
        {loading ? <Skeleton width={48} /> : (value ?? 0)}
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
        {loading ? '' : (hint ?? ' ')}
      </Typography>
    </Paper>
  )
}

function DatastoreBar({ datastore }: { datastore: OverviewDatastore }) {
  const pct = Math.min(100, datastore.percent)
  const colour = pct >= 95 ? '#d93025' : pct >= 85 ? '#e37400' : '#1a73e8'
  return (
    <Box sx={{ mb: 1.5, '&:last-of-type': { mb: 0 } }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{ fontSize: 13, color: 'text.primary' }}>{datastore.name}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{datastore.node}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {formatBytes(datastore.usedBytes)} of {formatBytes(datastore.totalBytes)} ·{' '}
          {pct.toFixed(0)}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          mt: 0.5,
          height: 6,
          borderRadius: 1,
          bgcolor: 'surface.muted',
          '& .MuiLinearProgress-bar': { bgcolor: colour },
        }}
      />
    </Box>
  )
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}
