import { useQuery } from '@tanstack/react-query'
import { Box, Paper, Typography } from '@mui/material'
import { api } from '../api/client'
import SectionLandingPage from './SectionLandingPage'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 160, flex: '1 1 160px' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 400 }}>{value}</Typography>
    </Paper>
  )
}

/**
 * Compute's landing page: the shared section template, with a
 * live summary of what's running in the slot above the page cards.
 */
export default function OverviewPage() {
  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: api.listInstances,
    refetchInterval: 5000,
  })
  const { data: containers = [] } = useQuery({
    queryKey: ['containers'],
    queryFn: api.listContainers,
    refetchInterval: 5000,
  })
  const { data: servers = [] } = useQuery({ queryKey: ['hypervisors'], queryFn: api.listHypervisors })

  const running = (list: { status: string }[]) =>
    list.filter((i) => i.status === 'RUNNING').length
  const connected = servers.filter((s) => s.status === 'connected').length

  return (
    <SectionLandingPage>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Stat label="Virtual machines" value={`${running(instances)}/${instances.length}`} />
        <Stat label="Containers" value={`${running(containers)}/${containers.length}`} />
        <Stat label="Hypervisors connected" value={`${connected}/${servers.length}`} />
      </Box>
    </SectionLandingPage>
  )
}
