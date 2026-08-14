import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
  TextField,
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
import { identifierError } from '../validation'

type TabID = 'databases' | 'users' | 'connections'

const yesNo = (value: boolean) => (value ? 'Yes' : 'No')

export default function DatabaseInstanceDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabID>('databases')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const [newDatabase, setNewDatabase] = useState<{ name: string; owner: string } | null>(null)
  const [droppingDatabase, setDroppingDatabase] = useState<Database | null>(null)
  const [newUser, setNewUser] = useState<{
    name: string
    host: string
    password: string
    canLogin: boolean
    createDb: boolean
  } | null>(null)
  const [droppingUser, setDroppingUser] = useState<DatabaseUser | null>(null)
  const [passwordFor, setPasswordFor] = useState<{ user: DatabaseUser; password: string } | null>(
    null,
  )
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

  const createDatabase = useMutation({
    mutationFn: () =>
      api.createDatabase(id, {
        name: newDatabase!.name.trim(),
        owner: newDatabase!.owner || undefined,
      }),
    onSuccess: () => {
      setNewDatabase(null)
      refresh()
    },
    onError,
  })
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
  const createUser = useMutation({
    mutationFn: () =>
      api.createDatabaseUser(id, {
        name: newUser!.name.trim(),
        host: hostScoped ? newUser!.host.trim() || '%' : undefined,
        password: newUser!.password,
        canLogin: newUser!.canLogin,
        createDb: newUser!.createDb,
      }),
    onSuccess: () => {
      setNewUser(null)
      refresh()
    },
    onError,
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
  const setPassword = useMutation({
    mutationFn: () =>
      api.setDatabaseUserPassword(
        id,
        passwordFor!.user.name,
        passwordFor!.password,
        passwordFor!.user.host,
      ),
    onSuccess: () => setPasswordFor(null),
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
  // MySQL identities are user@host and its databases have no owner;
  // PostgreSQL is the other way round.
  const hostScoped = server.type === 'mysql'
  const hasOwners = server.type === 'postgres'
  const brand = databaseBrand(server.type, server.info?.version)
  const newDatabaseError = newDatabase ? identifierError(newDatabase.name) : null
  const newUserError = newUser ? identifierError(newUser.name) : null

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
            <CheckCircleIcon sx={{ color: '#188038', fontSize: 20 }} />
          ) : (
            <ErrorIcon sx={{ color: '#d93025', fontSize: 20 }} />
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
                onClick={() => setNewDatabase({ name: '', owner: '' })}
              >
                Create database
              </Button>
            </Box>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Owner</TableCell>
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
                        {db.name}
                        {db.system && (
                          <Chip
                            label="system"
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: 10, height: 18, ml: 1 }}
                          />
                        )}
                      </TableCell>
                      <TableCell>{db.owner || '—'}</TableCell>
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
                      <TableCell colSpan={7} align="center" sx={{ py: 6, color: '#5f6368' }}>
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
                onClick={() =>
                  setNewUser({
                    name: '',
                    host: '%',
                    password: '',
                    canLogin: true,
                    createDb: false,
                  })
                }
              >
                Create user
              </Button>
            </Box>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Can log in</TableCell>
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
                        {user.host && <Box component="span" sx={{ color: '#5f6368' }}>@{user.host}</Box>}
                      </TableCell>
                      <TableCell>{yesNo(user.canLogin)}</TableCell>
                      <TableCell>{yesNo(user.superuser)}</TableCell>
                      <TableCell>{yesNo(user.createDb)}</TableCell>
                      <TableCell sx={{ color: '#5f6368' }}>
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
                      <TableCell colSpan={7} align="center" sx={{ py: 6, color: '#5f6368' }}>
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
                    <TableCell colSpan={8} align="center" sx={{ py: 6, color: '#5f6368' }}>
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
        <MenuItem
          onClick={() => {
            if (userMenu) setPasswordFor({ user: userMenu.user, password: '' })
            setUserMenu(null)
          }}
        >
          <KeyIcon fontSize="small" sx={{ mr: 1 }} /> Set password
        </MenuItem>
        <MenuItem
          disabled={userMenu?.user.system}
          onClick={() => {
            setDroppingUser(userMenu?.user ?? null)
            setUserMenu(null)
          }}
          sx={{ color: '#d93025' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Drop user
        </MenuItem>
        {userMenu?.user.system && (
          <Typography sx={{ fontSize: 12, color: '#5f6368', px: 2, py: 1, maxWidth: 260 }}>
            The server ships with this account and uses it internally.
          </Typography>
        )}
      </Menu>

      {/* Create database */}
      <Dialog open={Boolean(newDatabase)} onClose={() => setNewDatabase(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Create database</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          <TextField
            label="Name"
            size="small"
            value={newDatabase?.name ?? ''}
            onChange={(e) => setNewDatabase({ ...newDatabase!, name: e.target.value })}
            error={Boolean(newDatabaseError)}
            helperText={newDatabaseError ?? 'Letters, digits, underscore or hyphen'}
            fullWidth
          />
          {hasOwners && (
          <TextField
            label="Owner"
            size="small"
            select
            value={newDatabase?.owner ?? ''}
            onChange={(e) => setNewDatabase({ ...newDatabase!, owner: e.target.value })}
            helperText="Defaults to the role this console connects as"
            fullWidth
          >
            <MenuItem value="">
              <em>{server.username}</em>
            </MenuItem>
            {users.map((user) => (
              <MenuItem key={user.name} value={user.name}>
                {user.name}
              </MenuItem>
            ))}
          </TextField>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewDatabase(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={
              !newDatabase?.name || Boolean(newDatabaseError) || createDatabase.isPending
            }
            onClick={() => createDatabase.mutate()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create user */}
      <Dialog open={Boolean(newUser)} onClose={() => setNewUser(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Create user</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField
            label="Name"
            size="small"
            value={newUser?.name ?? ''}
            onChange={(e) => setNewUser({ ...newUser!, name: e.target.value })}
            error={Boolean(newUserError)}
            helperText={newUserError ?? 'Letters, digits, underscore or hyphen'}
            fullWidth
          />
          {hostScoped && (
            <TextField
              label="Host"
              size="small"
              value={newUser?.host ?? '%'}
              onChange={(e) => setNewUser({ ...newUser!, host: e.target.value })}
              helperText="Where this account may connect from. % means anywhere."
              fullWidth
            />
          )}
          <TextField
            label="Password"
            size="small"
            type="password"
            value={newUser?.password ?? ''}
            onChange={(e) => setNewUser({ ...newUser!, password: e.target.value })}
            error={Boolean(newUser?.canLogin && !newUser.password)}
            helperText={
              newUser?.canLogin && !newUser.password
                ? 'A user that can log in needs a password'
                : ' '
            }
            fullWidth
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={newUser?.canLogin ?? true}
                onChange={(e) => setNewUser({ ...newUser!, canLogin: e.target.checked })}
              />
            }
            label="Can log in"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={newUser?.createDb ?? false}
                onChange={(e) => setNewUser({ ...newUser!, createDb: e.target.checked })}
              />
            }
            label="May create databases"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewUser(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={
              !newUser?.name ||
              Boolean(newUserError) ||
              (newUser.canLogin && !newUser.password) ||
              createUser.isPending
            }
            onClick={() => createUser.mutate()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Set password */}
      <Dialog open={Boolean(passwordFor)} onClose={() => setPasswordFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Set password for {passwordFor?.user.name}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            label="New password"
            size="small"
            type="password"
            value={passwordFor?.password ?? ''}
            onChange={(e) => setPasswordFor({ ...passwordFor!, password: e.target.value })}
            helperText="Existing sessions stay connected; the next login uses this"
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordFor(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!passwordFor?.password || setPassword.isPending}
            onClick={() => setPassword.mutate()}
          >
            Set password
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDeleteDialog
        open={Boolean(droppingDatabase)}
        title={`Drop ${droppingDatabase?.name}?`}
        body={`This deletes the database and everything in it — ${
          droppingDatabase ? formatBytes(droppingDatabase.sizeBytes) : ''
        } of data. It cannot be undone from here.`}
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
