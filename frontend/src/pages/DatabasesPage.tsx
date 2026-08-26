import { useMemo } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Link } from '@mui/material'
import type { ColumnDef } from '@tanstack/react-table'
import { api } from '../api/client'
import type { Database } from '../api/client'
import { formatBytes } from '../format'
import { BrandLabel } from '../components/BrandIcon'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import { databaseBrand } from '../brands'

/**
 * Every database across every connected instance — the same
 * spans-all-servers listing the storage pages use.
 *
 * Deliberately no owner column: ownership is a PostgreSQL idea that
 * MySQL answers with grants, so in a mixed list it would be dashes
 * for half the rows. It lives on the instance's own Databases tab,
 * where the engine is known.
 */
export default function DatabasesPage() {
  const { data: servers = [] } = useQuery({
    queryKey: ['databaseServers'],
    queryFn: api.listDatabaseServers,
  })
  const { data: databases = [], isLoading } = useQuery({
    queryKey: ['databases'],
    queryFn: () => api.listDatabases(),
    refetchInterval: 30000,
  })

  const serverFor = (id: string) => servers.find((s) => s.id === id)

  const columns = useMemo<ColumnDef<Database, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        meta: { width: 260 },
        accessorFn: (db) => db.name,
        cell: ({ row }) => (
          <Link
            component={RouterLink}
            to={`/databases/instances/${row.original.serverId}/databases/${encodeURIComponent(row.original.name)}`}
            underline="hover"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        meta: { nowrap: true, hug: true },
        accessorFn: (db) => (db.system ? 'System' : 'User'),
      },
      {
        id: 'instance',
        header: 'Instance',
        meta: { width: 200 },
        // Sorted and filtered on the instance's NAME, which is what the
        // cell draws — the id it is keyed by would sort a list of
        // servers into UUID order.
        accessorFn: (db) => serverFor(db.serverId)?.name ?? '',
        cell: ({ row }) => (
          <Link
            component={RouterLink}
            to={`/databases/instances/${row.original.serverId}`}
            underline="hover"
            sx={{ display: 'block' }}
          >
            <BrandLabel
              icon={databaseBrand(
                serverFor(row.original.serverId)?.type ?? '',
                serverFor(row.original.serverId)?.info?.version,
              )}
              label={serverFor(row.original.serverId)?.name ?? '—'}
            />
          </Link>
        ),
      },
      {
        id: 'size',
        header: 'Size',
        meta: { align: 'right', nowrap: true },
        accessorFn: (db) => db.sizeBytes,
        cell: ({ row }) =>
          row.original.sizeBytes ? formatBytes(row.original.sizeBytes) : '—',
      },
      {
        id: 'encoding',
        header: 'Encoding',
        meta: { nowrap: true },
        accessorFn: (db) => db.encoding,
      },
      {
        id: 'connections',
        header: 'Connections',
        meta: { align: 'right', nowrap: true },
        accessorFn: (db) => db.connections,
      },
    ],
    [servers],
  )

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Databases"
        description={<>Every database across your connected instances.</>}
      />

      {/* BIGGEST FIRST. A cross-server listing is read to find out what
          is taking the room, and alphabetical makes you read all of it. */}
      <DataTable
        rows={databases}
        columns={columns}
        getRowId={(db) => `${db.serverId}/${db.name}`}
        initialSort={[{ id: 'size', desc: true }]}
        filterPlaceholder="Filter databases"
        empty={isLoading ? 'Loading…' : 'No databases — connect an instance first.'}
      />
    </Box>
  )
}
