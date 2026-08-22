import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Typography } from '@mui/material'
import { api } from '../api/client'
import InventoryPanels from './InventoryPanels'

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
        This guest isn't enrolled in your inventory service — nothing reports system
        UUID {data.uuid || '(unknown)'}. Install the agent to see its packages and
        vulnerabilities here.
      </Alert>
    )
  }

  return <InventoryPanels detail={data.detail!} />
}
