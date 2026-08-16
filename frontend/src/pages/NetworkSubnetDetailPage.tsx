import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Pagination,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import type { AddressView } from '../api/client'
import PageHeader from '../components/PageHeader'
import DetailTable, { DetailSection } from '../components/DetailTable'
import { usePermissions } from '../user'

/**
 * Every address in one subnet — the traditional IPAM view.
 *
 * The list is GENERATED from the prefix rather than stored: a /16 has
 * 65k addresses and almost none carry information. What's stored is
 * only what somebody wrote down, joined on here. Which means the page
 * has to be paged by the server, since the range decides how many rows
 * exist and a /8 would be sixteen million of them.
 */
const roleLabels: Record<string, string> = {
  network: 'Network address',
  broadcast: 'Broadcast',
  gateway: 'Gateway',
  dhcp: 'DHCP pool',
}

export default function NetworkSubnetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<AddressView | null>(null)
  const [hostname, setHostname] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: subnets = [] } = useQuery({ queryKey: ['subnets'], queryFn: api.listSubnets })
  const subnet = subnets.find((s) => s.id === id)

  const { data, isLoading } = useQuery({
    queryKey: ['subnetAddresses', id, page],
    queryFn: () => api.subnetAddresses(id!, page),
    enabled: Boolean(id),
  })

  const save = useMutation({
    mutationFn: (address: string) =>
      api.saveSubnetAddress(id!, { address, hostname, status: 'assigned' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subnetAddresses', id] })
      setEditing(null)
      setHostname('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const clear = useMutation({
    mutationFn: (address: string) => api.deleteSubnetAddress(id!, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subnetAddresses', id] }),
    onError: (e: Error) => setError(e.message),
  })

  const pages = data ? Math.ceil(data.total / 100) : 1

  return (
    <Box sx={{ p: 3, pb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/network/subnets')}
        >
          Subnets
        </Button>
      </Box>
      <PageHeader title={subnet?.name ?? 'Subnet'} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {subnet && (
        <Box sx={{ maxWidth: 900, mb: 3 }}>
          <DetailSection title="Range">
            <DetailTable
              rows={[
                { label: 'IPv4 range', value: subnet.ipv4Range },
                { label: 'Gateway', value: subnet.ipv4Gateway || '—' },
                {
                  label: 'DHCP pool',
                  value: subnet.dhcpStart
                    ? `${subnet.dhcpStart} – ${subnet.dhcpStop}`
                    : 'No DHCP — every address here is yours to assign',
                },
                { label: 'VLAN', value: subnet.vlan > 0 ? subnet.vlan : 'Untagged' },
                { label: 'Source', value: subnet.source },
                {
                  label: 'Addresses',
                  // Capacity for the whole range, not this page.
                  value: data
                    ? `${data.total.toLocaleString()} total · ${data.free.toLocaleString()} free · ${data.inDhcp.toLocaleString()} in DHCP · ${data.recorded.toLocaleString()} recorded`
                    : '—',
                },
              ]}
            />
          </DetailSection>
        </Box>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Address</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Hostname</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {data?.addresses.map((item) => (
              <TableRow key={item.address} hover>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {item.address}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {roleLabels[item.role] ?? ''}
                </TableCell>
                <TableCell>
                  {editing?.address === item.address ? (
                    <TextField
                      size="small"
                      autoFocus
                      value={hostname}
                      placeholder="hostname"
                      onChange={(e) => setHostname(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') save.mutate(item.address)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                  ) : (
                    (item.record?.hostname ?? '')
                  )}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {item.record
                    ? item.record.status
                    : item.usable
                      ? 'Available'
                      : 'Unusable'}
                </TableCell>
                <TableCell align="right">
                  {canEdit && item.usable && (
                    <>
                      {editing?.address === item.address ? (
                        <>
                          <Button size="small" onClick={() => save.mutate(item.address)}>
                            Save
                          </Button>
                          <Button size="small" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="small"
                          onClick={() => {
                            setEditing(item)
                            setHostname(item.record?.hostname ?? '')
                          }}
                        >
                          {item.record ? 'Edit' : 'Assign'}
                        </Button>
                      )}
                      {item.record && editing?.address !== item.address && (
                        <Button size="small" onClick={() => clear.mutate(item.address)}>
                          Clear
                        </Button>
                      )}
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!data?.addresses.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading ? 'Loading…' : 'No addresses.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {pages > 1 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
          <Pagination
            count={pages}
            page={page}
            size="small"
            onChange={(_, value) => setPage(value)}
          />
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {data?.total.toLocaleString()} addresses
          </Typography>
        </Box>
      )}
    </Box>
  )
}
