import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Menu,
  Tooltip,
  Typography,
} from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import CloseIcon from '@mui/icons-material/Close'
import { api } from '../api/client'
import type { Operation } from '../api/client'

/**
 * The notification bell: where work that outlives its request reports
 * in.
 *
 * Cloning a VM, importing a disk and fetching an ISO all take longer
 * than a form should sit there for, so the handler starts the work and
 * answers with an operation. This watches them all in one place, the
 * way a cloud console does — the badge counts what's still running,
 * and a finished one says what it did until you dismiss it.
 */

/** Which cached lists an operation's outcome invalidates. The backend
 *  says what kind of thing it touched; the query keys stay here, where
 *  they're declared. */
const affects: Record<string, string[]> = {
  instance: ['instances', 'instance', 'overview'],
  image: ['images', 'instances'],
  iso: ['isos'],
  cloudImage: ['cloudImages'],
  ctTemplate: ['ctTemplates'],
  backup: ['backups'],
}

export default function NotificationBell() {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: operations = [] } = useQuery({
    queryKey: ['operations'],
    queryFn: api.listOperations,
    refetchInterval: 3000,
  })

  const running = operations.filter((op) => op.status === 'RUNNING')

  // A list that was right before the clone finished is wrong after it.
  // Nothing else knows when that moment was, so the bell refreshes what
  // the operation touched as it lands.
  const settled = useRef(new Set<string>())
  useEffect(() => {
    for (const op of operations) {
      if (op.status === 'RUNNING' || settled.current.has(op.id)) continue
      settled.current.add(op.id)
      for (const key of affects[op.resourceType] ?? []) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    }
  }, [operations, queryClient])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['operations'] })
  const dismiss = useMutation({ mutationFn: api.dismissOperation, onSuccess: refresh })
  const clear = useMutation({ mutationFn: api.clearOperations, onSuccess: refresh })

  return (
    <>
      <Tooltip title={running.length ? `${running.length} in progress` : 'Notifications'}>
        <IconButton
          size="small"
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label={`Notifications: ${running.length} in progress`}
        >
          <Badge
            badgeContent={running.length}
            color="primary"
            slotProps={{ badge: { sx: { fontSize: 10, height: 16, minWidth: 16 } } }}
          >
            <NotificationsIcon fontSize="small" sx={{ color: '#5f6368' }} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 400, maxHeight: 460 } } }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center' }}>
          <Typography sx={{ fontSize: 14, color: '#202124' }}>Notifications</Typography>
          <Box sx={{ flex: 1 }} />
          {operations.some((op) => op.status !== 'RUNNING') && (
            <Button size="small" onClick={() => clear.mutate()}>
              Clear finished
            </Button>
          )}
        </Box>
        <Divider />
        {operations.length === 0 ? (
          <Box sx={{ px: 2, py: 3 }}>
            <Typography sx={{ fontSize: 13, color: '#5f6368' }}>
              Nothing running. Long jobs — creating an instance, building a template,
              downloading an image — report here.
            </Typography>
          </Box>
        ) : (
          operations.map((op) => (
            <OperationRow
              key={op.id}
              operation={op}
              onDismiss={() => dismiss.mutate(op.id)}
              onOpen={() => {
                if (!op.to) return
                setAnchor(null)
                navigate(op.to)
              }}
            />
          ))
        )}
      </Menu>
    </>
  )
}

function OperationRow({
  operation,
  onDismiss,
  onOpen,
}: {
  operation: Operation
  onDismiss: () => void
  onOpen: () => void
}) {
  const running = operation.status === 'RUNNING'
  const failed = operation.status === 'ERROR'
  return (
    <Box
      onClick={onOpen}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        px: 2,
        py: 1.25,
        cursor: operation.to ? 'pointer' : 'default',
        '&:hover': { bgcolor: '#f8f9fa' },
      }}
    >
      <Box sx={{ mt: 0.3, width: 18, display: 'flex', justifyContent: 'center' }}>
        {running ? (
          <CircularProgress size={14} thickness={5} />
        ) : failed ? (
          <ErrorIcon sx={{ fontSize: 18, color: '#d93025' }} />
        ) : (
          <CheckCircleIcon sx={{ fontSize: 18, color: '#188038' }} />
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, color: '#202124' }}>{operation.title}</Typography>
        <Typography
          sx={{
            fontSize: 12,
            color: failed ? '#d93025' : '#5f6368',
            overflowWrap: 'anywhere',
          }}
        >
          {operation.error || operation.step || (running ? 'Starting…' : 'Finished')}
        </Typography>
        <Typography sx={{ fontSize: 11, color: '#80868b', mt: 0.25 }}>
          {elapsed(operation)}
        </Typography>
      </Box>
      {/* Running work can't be dismissed: hiding something that's still
          happening is how you end up wondering whether it happened. */}
      {!running && (
        <IconButton
          size="small"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
    </Box>
  )
}

function elapsed(op: Operation): string {
  const start = new Date(op.startedAt).getTime()
  const end = op.endedAt ? new Date(op.endedAt).getTime() : Date.now()
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const took =
    seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  return op.status === 'RUNNING' ? `Running for ${took}` : `Took ${took}`
}
