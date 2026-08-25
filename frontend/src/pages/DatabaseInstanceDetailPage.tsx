import { useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
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
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddBoxIcon from '@mui/icons-material/AddBox'
import KeyIcon from '@mui/icons-material/Key'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import BlockIcon from '@mui/icons-material/Block'
import PublicIcon from '@mui/icons-material/Public'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import { api } from '../api/client'
import type { Database, DatabaseUser } from '../api/client'
import DetailTable from '../components/DetailTable'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { engineLabels } from '../databases'
import BrandIcon from '../components/BrandIcon'
import { databaseBrand } from '../brands'
import { formatBytes, formatDuration } from '../format'

type TabID = 'databases' | 'users' | 'connections'

const yesNo = (value: boolean) => (value ? 'Yes' : 'No')

export default function DatabaseInstanceDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabID>('databases')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const [droppingDatabase, setDroppingDatabase] = useState<Database | null>(null)
  const [droppingUser, setDroppingUser] = useState<DatabaseUser | null>(null)
  const [userMenu, setUserMenu] = useState<{ anchor: HTMLElement; user: DatabaseUser } | null>(null)

  const { data: server, error: serverError } = useQuery({
    queryKey: ['databaseServer', id],
    queryFn: () => api.getDatabaseServer(id),
    refetchInterval: 30000,
  })
  const { data: databases = [], isLoading: databasesLoading } = useQuery({
    queryKey: ['databases', id],
    queryFn: () => api.listDatabases(id),
    enabled: tab === 'databases',
  })
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['databaseUsers', id],
    queryFn: () => api.listDatabaseUsers(id),
    enabled: tab === 'users',
  })
  const { data: connections = [], isLoading: connectionsLoading } = useQuery({
    queryKey: ['databaseConnections', id],
    queryFn: () => api.listDatabaseConnections(id),
    enabled: tab === 'connections',
    refetchInterval: 5000,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['databaseServer', id] })
    queryClient.invalidateQueries({ queryKey: ['databases', id] })
    queryClient.invalidateQueries({ queryKey: ['databaseUsers', id] })
    queryClient.invalidateQueries({ queryKey: ['databaseConnections', id] })
  }

  const onError = (e: Error) => setError(e.message)

  const dropDatabase = useMutation({
    mutationFn: (db: Database) => api.dropDatabase(id, db.name),
    onSuccess: () => {
      setDroppingDatabase(null)
      refresh()
    },
    onError: (e: Error) => {
      onError(e)
      setDroppingDatabase(null)
    },
  })
  const dropUser = useMutation({
    mutationFn: (user: DatabaseUser) => api.dropDatabaseUser(id, user.name, user.host),
    onSuccess: () => {
      setDroppingUser(null)
      refresh()
    },
    onError: (e: Error) => {
      onError(e)
      setDroppingUser(null)
    },
  })
  // Turning an account off is one click and reversible, so it acts from
  // the menu rather than through a confirmation — the dialog rule here
  // is about what cannot be undone.
  const setUserEnabled = useMutation({
    mutationFn: (user: DatabaseUser) =>
      api.setDatabaseUserEnabled(id, user.name, !user.canLogin, user.host),
    onSuccess: refresh,
    onError,
  })
  const removeServer = useMutation({
    mutationFn: () => api.deleteDatabaseServer(id),
    onSuccess: () => navigate('/databases/instances'),
    onError,
  })

  if (serverError) {
    return (
      <Box sx={{ p: 3 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/databases/instances')}
        >
          Instances
        </Button>
        <Alert severity="error" sx={{ mt: 2 }}>
          {(serverError as Error).message}
        </Alert>
      </Box>
    )
  }
  if (!server) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Loading instance…</Typography>
      </Box>
    )
  }

  const connected = server.status === 'connected'
  // MySQL databases have no owner; PostgreSQL's do.
  const hasOwners = server.type === 'postgres'
  const isPostgres = server.type === 'postgres'
  const brand = databaseBrand(server.type, server.info?.version)

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 1.5 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/databases/instances')}
        >
          Instances
        </Button>
        <Tooltip title={server.error || server.status}>
          {connected ? (
            <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
          ) : (
            <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
          )}
        </Tooltip>
        {brand && <BrandIcon icon={brand} size={22} />}
        <Typography variant="h5">{server.name}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<RefreshIcon />} onClick={refresh}>
          Refresh
        </Button>
        <Button
          size="small"
          startIcon={<EditIcon />}
          onClick={() => navigate(`/databases/instances/${id}/edit`)}
        >
          Edit connection
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() => setRemoving(true)}
        >
          Remove
        </Button>
      </Box>

      <Box sx={{ px: 3, maxWidth: 1100 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!connected && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {server.error || 'This server is not reachable right now.'}
          </Alert>
        )}

        <DetailTable
          rows={[
            {
              label: 'Engine',
              value: brand?.title ?? engineLabels[server.type] ?? server.type,
            },
            { label: 'Version', value: server.info?.version ?? '—' },
            { label: 'Endpoint', value: `${server.host}:${server.port}` },
            { label: 'Connecting as', value: `${server.username} → ${server.database}` },
            { label: 'TLS', value: server.sslMode || 'prefer' },
            {
              label: 'Uptime',
              value: server.info?.uptimeSeconds ? formatDuration(server.info.uptimeSeconds) : '—',
            },
            {
              label: 'Size on disk',
              value: server.info ? formatBytes(server.info.sizeBytes) : '—',
            },
            {
              label: 'Connections',
              value: server.info
                ? `${server.info.connections} of ${server.info.maxConnections} allowed`
                : '—',
            },
          ]}
        />
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ px: 3, mt: 3, borderBottom: '1px solid #dadce0', minHeight: 44 }}
      >
        <Tab label="Databases" value="databases" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab label="Users" value="users" sx={{ textTransform: 'none', minHeight: 44 }} />
        <Tab
          label="Connections"
          value="connections"
          sx={{ textTransform: 'none', minHeight: 44 }}
        />
      </Tabs>

      <Box sx={{ p: 3, maxWidth: 1100 }}>
        {tab === 'databases' && (
          <>
            <Box sx={{ mb: 2 }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddBoxIcon />}
                disabled={!connected}
                onClick={() => navigate(`/databases/instances/${id}/databases/create`)}
              >
                Create database
              </Button>
            </Box>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    {hasOwners && <TableCell>Owner</TableCell>}
                    <TableCell align="right">Size</TableCell>
                    <TableCell>Encoding</TableCell>
                    <TableCell>Collation</TableCell>
                    <TableCell align="right">Connections</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {databases.map((db) => (
                    <TableRow key={db.name} hover>
                      <TableCell>
                        <Link
                          component={RouterLink}
                          to={`/databases/instances/${id}/databases/${encodeURIComponent(db.name)}`}
                          underline="hover"
                        >
                          {db.name}
                        </Link>
                      </TableCell>
                      <TableCell>{db.system ? 'System' : 'User'}</TableCell>
                      {hasOwners && <TableCell>{db.owner}</TableCell>}
                      <TableCell align="right">
                        {db.sizeBytes ? formatBytes(db.sizeBytes) : '—'}
                      </TableCell>
                      <TableCell>{db.encoding}</TableCell>
                      <TableCell>{db.collation}</TableCell>
                      <TableCell align="right">{db.connections}</TableCell>
                      <TableCell align="right">
                        <Tooltip
                          title={
                            db.system ? "The engine's own database — not droppable here" : 'Drop'
                          }
                        >
                          <span>
                            <IconButton
                              size="small"
                              disabled={db.system}
                              onClick={() => setDroppingDatabase(db)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {databases.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={hasOwners ? 8 : 7}
                        align="center"
                        sx={{ py: 6, color: 'text.secondary' }}
                      >
                        {databasesLoading ? 'Loading…' : 'No databases.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        {tab === 'users' && (
          <>
            <Box sx={{ mb: 2 }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddBoxIcon />}
                disabled={!connected}
                onClick={() => navigate(`/databases/instances/${id}/users/create`)}
              >
                Create user
              </Button>
            </Box>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Superuser</TableCell>
                    <TableCell>Create DB</TableCell>
                    <TableCell>Member of</TableCell>
                    <TableCell align="right">Connection limit</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={`${user.name}@${user.host}`} hover>
                      <TableCell>
                        {user.name}
                        {user.host && <Box component="span" sx={{ color: 'text.secondary' }}>@{user.host}</Box>}
                      </TableCell>
                      <TableCell>
                        {user.role ? 'Role' : user.system ? 'System' : 'User'}
                      </TableCell>
                      {/* WHAT THIS ANSWERS IS "is this account off", so it
                          says so in those words. "Can log in: No" is the
                          same fact phrased as a property, and reads as a
                          missing capability rather than a decision
                          somebody made. A role is neither — it is not a
                          way in at all. */}
                      <TableCell>
                        {user.role ? (
                          <Box component="span" sx={{ color: 'text.secondary' }}>
                            Not a login
                          </Box>
                        ) : user.canLogin ? (
                          'Enabled'
                        ) : (
                          <Box component="span" sx={{ color: 'warning.dark' }}>Disabled</Box>
                        )}
                      </TableCell>
                      <TableCell>{yesNo(user.superuser)}</TableCell>
                      <TableCell>{yesNo(user.createDb)}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {user.memberOf?.join(', ') || '—'}
                      </TableCell>
                      <TableCell align="right">
                        {user.connectionLimit < 0 ? 'Unlimited' : user.connectionLimit}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={(e) => setUserMenu({ anchor: e.currentTarget, user })}
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                        {usersLoading ? 'Loading…' : 'No users.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        {tab === 'connections' && (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="right">PID</TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>Database</TableCell>
                  <TableCell>Client</TableCell>
                  <TableCell>Application</TableCell>
                  <TableCell>State</TableCell>
                  <TableCell align="right">For</TableCell>
                  <TableCell>Query</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.pid} hover>
                    <TableCell align="right">{conn.pid}</TableCell>
                    <TableCell>{conn.user}</TableCell>
                    <TableCell>{conn.database}</TableCell>
                    <TableCell>{conn.clientAddr || 'local'}</TableCell>
                    <TableCell>{conn.appName || '—'}</TableCell>
                    <TableCell>{conn.state || '—'}</TableCell>
                    <TableCell align="right">{formatDuration(conn.seconds)}</TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 260,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: 'monospace',
                        fontSize: 12,
                      }}
                    >
                      <Tooltip title={conn.query}>
                        <span>{conn.query || '—'}</span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {connections.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                      {connectionsLoading ? 'Loading…' : 'No client connections right now.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Menu
        anchorEl={userMenu?.anchor ?? null}
        open={Boolean(userMenu)}
        onClose={() => setUserMenu(null)}
      >
        {/* A ROLE HAS NO PASSWORD, and a system account's is the
            server's own business — changing mariadb.sys's is a way to
            break the server from a menu. Drop was already guarded on
            both; this was not, which made the row's own actions
            disagree about what it is. */}
        <MenuItem
          disabled={userMenu?.user.system || userMenu?.user.role}
          onClick={() => {
            if (userMenu) {
              const host = userMenu.user.host ? `?host=${encodeURIComponent(userMenu.user.host)}` : ''
              navigate(`/databases/instances/${id}/users/${userMenu.user.name}/password${host}`)
            }
            setUserMenu(null)
          }}
        >
          <KeyIcon fontSize="small" sx={{ mr: 1 }} /> Set password
        </MenuItem>
        {/* MySQL only, and ABSENT rather than disabled on PostgreSQL: a
            role there has no host, and where somebody may connect from
            lives in pg_hba.conf on the server. A greyed-out item invites
            you to work out why. */}
        {!isPostgres && (
          <MenuItem
            disabled={userMenu?.user.system || userMenu?.user.role}
            onClick={() => {
              if (userMenu) {
                const host = userMenu.user.host
                  ? `?host=${encodeURIComponent(userMenu.user.host)}`
                  : ''
                navigate(`/databases/instances/${id}/users/${userMenu.user.name}/host${host}`)
              }
              setUserMenu(null)
            }}
          >
            <PublicIcon fontSize="small" sx={{ mr: 1 }} /> Change host
          </MenuItem>
        )}
        {/* Off, not gone. The grants stay, so whoever inherits the job
            gets them back by turning this on again. */}
        <MenuItem
          disabled={userMenu?.user.system || userMenu?.user.role}
          onClick={() => {
            if (userMenu) setUserEnabled.mutate(userMenu.user)
            setUserMenu(null)
          }}
        >
          {/* A role reads canLogin=false because it is not a way in,
              not because somebody turned it off — so it must not be
              offered an "Enable" that would misdescribe it. */}
          {userMenu?.user.canLogin || userMenu?.user.role ? (
            <>
              <BlockIcon fontSize="small" sx={{ mr: 1 }} /> Disable account
            </>
          ) : (
            <>
              <CheckCircleIcon fontSize="small" sx={{ mr: 1 }} /> Enable account
            </>
          )}
        </MenuItem>
        <MenuItem
          disabled={userMenu?.user.system}
          onClick={() => {
            setDroppingUser(userMenu?.user ?? null)
            setUserMenu(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Drop user
        </MenuItem>
        {userMenu?.user.system && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', px: 2, py: 1, maxWidth: 260 }}>
            The server ships with this account and uses it internally.
          </Typography>
        )}
      </Menu>

      {/* Create database */}
      {/* Create user */}
      {/* Set password */}
      <ConfirmDeleteDialog
        open={Boolean(droppingDatabase)}
        title={`Drop ${droppingDatabase?.name}?`}
        body={`This deletes the database and everything in it — ${
          droppingDatabase ? formatBytes(droppingDatabase.sizeBytes) : ''
        } of data. It cannot be undone from here.`}
        confirmPhrase={droppingDatabase?.name}
        confirmLabel="to drop it"
        actionLabel="Drop"
        pending={dropDatabase.isPending}
        onCancel={() => setDroppingDatabase(null)}
        onConfirm={() => droppingDatabase && dropDatabase.mutate(droppingDatabase)}
      />

      <ConfirmDeleteDialog
        open={Boolean(droppingUser)}
        title={`Drop user ${droppingUser?.name}?`}
        body="The server refuses if the user still owns databases or objects — reassign them first."
        pending={dropUser.isPending}
        onCancel={() => setDroppingUser(null)}
        onConfirm={() => droppingUser && dropUser.mutate(droppingUser)}
      />

      <ConfirmDeleteDialog
        open={removing}
        title={`Remove ${server.name}?`}
        body={`This forgets the connection and its stored credentials. The server at ${server.host} keeps running and nothing inside it is touched.`}
        pending={removeServer.isPending}
        onCancel={() => setRemoving(false)}
        onConfirm={() => removeServer.mutate()}
      />
    </Box>
  )
}
