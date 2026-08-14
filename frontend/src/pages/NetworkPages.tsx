import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import { formatDuration } from '../format'

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
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>
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

  return (
    <NetworkPage
      title="Networks"
      description="The LANs and VLANs your controller defines, with the subnet and DHCP range each one serves."
      error={error as Error | null}
    >
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
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
                <TableCell sx={{ color: '#5f6368' }}>{net.domainName || '—'}</TableCell>
                <TableCell sx={{ color: net.enabled ? undefined : '#d93025' }}>
                  {net.enabled ? 'Enabled' : 'Disabled'}
                </TableCell>
              </TableRow>
            ))}
            {networks.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: '#5f6368' }}>
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
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: '#5f6368' }}>
                  {client.mac}
                </TableCell>
                <TableCell>
                  {client.network || '—'}
                  {client.vlan > 0 && (
                    <Box component="span" sx={{ color: '#5f6368' }}> · VLAN {client.vlan}</Box>
                  )}
                </TableCell>
                <TableCell>
                  {client.wired ? 'Wired' : 'Wireless'}
                  {client.uplink && (
                    <Box component="span" sx={{ color: '#5f6368' }}>
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
                      <Box component="span" sx={{ color: '#5f6368' }}>
                        Offline
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell sx={{ color: '#5f6368' }}>{client.vendor || '—'}</TableCell>
              </TableRow>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: '#5f6368' }}>
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

export function NetworkDevicesPage() {
  const enabled = useConnected()
  const {
    data: devices = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['networkDevices'],
    queryFn: api.listNetworkDevices,
    enabled,
    refetchInterval: 30000,
    retry: false,
  })

  return (
    <NetworkPage
      title="Devices"
      description="The hardware carrying your network: gateways, switches and access points."
      error={error as Error | null}
    >
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Site</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Kind</TableCell>
              <TableCell>Model</TableCell>
              <TableCell>IP</TableCell>
              <TableCell>Firmware</TableCell>
              <TableCell align="right">Clients</TableCell>
              <TableCell align="right">Uptime</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id} hover>
                <TableCell>
                  <Tooltip title={device.state}>
                    <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                      {device.state === 'online' ? (
                        <CheckCircleIcon sx={{ color: '#188038', fontSize: 18 }} />
                      ) : (
                        <ErrorIcon sx={{ color: '#d93025', fontSize: 18 }} />
                      )}
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell>{device.site}</TableCell>
                <TableCell>{device.name}</TableCell>
                <TableCell>{device.kind}</TableCell>
                <TableCell sx={{ color: '#5f6368' }}>{device.model}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {device.ip || '—'}
                </TableCell>
                <TableCell sx={{ color: '#5f6368' }}>{device.version || '—'}</TableCell>
                <TableCell align="right">{device.clients}</TableCell>
                <TableCell align="right">
                  {device.uptimeSeconds ? formatDuration(device.uptimeSeconds) : '—'}
                </TableCell>
              </TableRow>
            ))}
            {devices.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No devices.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </NetworkPage>
  )
}


/** Internet and VPN are the same table over a different slice of the
 *  controller's networks, so they share one component. */
function CategoryPage({
  title,
  description,
  category,
}: {
  title: string
  description: string
  category: string
}) {
  const enabled = useConnected()
  const {
    data: networks = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['labNetworks', category],
    queryFn: () => api.listLabNetworks(category),
    enabled,
    retry: false,
  })

  return (
    <NetworkPage title={title} description={description} error={error as Error | null}>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Site</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Subnet</TableCell>
              <TableCell>Purpose</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {networks.map((net) => (
              <TableRow key={`${net.site}/${net.id}`} hover>
                <TableCell>{net.site}</TableCell>
                <TableCell>{net.name}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {net.subnet || '—'}
                </TableCell>
                <TableCell>{net.purpose || '—'}</TableCell>
                <TableCell sx={{ color: net.enabled ? undefined : '#d93025' }}>
                  {net.enabled ? 'Enabled' : 'Disabled'}
                </TableCell>
              </TableRow>
            ))}
            {networks.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'Nothing here.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </NetworkPage>
  )
}

export function NetworkInternetPage() {
  return (
    <CategoryPage
      title="Internet"
      description="The WAN connections feeding each site, as the controller sees them."
      category="wan"
    />
  )
}

export function NetworkVPNPage() {
  return (
    <CategoryPage
      title="VPN"
      description="Tunnels the controller terminates, client and site-to-site alike."
      category="vpn"
    />
  )
}

export function NetworkWiFiPage() {
  const enabled = useConnected()
  const {
    data: wifi = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['networkWiFi'],
    queryFn: api.listNetworkWiFi,
    enabled,
    refetchInterval: 60000,
    retry: false,
  })

  return (
    <NetworkPage
      title="WiFi"
      description="The SSIDs your access points broadcast. Passphrases are deliberately not read — this console has no business holding them."
      error={error as Error | null}
    >
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Site</TableCell>
              <TableCell>SSID</TableCell>
              <TableCell>Security</TableCell>
              <TableCell>Bands</TableCell>
              <TableCell>Network</TableCell>
              <TableCell align="right">Clients</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {wifi.map((net) => (
              <TableRow key={`${net.site}/${net.id}`} hover>
                <TableCell>{net.site}</TableCell>
                <TableCell>
                  {net.name}
                  {net.guest && (
                    <Chip
                      label="guest"
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18, ml: 1 }}
                    />
                  )}
                  {net.hidden && (
                    <Chip
                      label="hidden"
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 10, height: 18, ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell>{net.security}</TableCell>
                <TableCell sx={{ color: '#5f6368' }}>
                  {net.bands?.join(', ') || '—'}
                </TableCell>
                <TableCell>{net.network || '—'}</TableCell>
                <TableCell align="right">{net.clients}</TableCell>
                <TableCell sx={{ color: net.enabled ? undefined : '#d93025' }}>
                  {net.enabled ? 'Broadcasting' : 'Disabled'}
                </TableCell>
              </TableRow>
            ))}
            {wifi.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No wireless networks.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </NetworkPage>
  )
}
