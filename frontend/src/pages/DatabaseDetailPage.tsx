import { useState } from 'react'
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
import type { DatabaseGrant } from '../api/client'
import DetailTable, { DetailSection } from '../components/DetailTable'
import { formatBytes } from '../format'
import { BrandLabel } from '../components/BrandIcon'
import { databaseBrand } from '../brands'
import { engineLabels } from '../databases'

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
  const totalSize = tables.reduce((sum, t) => sum + t.sizeBytes, 0)
  const totalRows = tables.reduce((sum, t) => sum + t.rows, 0)

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
                Row counts are the engine's own estimate, and a dash means it
                doesn't have one yet — a console shouldn't run{' '}
                <code>COUNT(*)</code> across your tables to draw a page.
                {tables.length > 0 &&
                  ` ${tables.length} table${tables.length === 1 ? '' : 's'}, about ${totalRows.toLocaleString()} rows, ${formatBytes(totalSize)}.`}
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {isPostgres && <TableCell>Schema</TableCell>}
                      <TableCell>Name</TableCell>
                      {isPostgres && <TableCell>Owner</TableCell>}
                      {!isPostgres && <TableCell>Engine</TableCell>}
                      <TableCell align="right">Rows (est.)</TableCell>
                      <TableCell align="right">Size</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tables.map((t) => (
                      <TableRow key={`${t.schema}.${t.name}`} hover>
                        {isPostgres && <TableCell>{t.schema}</TableCell>}
                        <TableCell>
                          {t.name}
                          {/* Comments are rare; a whole column of dashes
                              isn't worth the width, so it sits under the
                              name where it exists. */}
                          {t.comment && (
                            <Typography sx={{ fontSize: 12, color: '#5f6368' }}>
                              {t.comment}
                            </Typography>
                          )}
                        </TableCell>
                        {isPostgres && <TableCell>{t.owner || '—'}</TableCell>}
                        {!isPostgres && <TableCell>{t.engine || '—'}</TableCell>}
                        {/* 0 means "never analysed" as often as it means
                            empty, so don't claim a sized table has no rows. */}
                        <TableCell align="right">
                          {t.rows > 0 ? t.rows.toLocaleString() : '—'}
                        </TableCell>
                        <TableCell align="right">{formatBytes(t.sizeBytes)}</TableCell>
                      </TableRow>
                    ))}
                    {tables.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 6, color: '#5f6368' }}>
                          {tablesLoading ? 'Loading…' : 'No tables in this database.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
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
                Who may do what, as the server reports it. Granting here offers
                read, read/write and full access — the three answers worth a
                button; anything finer stays in{' '}
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
                        <TableCell sx={{ color: '#5f6368' }}>
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
                                    `${basePath}/access?user=${encodeURIComponent(granteeName(g.grantee))}`,
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
                        <TableCell colSpan={4} align="center" sx={{ py: 6, color: '#5f6368' }}>
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
