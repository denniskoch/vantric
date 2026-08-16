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
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
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
  const enabled = useConnected()
  const {
    data: wans = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['labNetworks', 'wan'],
    queryFn: () => api.listLabNetworks('wan'),
    enabled,
    refetchInterval: 60000,
    retry: false,
  })
  // Live status comes from a gateway. A site with only switches and
  // access points has an uplink the controller can't see, and blank
  // cells should say so rather than look broken.
  const { data: devices = [] } = useQuery({
    queryKey: ['networkDevices'],
    queryFn: api.listNetworkDevices,
    enabled,
    retry: false,
  })
  const sitesWithGateway = new Set(
    devices.filter((d) => d.kind === 'gateway').map((d) => d.site),
  )

  return (
    <NetworkPage
      title="Internet"
      description="The WAN connections feeding each site, with the address and latency the gateway reports."
      error={error as Error | null}
    >
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Site</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>IP</TableCell>
              <TableCell>ISP</TableCell>
              <TableCell align="right">Latency</TableCell>
              <TableCell align="right">Signal / speed test</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {wans.map((wan) => {
              const blind = !sitesWithGateway.has(wan.site)
              return (
                <TableRow key={`${wan.site}/${wan.id}`} hover>
                  <TableCell>{wan.site}</TableCell>
                  <TableCell>{wan.name}</TableCell>
                  <TableCell sx={{ color: '#5f6368' }}>
                    {wan.cellular ? `cellular ${wan.purpose}` : 'wired'}
                  </TableCell>
                  <TableCell sx={{ color: wan.up ? '#188038' : '#5f6368' }}>
                    {wan.up
                      ? wan.purpose === 'failover'
                        ? 'Standby'
                        : 'Up'
                      : blind
                        ? '—'
                        : 'Not connected'}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {wan.ip || (blind ? '—' : '—')}
                  </TableCell>
                  <TableCell>
                    {wan.isp || (
                      <Tooltip
                        title={
                          blind
                            ? 'No UniFi gateway at this site, so the controller has nothing to report'
                            : 'The gateway has no reading for this uplink'
                        }
                      >
                        <Box component="span" sx={{ color: '#5f6368' }}>
                          {blind ? 'No gateway here' : '—'}
                        </Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ color: wan.latencyMs > 100 ? '#f29900' : undefined }}>
                    {wan.latencyMs ? `${wan.latencyMs} ms` : '—'}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color: wan.cellular && wan.signalPercent < 40 ? '#f29900' : '#5f6368',
                    }}
                  >
                    {wan.cellular ? (
                      <Tooltip title={wan.dataPlan || 'No data plan reported'}>
                        <span>
                          {wan.signalPercent}% · {wan.radio || 'cellular'}
                        </span>
                      </Tooltip>
                    ) : wan.downMbps ? (
                      `${Math.round(wan.downMbps)} ↓ / ${Math.round(wan.upMbps)} ↑ Mbps`
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {wans.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No internet connections.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </NetworkPage>
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
      description="The SSIDs your access points broadcast."
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


/** Sites is the section's own index: one row per site with what the
 *  controller manages there, so four houses read as four rows rather
 *  than as one long list you have to sort in your head. */
export function NetworkSitesPage() {
  const enabled = useConnected()
  const { data: sites = [], isLoading, error } = useQuery({
    queryKey: ['networkSites'],
    queryFn: api.listNetworkSites,
    enabled,
    retry: false,
  })
  const { data: networks = [] } = useQuery({
    queryKey: ['labNetworks', 'all'],
    queryFn: () => api.listLabNetworks(),
    enabled,
    retry: false,
  })
  const { data: wifi = [] } = useQuery({
    queryKey: ['networkWiFi'],
    queryFn: api.listNetworkWiFi,
    enabled,
    retry: false,
  })
  const { data: devices = [] } = useQuery({
    queryKey: ['networkDevices'],
    queryFn: api.listNetworkDevices,
    enabled,
    retry: false,
  })
  const { data: clients = [] } = useQuery({
    queryKey: ['networkClients'],
    queryFn: api.listNetworkClients,
    enabled,
    retry: false,
  })

  const countIn = <T extends { site: string }>(rows: T[], site: string) =>
    rows.filter((row) => row.site === site).length

  return (
    <NetworkPage
      title="Sites"
      description="Every site this controller manages, and what it runs at each one."
      error={error as Error | null}
    >
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Site</TableCell>
              <TableCell>Internet</TableCell>
              <TableCell align="right">Networks</TableCell>
              <TableCell align="right">SSIDs</TableCell>
              <TableCell align="right">Devices</TableCell>
              <TableCell align="right">Clients</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sites.map((site) => {
              const wans = networks.filter((n) => n.site === site.name && n.category === 'wan')
              const up = wans.filter((n) => n.up)
              const offline = devices.filter(
                (d) => d.site === site.name && d.state !== 'online',
              ).length
              return (
                <TableRow key={site.id} hover>
                  <TableCell>{site.name}</TableCell>
                  <TableCell>
                    {up.length > 0 ? (
                      <Box component="span" sx={{ color: '#188038' }}>
                        {up.map((n) => n.isp || n.name).join(', ')}
                      </Box>
                    ) : (
                      <Tooltip
                        title={
                          wans.length === 0
                            ? 'No WAN configured at this site'
                            : 'No uplink reporting — often means no UniFi gateway here'
                        }
                      >
                        <Box component="span" sx={{ color: '#5f6368' }}>
                          Not reported
                        </Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {networks.filter((n) => n.site === site.name && n.category === 'lan').length}
                  </TableCell>
                  <TableCell align="right">{countIn(wifi, site.name)}</TableCell>
                  <TableCell align="right">
                    {countIn(devices, site.name)}
                    {offline > 0 && (
                      <Tooltip title={`${offline} not online`}>
                        <Box component="span" sx={{ color: '#f29900' }}> · {offline} down</Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right">{countIn(clients, site.name)}</TableCell>
                </TableRow>
              )
            })}
            {sites.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading ? 'Loading…' : 'No sites.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </NetworkPage>
  )
}
