import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Button,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AddBoxIcon from '@mui/icons-material/AddBox'
import { api } from '../api/client'
import type { DatabaseGrant, DatabaseTable } from '../api/client'
import type { ColumnDef } from '@tanstack/react-table'
import DataTable from '../components/DataTable'
import DetailTable, { DetailSection } from '../components/DetailTable'
import { formatBytes } from '../format'
import { BrandLabel } from '../components/BrandIcon'
import { databaseBrand } from '../brands'
import { engineLabels } from '../databases'

/** What a row's kind is called, and whether its numbers mean anything. */
function kindLabel(kind: DatabaseTable['kind']): string {
  if (kind === 'view') return 'View'
  if (kind === 'matview') return 'Materialized view'
  return 'Table'
}

const stores = (t: DatabaseTable) => t.kind !== 'view'

type TabID = 'details' | 'tables' | 'permissions'

/**
 * One database, on the same tabbed template as a VM instance.
 *
 * Tables and permissions are read on demand rather than polled: both
 * query someone else's catalog, and on PostgreSQL the tables query has
 * to open a connection to the database itself.
 */
export default function DatabaseDetailPage() {
  const { id = '', name = '' } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabID>('details')
  const [revoking, setRevoking] = useState<DatabaseGrant | null>(null)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const basePath = `/databases/instances/${id}/databases/${encodeURIComponent(name)}`

  const { data: server } = useQuery({
    queryKey: ['databaseServer', id],
    queryFn: () => api.getDatabaseServer(id),
    enabled: Boolean(id),
  })
  const { data: databases = [] } = useQuery({
    queryKey: ['databases', id],
    queryFn: () => api.listDatabases(id),
    enabled: Boolean(id),
  })
  const db = databases.find((d) => d.name === name)

  const {
    data: tables = [],
    isLoading: tablesLoading,
    error: tablesError,
  } = useQuery({
    queryKey: ['databaseTables', id, name],
    queryFn: () => api.listDatabaseTables(id, name),
    enabled: Boolean(id) && Boolean(name) && tab === 'tables',
    retry: false,
  })

  const {
    data: grants = [],
    isLoading: grantsLoading,
    error: grantsError,
  } = useQuery({
    queryKey: ['databaseGrants', id, name],
    queryFn: () => api.listDatabaseGrants(id, name),
    enabled: Boolean(id) && Boolean(name) && tab === 'permissions',
    retry: false,
  })

  const revoke = useMutation({
    mutationFn: (g: DatabaseGrant) =>
      api.revokeDatabaseAccess(id, name, granteeName(g.grantee), granteeHost(g.grantee)),
    onSuccess: () => {
      setRevoking(null)
      queryClient.invalidateQueries({ queryKey: ['databaseGrants', id, name] })
    },
    onError: (e: Error) => {
      setRevoking(null)
      setError(e.message)
    },
  })

  // PostgreSQL has schemas and per-table owners; MySQL has neither, so
  // the columns disappear rather than printing a column of dashes.
  const isPostgres = server?.type === 'postgres'
  // THE TOTALS ARE THE TABLES' ONLY. A view stores nothing, so adding
  // it to a count of tables overstates how many there are, and adding
  // its size adds a number that isn't one — PostgreSQL reports a few
  // pages for a view's definition, which would quietly inflate the
  // disk figure this line exists to give.
  const tableColumns = useMemo<ColumnDef<DatabaseTable, unknown>[]>(() => {
    const cols: ColumnDef<DatabaseTable, unknown>[] = []
    if (isPostgres) {
      cols.push({
        id: 'schema',
        header: 'Schema',
        meta: { width: 140 },
        accessorFn: (t) => t.schema,
      })
    }
    cols.push({
      id: 'name',
      header: 'Name',
      meta: { width: 280 },
      accessorFn: (t) => t.name,
      cell: ({ row }) => (
        <Box>
          {row.original.name}
          {/* Comments are rare; a whole column of dashes isn't worth
              the width, so it sits under the name where it exists. */}
          {row.original.comment && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {row.original.comment}
            </Typography>
          )}
        </Box>
      ),
    })
    cols.push({
      id: 'kind',
      header: 'Kind',
      meta: { nowrap: true, hug: true },
      accessorFn: (t) => kindLabel(t.kind),
      cell: ({ row }) => (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {kindLabel(row.original.kind)}
        </Box>
      ),
    })
    if (isPostgres) {
      cols.push({
        id: 'owner',
        header: 'Owner',
        meta: { nowrap: true },
        accessorFn: (t) => t.owner,
        cell: ({ row }) => row.original.owner || '—',
      })
    } else {
      cols.push({
        id: 'engine',
        header: 'Engine',
        meta: { nowrap: true },
        accessorFn: (t) => t.engine,
        cell: ({ row }) => row.original.engine || '—',
      })
    }
    cols.push({
      id: 'rows',
      header: 'Rows (est.)',
      meta: { align: 'right', nowrap: true },
      // A PLAIN VIEW STORES NOTHING, so it sorts below every real count
      // rather than mixing in among the empty tables — the same rule
      // "Not scored" follows on the CVE list. A materialized view does
      // store its rows and sorts on them like a table.
      accessorFn: (t) => (stores(t) ? t.rows : -1),
      cell: ({ row }) =>
        !stores(row.original) || row.original.rows <= 0
          ? '—'
          : row.original.rows.toLocaleString(),
    })
    cols.push({
      id: 'size',
      header: 'Size',
      meta: { align: 'right', nowrap: true },
      accessorFn: (t) => (stores(t) ? t.sizeBytes : -1),
      cell: ({ row }) =>
        stores(row.original) ? formatBytes(row.original.sizeBytes) : '—',
    })
    return cols
  }, [isPostgres])

  // THE COUNTS AND THE TOTALS ANSWER DIFFERENT QUESTIONS. How many
  // tables there are is a count of TABLES — a view is not one, and a
  // materialized view is not one either. How much disk this holds is a
  // sum over everything that STORES, which includes a materialized view
  // and excludes a plain one: PostgreSQL reports a few pages for a
  // plain view's definition, which would quietly inflate the figure,
  // while a materialized view's bytes are as real as a table's.
  const baseTables = tables.filter((t) => t.kind === 'table')
  const viewCount = tables.length - baseTables.length
  const stored = tables.filter(stores)
  const totalSize = stored.reduce((sum, t) => sum + t.sizeBytes, 0)
  const totalRows = stored.reduce((sum, t) => sum + t.rows, 0)

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 1.5 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/databases/instances/${id}`)}
        >
          {server?.name ?? 'Instance'}
        </Button>
        <Typography variant="h5">{name}</Typography>
        {db?.system && <Chip label="system" size="small" />}
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ px: 3, borderBottom: '1px solid #dadce0', minHeight: 44 }}
      >
        <Tab label="Details" value="details" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Tables" value="tables" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Permissions" value="permissions" sx={{ textTransform: 'none', minHeight: 44 }} />
      </Tabs>

      <Box sx={{ p: 3, maxWidth: 1100 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {tab === 'details' && (
          <DetailSection title="Basic information">
            <DetailTable
              rows={[
                { label: 'Name', value: name },
                {
                  label: 'Instance',
                  value: (
                    <BrandLabel
                      icon={databaseBrand(server?.type ?? '', server?.info?.version)}
                      label={`${server?.name ?? '—'} (${engineLabels[server?.type ?? ''] ?? server?.type ?? ''})`}
                    />
                  ),
                },
                { label: 'Host', value: server ? `${server.host}:${server.port}` : '—' },
                { label: 'Type', value: db?.system ? 'System' : 'User' },
                ...(isPostgres ? [{ label: 'Owner', value: db?.owner || '—' }] : []),
                { label: 'Size', value: db?.sizeBytes ? formatBytes(db.sizeBytes) : '—' },
                { label: 'Encoding', value: db?.encoding || '—' },
                { label: 'Collation', value: db?.collation || '—' },
                { label: 'Open connections', value: String(db?.connections ?? 0) },
              ]}
            />
          </DetailSection>
        )}

        {tab === 'tables' && (
          <>
            {tablesError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {(tablesError as Error).message}
              </Alert>
            )}
            <DetailSection title="Tables">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Row counts are the engine's own estimate; a dash means it doesn't
                have one yet.
                {tables.length > 0 &&
                  ` ${baseTables.length} table${baseTables.length === 1 ? '' : 's'}`}
                {viewCount > 0 && ` and ${viewCount} view${viewCount === 1 ? '' : 's'}`}
                {tables.length > 0 &&
                  `, about ${totalRows.toLocaleString()} rows, ${formatBytes(totalSize)}.`}
              </Typography>
              {/* SORTED BY SIZE, because that is what the column is for.
                  A listing exists to answer "what is big in here", and
                  alphabetical makes you read every row to find out. */}
              <DataTable
                rows={tables}
                columns={tableColumns}
                getRowId={(t) => `${t.schema}.${t.name}`}
                initialSort={[{ id: 'size', desc: true }]}
                filterPlaceholder="Filter tables"
                empty={tablesLoading ? 'Loading…' : 'No tables in this database.'}
              />
            </DetailSection>
          </>
        )}

        {tab === 'permissions' && (
          <>
            {grantsError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {(grantsError as Error).message}
              </Alert>
            )}
            <DetailSection
              title="Permissions"
              action={
                <Button
                  size="small"
                  startIcon={<AddBoxIcon />}
                  onClick={() => navigate(`${basePath}/access`)}
                >
                  Grant access
                </Button>
              }
            >
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Who may do what, as the server reports it. Granting here offers read,
                read/write and full access; anything finer stays in{' '}
                {isPostgres ? 'psql' : 'the MySQL client'}.
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Grantee</TableCell>
                      <TableCell>On</TableCell>
                      <TableCell>Privileges</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {grants.map((g) => (
                      <TableRow key={`${g.grantee}/${g.scope}`} hover>
                        <TableCell>{g.grantee}</TableCell>
                        <TableCell sx={{ color: g.scope ? '#202124' : '#5f6368' }}>
                          {g.scope || 'the database'}
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>
                          {g.privileges.join(', ')}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {/* PUBLIC isn't a user you can revoke like one, and
                              the owner's own rights aren't a grant to take. */}
                          {g.grantee !== 'PUBLIC' && (
                            <>
                              <Button
                                size="small"
                                onClick={() =>
                                  navigate(
                                    // The host travels too: it is half of
                                    // which account this grant belongs to,
                                    // and a form that had to guess it
                                    // guessed '%' and named a different one.
                                    `${basePath}/access?user=${encodeURIComponent(
                                      granteeName(g.grantee),
                                    )}&host=${encodeURIComponent(granteeHost(g.grantee))}`,
                                  )
                                }
                              >
                                Change
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                onClick={() => setRevoking(g)}
                              >
                                Revoke
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {grants.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                          {grantsLoading
                            ? 'Loading…'
                            : 'No explicit grants — only the owner and superusers can reach this.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </DetailSection>
          </>
        )}
      </Box>

      <Dialog open={Boolean(revoking)} onClose={() => setRevoking(null)}>
        <DialogTitle>Revoke {revoking && granteeName(revoking.grantee)}'s access?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            They lose every privilege on {name}, including the standing rule
            that would have covered tables created later. The account itself
            stays — this only takes away its way into this database.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevoking(null)}>Cancel</Button>
          <Button
            color="error"
            disabled={revoke.isPending}
            onClick={() => revoking && revoke.mutate(revoking)}
          >
            Revoke
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// MySQL reports a grantee as 'user'@'host'; PostgreSQL reports a bare
// role name. These split the two halves back out without the quotes.
function granteeName(grantee: string): string {
  const at = grantee.lastIndexOf('@')
  const name = at === -1 ? grantee : grantee.slice(0, at)
  return name.replace(/^'|'$/g, '')
}

function granteeHost(grantee: string): string {
  const at = grantee.lastIndexOf('@')
  if (at === -1) return ''
  return grantee.slice(at + 1).replace(/^'|'$/g, '')
}
