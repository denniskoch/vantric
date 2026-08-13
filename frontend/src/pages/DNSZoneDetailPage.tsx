import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PendingIcon from '@mui/icons-material/Pending'
import CloudIcon from '@mui/icons-material/Cloud'
import { api } from '../api/client'
import type { DNSRecord } from '../api/client'
import DetailTable from '../components/DetailTable'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

/** A record set is every record sharing a name and type, the way Cloud
 *  DNS presents them — Cloudflare returns them one row per value. */
interface RecordSet {
  name: string
  type: string
  ttl: number
  records: DNSRecord[]
}

function toRecordSets(records: DNSRecord[]): RecordSet[] {
  const sets = new Map<string, RecordSet>()
  for (const record of records) {
    const key = `${record.name}|${record.type}`
    const set = sets.get(key)
    if (set) {
      set.records.push(record)
    } else {
      sets.set(key, { name: record.name, type: record.type, ttl: record.ttl, records: [record] })
    }
  }
  return [...sets.values()]
}

const formatTTL = (ttl: number) => (ttl <= 1 ? 'Automatic' : ttl.toLocaleString())

/** These types carry their priority ahead of the value — including a
 *  priority of 0, which is a real setting, not a missing one. */
const prioritized = new Set(['MX', 'SRV', 'URI'])

const recordData = (record: DNSRecord) =>
  prioritized.has(record.type) ? `${record.priority} ${record.content}` : record.content

export default function DNSZoneDetailPage() {
  const { providerId = '', zoneId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('records')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dnsZone', providerId, zoneId] })
    queryClient.invalidateQueries({ queryKey: ['dnsRecords', providerId, zoneId] })
  }

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
  const sets = toRecordSets(records)

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
              <CheckCircleIcon sx={{ color: '#188038', fontSize: 20 }} />
            ) : (
              <PendingIcon sx={{ color: '#f29900', fontSize: 20 }} />
            )}
          </Tooltip>
          <Typography variant="h5">{zone.name}</Typography>
        </Box>

        <DetailTable
          rows={[
            { label: 'DNS name', value: `${zone.name}.` },
            { label: 'Provider', value: provider?.name ?? '—' },
            { label: 'Account', value: zone.accountName || '—' },
            {
              label: 'Setup',
              value:
                zone.type === 'partial'
                  ? 'Partial — the domain keeps its own nameservers; only records you point here are served'
                  : 'Full — the nameservers below answer for the whole domain',
            },
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
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>DNS name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">TTL (seconds)</TableCell>
                <TableCell>Record data</TableCell>
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
                                sx={{ fontSize: 10, height: 18, color: '#e8710a', borderColor: '#e8710a' }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {sets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 6, color: '#5f6368' }}>
                    {recordsLoading ? 'Loading…' : 'This zone has no records.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <ConfirmDeleteDialog
        open={confirming}
        title={`Delete ${zone.name}?`}
        body={`This removes the zone and all ${records.length} of its records at ${
          provider?.name ?? 'the provider'
        }. The domain itself is not affected, but it will stop resolving through this provider.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => remove.mutate()}
      />
    </Box>
  )
}
