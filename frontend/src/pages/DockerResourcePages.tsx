import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box, Chip, Typography } from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import FilterSelect from '../components/FilterSelect'
import CellLines from '../components/CellLines'
import { api } from '../api/client'
import type { DockerImage, DockerNetwork, DockerVolume } from '../api/client'
import { formatBytes } from '../format'

/**
 * The three resource lists, which are the same page three times: rows
 * from every host, stamped with which one, narrowed by a host filter.
 * They share a file because they share a shape, and splitting them
 * would be three copies of the same twenty lines.
 */

function useHostNames() {
  const { data: hosts = [] } = useQuery({ queryKey: ['dockerHosts'], queryFn: api.listDockerHosts })
  return {
    hosts,
    nameOf: (id: string) => hosts.find((h) => h.id === id)?.name ?? id,
  }
}

function HostFilter({
  hosts,
  value,
  onChange,
}: {
  hosts: { id: string; name: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
      <FilterSelect
        anyLabel="Any host"
        value={value}
        onChange={onChange}
        options={hosts.map((h) => ({ value: h.id, label: h.name }))}
      />
    </Box>
  )
}

export function DockerImagesPage() {
  const { hosts, nameOf } = useHostNames()
  const [host, setHost] = useState('')
  const { data: images = [], isLoading } = useQuery({
    queryKey: ['dockerImages'],
    queryFn: api.listDockerImages,
  })
  const rows = images.filter((i) => host === '' || i.hostId === host)

  const columns = useMemo<ColumnDef<DockerImage, unknown>[]>(
    () => [
      {
        id: 'tags',
        header: 'Image',
        meta: { width: 420 },
        accessorFn: (i) => i.tags.join(' '),
        cell: ({ row }) =>
          row.original.tags.length === 0 ? (
            // A DANGLING IMAGE IS THE FINDING, not a blank: it is what
            // `docker image prune` exists to reclaim, and the only way
            // to notice it is a list that says so.
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip label="untagged" size="small" sx={{ fontSize: 10, height: 18 }} />
              <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>
                {row.original.id.replace('sha256:', '').slice(0, 12)}
              </Box>
            </Box>
          ) : (
            <CellLines>
              {row.original.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </CellLines>
          ),
      },
      {
        id: 'size',
        header: 'Size',
        meta: { align: 'right', nowrap: true, filterText: (i: DockerImage) => formatBytes(i.sizeBytes) },
        accessorFn: (i) => i.sizeBytes,
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
      {
        id: 'inUse',
        header: 'Containers',
        meta: { align: 'right', nowrap: true },
        accessorFn: (i) => i.inUse,
        cell: ({ row }) =>
          row.original.inUse > 0 ? (
            row.original.inUse
          ) : (
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              none
            </Typography>
          ),
      },
      {
        id: 'createdAt',
        header: 'Built',
        meta: { nowrap: true },
        accessorFn: (i) => i.createdAt,
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt * 1000).toLocaleDateString()
            : '—',
      },
      { id: 'host', header: 'Host', meta: { nowrap: true }, accessorFn: (i) => nameOf(i.hostId) },
    ],
    [hosts],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Images" />
      <HostFilter hosts={hosts} value={host} onChange={setHost} />
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(i) => `${i.hostId}/${i.id}`}
        alignTop
        initialSort={[{ id: 'size', desc: true }]}
        filterPlaceholder="Filter by tag or size"
        empty={isLoading ? 'Loading…' : 'No images on any connected host.'}
      />
    </Box>
  )
}

export function DockerVolumesPage() {
  const { hosts, nameOf } = useHostNames()
  const [host, setHost] = useState('')
  const { data: volumes = [], isLoading } = useQuery({
    queryKey: ['dockerVolumes'],
    queryFn: api.listDockerVolumes,
  })
  const rows = volumes.filter((v) => host === '' || v.hostId === host)

  const columns = useMemo<ColumnDef<DockerVolume, unknown>[]>(
    () => [
      { id: 'name', header: 'Volume', meta: { width: 320 }, accessorFn: (v) => v.name },
      {
        id: 'stack',
        header: 'Stack',
        meta: { nowrap: true },
        accessorFn: (v) => v.stack ?? '',
        cell: ({ row }) => row.original.stack || <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>,
      },
      { id: 'driver', header: 'Driver', meta: { nowrap: true }, accessorFn: (v) => v.driver },
      {
        id: 'mountpoint',
        header: 'On disk',
        meta: { width: 340 },
        accessorFn: (v) => v.mountpoint,
        cell: ({ row }) => (
          <Box
            sx={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: 'text.secondary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.original.mountpoint}
          </Box>
        ),
      },
      { id: 'host', header: 'Host', meta: { nowrap: true }, accessorFn: (v) => nameOf(v.hostId) },
    ],
    [hosts],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Volumes" />
      <HostFilter hosts={hosts} value={host} onChange={setHost} />
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(v) => `${v.hostId}/${v.name}`}
        initialSort={[{ id: 'name', desc: false }]}
        filterPlaceholder="Filter by volume, stack or path"
        empty={isLoading ? 'Loading…' : 'No volumes on any connected host.'}
      />
    </Box>
  )
}

export function DockerNetworksPage() {
  const { hosts, nameOf } = useHostNames()
  const [host, setHost] = useState('')
  const { data: networks = [], isLoading } = useQuery({
    queryKey: ['dockerNetworks'],
    queryFn: api.listDockerNetworks,
  })
  const rows = networks.filter((n) => host === '' || n.hostId === host)

  const columns = useMemo<ColumnDef<DockerNetwork, unknown>[]>(
    () => [
      { id: 'name', header: 'Network', meta: { width: 260 }, accessorFn: (n) => n.name },
      {
        id: 'stack',
        header: 'Stack',
        meta: { nowrap: true },
        accessorFn: (n) => n.stack ?? '',
        cell: ({ row }) => row.original.stack || <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>,
      },
      { id: 'driver', header: 'Driver', meta: { nowrap: true }, accessorFn: (n) => n.driver },
      { id: 'scope', header: 'Scope', meta: { nowrap: true }, accessorFn: (n) => n.scope },
      {
        id: 'internal',
        header: 'Reachable',
        meta: { nowrap: true },
        accessorFn: (n) => (n.internal ? 'internal' : 'external'),
        cell: ({ row }) =>
          row.original.internal ? (
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              internal only
            </Typography>
          ) : (
            'external'
          ),
      },
      { id: 'host', header: 'Host', meta: { nowrap: true }, accessorFn: (n) => nameOf(n.hostId) },
    ],
    [hosts],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Networks" />
      <HostFilter hosts={hosts} value={host} onChange={setHost} />
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(n) => `${n.hostId}/${n.id}`}
        initialSort={[{ id: 'name', desc: false }]}
        filterPlaceholder="Filter by network, stack or driver"
        empty={isLoading ? 'Loading…' : 'No networks on any connected host.'}
      />
    </Box>
  )
}
