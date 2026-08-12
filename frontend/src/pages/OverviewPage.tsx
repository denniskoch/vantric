import { useQuery } from '@tanstack/react-query'
import { Box, Grid, Paper, Typography } from '@mui/material'
import { api } from '../api/client'

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
  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: api.listInstances,
    refetchInterval: 5000,
  })
  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })

  const running = instances.filter((i) => i.status === 'RUNNING').length
  const connected = servers.filter((s) => s.status === 'connected').length

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
          <Stat label="Servers" value={`${connected}/${servers.length}`} />
        </Grid>
      </Grid>
    </Box>
  )
}
