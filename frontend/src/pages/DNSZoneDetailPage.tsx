import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteIcon from '@mui/icons-material/Delete'
import AddBoxIcon from '@mui/icons-material/AddBox'
import EditIcon from '@mui/icons-material/Edit'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PendingIcon from '@mui/icons-material/Pending'
import CloudIcon from '@mui/icons-material/Cloud'
import { api } from '../api/client'
import { networkForReverseZone } from '../reverseDns'
import DetailTable from '../components/DetailTable'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { canEdit, formatTTL, recordData, toRecordSets } from '../dnsRecords'
import type { RecordSet } from '../dnsRecords'
import { usePermissions } from '../user'

/** A DNS timer: the number that's in the record, glossed in the unit
 *  a person would have typed it in. */
function formatSeconds(seconds: number): string {
  const unit = (size: number, name: string) => {
    const n = seconds / size
    return `${seconds.toLocaleString()} (${n} ${name}${n === 1 ? '' : 's'})`
  }
  if (seconds >= 86400 && seconds % 86400 === 0) return unit(86400, 'day')
  if (seconds >= 3600 && seconds % 3600 === 0) return unit(3600, 'hour')
  if (seconds >= 60 && seconds % 60 === 0) return unit(60, 'minute')
  return `${seconds.toLocaleString()} seconds`
}

export default function DNSZoneDetailPage() {
  const { canEdit: canEditZone } = usePermissions()
  const { providerId = '', zoneId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('records')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuSet, setMenuSet] = useState<RecordSet | null>(null)
  const [deletingSet, setDeletingSet] = useState<RecordSet | null>(null)

  const zonePath = `/dns/zones/${providerId}/${zoneId}`

  const { data: providers = [] } = useQuery({
    queryKey: ['dnsProviders'],
    queryFn: api.listDNSProviders,
  })
  const provider = providers.find((p) => p.id === providerId)

  const { data: zone, error: zoneError } = useQuery({
    queryKey: ['dnsZone', providerId, zoneId],
    queryFn: () => api.getDNSZone(providerId, zoneId),
    enabled: Boolean(providerId && zoneId),
  })

  const {
    data: records = [],
    isLoading: recordsLoading,
    error: recordsError,
    isFetching,
  } = useQuery({
    queryKey: ['dnsRecords', providerId, zoneId],
    queryFn: () => api.listDNSRecords(providerId, zoneId),
    enabled: Boolean(providerId && zoneId),
  })

  // The SOA is read separately because it is not a record set: a zone
  // has exactly one, it can't be created or deleted, and a provider
  // that manages it itself reports none (404, not an error).
  const { data: soa } = useQuery({
    queryKey: ['dnsSOA', providerId, zoneId],
    queryFn: () => api.getZoneSOA(providerId, zoneId),
    enabled: Boolean(providerId && zoneId),
    retry: false,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dnsZone', providerId, zoneId] })
    queryClient.invalidateQueries({ queryKey: ['dnsRecords', providerId, zoneId] })
    queryClient.invalidateQueries({ queryKey: ['dnsSOA', providerId, zoneId] })
  }

  const removeSet = useMutation({
    mutationFn: (set: RecordSet) =>
      api.deleteDNSRecordSet(providerId, zoneId, set.name, set.type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dnsRecords', providerId, zoneId] })
      setDeletingSet(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setDeletingSet(null)
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteDNSZone(providerId, zoneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dnsZones'] })
      navigate('/dns/zones')
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(false)
    },
  })

  if (zoneError) {
    return (
      <Box sx={{ p: 3 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/dns/zones')}>
          Zones
        </Button>
        <Alert severity="error" sx={{ mt: 2 }}>
          {(zoneError as Error).message}
        </Alert>
      </Box>
    )
  }

  if (!zone) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading zone…</Typography>
      </Box>
    )
  }

  const active = zone.status === 'active' && !zone.paused
  const sets = toRecordSets(records).filter((set) => set.type !== 'SOA')

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 1.5 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/dns/zones')}>
          Zones
        </Button>
        <Typography variant="h5">Zone details</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<RefreshIcon />} onClick={refresh} disabled={isFetching}>
          Refresh
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          disabled={remove.isPending}
          onClick={() => setConfirming(true)}
        >
          Delete zone
        </Button>
      </Box>

      <Box sx={{ px: 3, maxWidth: 1100 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Tooltip title={zone.paused ? 'paused' : zone.status}>
            {active ? (
              <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
            ) : (
              <PendingIcon sx={{ color: 'warning.main', fontSize: 20 }} />
            )}
          </Tooltip>
          <Typography variant="h5">{zone.name}</Typography>
        </Box>

        <DetailTable
          rows={[
            { label: 'DNS name', value: `${zone.name}.` },
            // A reverse zone's name is its network backwards, so the
            // network it answers for is stated rather than decoded.
            ...(networkForReverseZone(zone.name)
              ? [{ label: 'Network', value: networkForReverseZone(zone.name)! }]
              : []),
            { label: 'Provider', value: provider?.name ?? '—' },
            { label: 'Account', value: zone.accountName || '—' },
            // Only providers that HAVE zone modes get the row. A server
            // you run is authoritative or it isn't, and printing
            // "Full" there describes a setting it doesn't have.
            ...(zone.type
              ? [
                  {
                    label: 'Setup',
                    value:
                      zone.type === 'partial'
                        ? 'Partial — the domain keeps its own nameservers; only records you point here are served'
                        : 'Full — the nameservers below answer for the whole domain',
                  },
                ]
              : []),
            { label: 'Status', value: zone.paused ? 'paused' : zone.status },
            {
              label: 'Nameservers',
              value: zone.nameservers?.length ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  {zone.nameservers.map((ns) => (
                    <Box key={ns} sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {ns}
                    </Box>
                  ))}
                </Box>
              ) : (
                'None — delegated elsewhere'
              ),
            },
            { label: 'Zone ID', value: <Box sx={{ fontFamily: 'monospace', fontSize: 13 }}>{zone.id}</Box> },
          ]}
        />
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ px: 3, mt: 3, borderBottom: '1px solid #dadce0', minHeight: 44 }}
      >
        <Tab label="Record sets" value="records" sx={{ textTransform: 'none', minHeight: 44 }} />
      </Tabs>

      <Box sx={{ p: 3, maxWidth: 1100 }}>
        {recordsError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {(recordsError as Error).message}
          </Alert>
        )}
        {/* The SOA is shown apart from the record sets, and not in that
            table, because its seven fields render there as one
            unreadable string. A provider that manages its own reports
            none, and then this section simply isn't there. */}
        {soa && (
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
              <Typography sx={{ fontSize: 16 }}>Start of authority</Typography>
              {canEditZone && (
                <Button size="small" startIcon={<EditIcon />} onClick={() => navigate(`${zonePath}/soa`)}>
                  Edit
                </Button>
              )}
            </Box>

            {/* PowerDNS writes a .invalid nameserver into every zone it
                creates. It is the server saying nobody has set this,
                and it was previously visible only as part of a string
                nobody reads. */}
            {soa.placeholder && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                The primary nameserver is still <code>{soa.primaryNs}</code> — the placeholder
                this zone was created with. Secondaries and anything reading the SOA will see
                it.
              </Alert>
            )}

            <DetailTable
              rows={[
                { label: 'Primary nameserver', value: soa.primaryNs },
                { label: 'Hostmaster', value: soa.hostmaster },
                {
                  label: 'Serial',
                  // Never grouped. The convention is YYYYMMDDnn, so
                  // "2,026,081,601" reads as a quantity where the value
                  // is a date and a revision.
                  value: String(soa.serial),
                },
                { label: 'Refresh', value: formatSeconds(soa.refresh) },
                { label: 'Retry', value: formatSeconds(soa.retry) },
                { label: 'Expire', value: formatSeconds(soa.expire) },
                {
                  label: 'Negative TTL',
                  value: `${formatSeconds(soa.negativeTtl)} — how long "no such name" is cached`,
                },
                { label: 'Record TTL', value: formatSeconds(soa.ttl) },
              ]}
            />
          </Box>
        )}

        <Box sx={{ mb: 2 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddBoxIcon />}
            onClick={() => navigate(`${zonePath}/records/new`)}
          >
            Add record set
          </Button>
        </Box>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>DNS name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">TTL (seconds)</TableCell>
                <TableCell>Record data</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {sets.map((set) => (
                <TableRow key={`${set.name}|${set.type}`} hover>
                  <TableCell>{set.name}.</TableCell>
                  <TableCell>{set.type}</TableCell>
                  <TableCell align="right">{formatTTL(set.ttl)}</TableCell>
                  <TableCell sx={{ fontSize: 13 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                      {set.records.map((record) => (
                        <Box
                          key={record.id}
                          sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
                        >
                          <Box sx={{ wordBreak: 'break-all' }}>{recordData(record)}</Box>
                          {record.proxied && (
                            <Tooltip title="Proxied through the provider">
                              <Chip
                                icon={<CloudIcon sx={{ fontSize: 12 }} />}
                                label="Proxied"
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: 10,
                                  height: 18,
                                  color: '#e8710a',
                                  bgcolor: 'surface.warningTint',
                                  '& .MuiChip-icon': { color: 'inherit' },
                                }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        setMenuAnchor(e.currentTarget)
                        setMenuSet(set)
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {sets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    {recordsLoading ? 'Loading…' : 'No record sets yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          disabled={!menuSet || !canEdit(menuSet.type)}
          onClick={() => {
            if (menuSet) {
              navigate(
                `${zonePath}/records/edit?name=${encodeURIComponent(menuSet.name)}&type=${menuSet.type}`,
              )
            }
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeletingSet(menuSet)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
        {menuSet && !canEdit(menuSet.type) && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', px: 2, py: 1, maxWidth: 260 }}>
            {menuSet.type} records carry structured data — edit them at the provider.
          </Typography>
        )}
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deletingSet)}
        title={`Delete the ${deletingSet?.type} record set for ${deletingSet?.name}?`}
        body={`This removes ${deletingSet?.records.length ?? 0} record${
          deletingSet?.records.length === 1 ? '' : 's'
        }: ${deletingSet?.records.map(recordData).join(', ')}`}
        pending={removeSet.isPending}
        onCancel={() => setDeletingSet(null)}
        onConfirm={() => deletingSet && removeSet.mutate(deletingSet)}
      />

      <ConfirmDeleteDialog
        open={confirming}
        title={`Delete ${zone.name}?`}
        body={`This removes the zone and all ${records.length} of its records at ${
          provider?.name ?? 'the provider'
        }. The domain itself is not affected, but it will stop resolving through this provider.`}
        confirmPhrase={zone.name}
        confirmLabel="to delete it"
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => remove.mutate()}
      />
    </Box>
  )
}
