import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ComputerIcon from '@mui/icons-material/Computer'
import { api } from '../api/client'
import DetailTable, { DetailSection } from '../components/DetailTable'
import InventoryPanels from '../components/InventoryPanels'
import StatusIcon from '../components/StatusIcon'
import { OSIcon } from '../components/OSName'
import { timeAgo } from '../format'

/**
 * One machine, as the inventory service sees it.
 *
 * Same template as a VM instance: a header that says what it is and
 * what you can do with it, the facts, then the detail. The Hosts list
 * is deliberately a summary — five columns you can scan — and
 * everything else lives here, which is the only reason dropping
 * columns from that table didn't lose anything.
 *
 * The machine may or may not be one this console runs. When it is,
 * there's a way through to the instance; when it isn't, that's stated
 * rather than left blank, because a laptop being here is the point of
 * the section.
 */
export default function DevicesHostPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['inventoryHost', id],
    queryFn: () => api.inventoryHost(id!),
    enabled: Boolean(id),
  })

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading host…</Typography>
      </Box>
    )
  }

  if (error || !data) {
    return (
      <Box sx={{ p: 3 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/devices/hosts')}>
          Hosts
        </Button>
        <Alert severity="error" sx={{ mt: 2 }}>
          {(error as Error)?.message ?? 'This host is no longer in your inventory service.'}
        </Alert>
      </Box>
    )
  }

  const host = data.host

  return (
    <Box sx={{ pb: 4 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 3,
          py: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/devices/hosts')}>
          Hosts
        </Button>
        <StatusIcon status={host.status === 'online' ? 'RUNNING' : 'TERMINATED'} />
        <Typography variant="h5">{host.hostname || 'Unnamed host'}</Typography>
        <Box sx={{ flex: 1 }} />
        {/* The way through to the other half of the machine, where
            there is one. */}
        {data.managed && (
          <Button
            size="small"
            startIcon={<ComputerIcon />}
            onClick={() => navigate(`/compute/instances/${data.instance}`)}
          >
            Open instance
          </Button>
        )}
      </Box>

      <Box sx={{ px: 3, maxWidth: 1100 }}>
        <DetailSection title="Basic information">
          <DetailTable
            rows={[
              { label: 'Hostname', value: host.hostname || '—' },
              {
                label: 'Operating system',
                value: (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <OSIcon name={`${host.osVersion} ${host.platform}`} size={18} />
                    {host.osVersion || host.platform || '—'}
                  </Box>
                ),
              },
              { label: 'Platform', value: host.platform || '—' },
              { label: 'Status', value: host.status || 'unknown' },
              {
                label: 'Managed by',
                value: data.managed ? (
                  `${data.instance} — a VM in this console`
                ) : (
                  // Not a gap: this is what a laptop looks like.
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    External — not a guest this console runs
                  </Box>
                ),
              },
              {
                label: 'System UUID',
                value: (
                  <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {host.uuid || '—'}
                  </Box>
                ),
              },
              {
                label: 'Serial number',
                value: (
                  <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {host.serial || '—'}
                  </Box>
                ),
              },
              { label: 'Last seen', value: timeAgo(host.seenAt) },
              { label: 'Detail collected', value: timeAgo(host.updatedAt) },
              {
                label: 'Failing policies',
                value:
                  host.issuesFailing > 0 ? (
                    <Box component="span" sx={{ color: 'error.main' }}>
                      {host.issuesFailing}
                    </Box>
                  ) : (
                    'None'
                  ),
              },
            ]}
          />
        </DetailSection>

        <InventoryPanels detail={data} />
      </Box>
    </Box>
  )
}
