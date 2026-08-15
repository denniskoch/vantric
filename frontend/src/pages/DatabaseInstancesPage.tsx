import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
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
  Tooltip,
} from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HelpIcon from '@mui/icons-material/Help'
import { api } from '../api/client'
import type { DatabaseServer } from '../api/client'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import PageHeader from '../components/PageHeader'
import { usePermissions } from '../user'
import { engineLabels } from '../databases'
import { BrandLabel } from '../components/BrandIcon'
import { databaseBrand } from '../brands'
import { formatBytes } from '../format'

function StatusGlyph({ server }: { server: DatabaseServer }) {
  const icon =
    server.status === 'connected' ? (
      <CheckCircleIcon sx={{ color: '#188038', fontSize: 18 }} />
    ) : server.status === 'unreachable' ? (
      <ErrorIcon sx={{ color: '#d93025', fontSize: 18 }} />
    ) : (
      <HelpIcon sx={{ color: '#5f6368', fontSize: 18 }} />
    )
  return (
    <Tooltip title={server.error ? `${server.status}: ${server.error}` : server.status}>
      <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>{icon}</span>
    </Tooltip>
  )
}

/** MariaDB only reveals itself in the version banner, so the engine
 *  is read from the server rather than from its type. */
function EngineLabel({ server }: { server: DatabaseServer }) {
  const brand = databaseBrand(server.type, server.info?.version)
  return (
    <BrandLabel
      icon={brand}
      label={brand?.title ?? engineLabels[server.type] ?? server.type}
    />
  )
}

export default function DatabaseInstancesPage() {
  // A database server is a stored credential, so this whole page's
  // actions are owner-only; see rbac.go.
  const { canAdmin } = usePermissions()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuServer, setMenuServer] = useState<DatabaseServer | null>(null)
  const [confirming, setConfirming] = useState<DatabaseServer | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: servers = [], isLoading } = useQuery({
    queryKey: ['databaseServers'],
    queryFn: api.listDatabaseServers,
    refetchInterval: 15000,
  })

  const remove = useMutation({
    mutationFn: (server: DatabaseServer) => api.deleteDatabaseServer(server.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['databaseServers'] })
      setConfirming(null)
    },
    onError: (e: Error) => {
      setError(e.message)
      setConfirming(null)
    },
  })

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Instances"
        actions={
          canAdmin && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddBoxIcon />}
              onClick={() => navigate('/databases/instances/add')}
            >
              Add instance
            </Button>
          )
        }
        description={
          <>
                Database servers already running in your lab. This console connects to
            them — it doesn't provision the servers themselves.
          </>
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Engine</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Host</TableCell>
              <TableCell align="right">Databases</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell align="right">Connections</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {servers.map((server) => (
              <TableRow key={server.id} hover>
                <TableCell>
                  <StatusGlyph server={server} />
                </TableCell>
                <TableCell>
                  <Link
                    component={RouterLink}
                    to={`/databases/instances/${server.id}`}
                    underline="hover"
                  >
                    {server.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <EngineLabel server={server} />
                </TableCell>
                <TableCell>{server.info?.version ?? '—'}</TableCell>
                <TableCell>
                  {server.host}:{server.port}
                </TableCell>
                <TableCell align="right">{server.info?.databases ?? '—'}</TableCell>
                <TableCell align="right">
                  {server.info ? formatBytes(server.info.sizeBytes) : '—'}
                </TableCell>
                <TableCell align="right">
                  {server.info
                    ? `${server.info.connections}/${server.info.maxConnections}`
                    : '—'}
                </TableCell>
                <TableCell align="right">
                  {canAdmin && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        setMenuAnchor(e.currentTarget)
                        setMenuServer(server)
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {servers.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No database servers connected. Click "Add instance" to connect one.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (menuServer) navigate(`/databases/instances/${menuServer.id}/edit`)
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit connection
        </MenuItem>
        <MenuItem
          onClick={() => {
            setConfirming(menuServer)
            setMenuAnchor(null)
          }}
          sx={{ color: '#d93025' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Remove
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(confirming)}
        title={`Remove ${confirming?.name}?`}
        body={`This forgets the connection and its stored credentials. The database server at ${confirming?.host} keeps running and nothing inside it is touched.`}
        pending={remove.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </Box>
  )
}
