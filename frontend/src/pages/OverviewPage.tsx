import { useQuery } from '@tanstack/react-query'
import { Box, Grid, Paper, Typography } from '@mui/material'
import { api } from '../api/client'
import { useProject } from '../project'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 180 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 400 }}>{value}</Typography>
    </Paper>
  )
}

export default function OverviewPage() {
  const { current } = useProject()
  const project = current?.name
  const { data: instances = [] } = useQuery({
    queryKey: ['instances', project],
    queryFn: () => api.listInstances(project!),
    enabled: Boolean(project),
    refetchInterval: 5000,
  })
  const { data: zones = [] } = useQuery({ queryKey: ['zones'], queryFn: api.listZones })

  const running = instances.filter((i) => i.status === 'RUNNING').length

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Overview
      </Typography>
      <Grid container spacing={2}>
        <Grid>
          <Stat label="VM instances" value={instances.length} />
        </Grid>
        <Grid>
          <Stat label="Running" value={running} />
        </Grid>
        <Grid>
          <Stat label="Zones (nodes)" value={zones.length} />
        </Grid>
      </Grid>
    </Box>
  )
}
