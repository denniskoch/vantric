import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { usePermissions } from '../user'

/** The three read-only views over the network controller. They share a
 *  shape: nothing configured yet points at Settings → Controllers, and
 *  a controller error shows the controller's own words. */
function NetworkPage({
  title,
  description,
  children,
  error,
}: {
  title: string
  description: string
  children: React.ReactNode
  error?: Error | null
}) {
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['networkProviders'],
    queryFn: api.listNetworkProviders,
  })
  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title={title}
        description={description}
      />
      {providers.length === 0 && !isLoading && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button size="small" component={RouterLink} to="/network/controllers">
              Add controller
            </Button>
          }
        >
          No network controller is connected yet.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error.message}
        </Alert>
      )}
      {children}
    </Box>
  )
}

const useConnected = () => {
  const { data: providers = [] } = useQuery({
    queryKey: ['networkProviders'],
    queryFn: api.listNetworkProviders,
  })
  return providers.length > 0
}

export function NetworkNetworksPage() {
  const enabled = useConnected()
  // Offered only where the API would allow it; see rbac.go.
  const { canEdit } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const {
    data: networks = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['labNetworks', 'lan'],
    queryFn: () => api.listLabNetworks('lan'),
    enabled,
    retry: false,
  })

  // A network with no range has nothing to record, so it can't be
  // ticked — better than accepting it and failing on the way out.
  const importable = networks.filter((n) => Boolean(n.subnet))

  const push = useMutation({
    mutationFn: () => api.importSubnets(selected),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['subnets'] })
      setSelected([])
      const created = result.created.length
      setNotice(
        [
          created > 0 ? `${created} subnet${created === 1 ? '' : 's'} created` : '',
          result.existing > 0 ? `${result.existing} already recorded` : '',
        ]
          .filter(Boolean)
          .join(' · ') || 'Nothing to create',
      )
      setFailed(result.errors?.length ? result.errors.join('; ') : null)
    },
    onError: (e: Error) => setFailed(e.message),
  })

  const toggle = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  return (
    <NetworkPage
      title="Networks"
      description="The LANs and VLANs your controller defines, with the subnet and DHCP range each one serves."
      error={error as Error | null}
    >
      {notice && (
        <Alert
          severity="success"
          onClose={() => setNotice(null)}
          sx={{ mb: 2 }}
          action={
            <Button size="small" onClick={() => navigate('/network/subnets')}>
              View subnets
            </Button>
          }
        >
          {notice}
        </Alert>
      )}
      {failed && (
        <Alert severity="error" onClose={() => setFailed(null)} sx={{ mb: 2 }}>
          {failed}
        </Alert>
      )}

      {/* Selecting rows raises the actions that apply to them, the way
          every other list here works. */}
      {selected.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            mb: 2,
            px: 2,
            py: 1,
            bgcolor: 'surface.infoTint',
            borderRadius: 1,
          }}
        >
          <Box sx={{ fontSize: 13 }}>{selected.length} selected</Box>
          <Button size="small" onClick={() => setSelected([])}>
            Clear
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            size="small"
            disabled={push.isPending}
            onClick={() => push.mutate()}
          >
            Import to subnets
          </Button>
        </Box>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {canEdit && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={
                      importable.length > 0 && selected.length === importable.length
                    }
                    indeterminate={
                      selected.length > 0 && selected.length < importable.length
                    }
                    onChange={(e) =>
                      setSelected(e.target.checked ? importable.map((n) => n.id) : [])
                    }
                  />
                </TableCell>
              )}
              <TableCell>Site</TableCell>
              <TableCell>Name</TableCell>
              <TableCell align="right">VLAN</TableCell>
              <TableCell>Subnet</TableCell>
              <TableCell>Purpose</TableCell>
              <TableCell>DHCP range</TableCell>
              <TableCell>Domain</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {networks.map((net) => (
              <TableRow key={`${net.site}/${net.id}`} hover>
                {canEdit && (
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      disabled={!net.subnet}
                      checked={selected.includes(net.id)}
                      onChange={() => toggle(net.id)}
                    />
                  </TableCell>
                )}
                <TableCell>{net.site}</TableCell>
                <TableCell>{net.name}</TableCell>
                <TableCell align="right">{net.vlan || '—'}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {net.subnet || '—'}
                </TableCell>
                <TableCell>{net.purpose || '—'}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {net.dhcpEnabled && net.dhcpStart
                    ? `${net.dhcpStart} – ${net.dhcpStop}`
                    : 'No DHCP'}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{net.domainName || '—'}</TableCell>
                <TableCell sx={{ color: net.enabled ? undefined : '#d93025' }}>
                  {net.enabled ? 'Enabled' : 'Disabled'}
                </TableCell>
              </TableRow>
            ))}
            {networks.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No networks.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </NetworkPage>
  )
}

export function NetworkClientsPage() {
  const enabled = useConnected()
  const {
    data: clients = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['networkClients'],
    queryFn: api.listNetworkClients,
    enabled,
    refetchInterval: 30000,
    retry: false,
  })

  const online = clients.filter((c) => c.online).length

  return (
    <NetworkPage
      title="Clients"
      description={`Everything holding an address, sorted by address. ${online} of ${clients.length} online.`}
      error={error as Error | null}
    >
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Site</TableCell>
              <TableCell>IP</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>MAC</TableCell>
              <TableCell>Network</TableCell>
              <TableCell>Connection</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Vendor</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={`${client.site}/${client.id || client.mac}`} hover>
                <TableCell>{client.site}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {client.ip || '—'}
                  {client.fixedIp && (
                    <Chip
                      label="reserved"
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18, ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell>{client.name || client.hostname || '—'}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                  {client.mac}
                </TableCell>
                <TableCell>
                  {client.network || '—'}
                  {client.vlan > 0 && (
                    <Box component="span" sx={{ color: 'text.secondary' }}> · VLAN {client.vlan}</Box>
                  )}
                </TableCell>
                <TableCell>
                  {client.wired ? 'Wired' : 'Wireless'}
                  {client.uplink && (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {' '}· {client.uplink}
                      {client.wired && client.port ? ` port ${client.port}` : ''}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {client.online ? (
                    'Online'
                  ) : (
                    <Tooltip
                      title={
                        client.lastSeen
                          ? `Last seen ${new Date(client.lastSeen * 1000).toLocaleString()}`
                          : 'Never seen'
                      }
                    >
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        Offline
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{client.vendor || '—'}</TableCell>
              </TableRow>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No clients.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </NetworkPage>
  )
}
