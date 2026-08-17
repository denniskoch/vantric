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
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
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
 * way a cloud console does — and it tells you WITHOUT BEING OPENED,
 * which is the whole point of putting it in the toolbar: it rings while
 * something is running, and keeps a dot on whatever finished since you
 * last looked. Nobody should have to sit with a menu open to find out
 * their VM came up.
 */

/** Which cached lists an operation's outcome invalidates. The backend
 *  says what kind of thing it touched; the query keys stay here, where
 *  they're declared. */
const affects: Record<string, string[]> = {
  instance: ['instances', 'instance', 'overview'],
  container: ['containers', 'container', 'overview'],
  image: ['images', 'instances'],
  iso: ['isos'],
  cloudImage: ['cloudImages'],
  ctTemplate: ['ctTemplates'],
  backup: ['backups'],
}

export default function NotificationBell() {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  // Operations that finished since the menu was last open. The point of
  // a bell is not having to keep it open to find out.
  const [unseen, setUnseen] = useState<Set<string>>(new Set())
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
    const landed: string[] = []
    for (const op of operations) {
      if (op.status === 'RUNNING' || settled.current.has(op.id)) continue
      settled.current.add(op.id)
      landed.push(op.id)
      for (const key of affects[op.resourceType] ?? []) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    }
    if (landed.length > 0) {
      setUnseen((current) => new Set([...current, ...landed]))
    }
  }, [operations, queryClient])

  // Opening the menu is reading them.
  useEffect(() => {
    if (anchor) setUnseen(new Set())
  }, [anchor])

  // One state drives the icon, the badge and the label, so they can't
  // contradict each other: busy while something runs, then done or
  // failed until you look, then idle.
  const mode: BellMode =
    running.length > 0
      ? 'busy'
      : unseen.size === 0
        ? 'idle'
        : operations.some((op) => unseen.has(op.id) && op.status === 'ERROR')
          ? 'failed'
          : 'done'

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['operations'] })
  const dismiss = useMutation({ mutationFn: api.dismissOperation, onSuccess: refresh })
  const clear = useMutation({ mutationFn: api.clearOperations, onSuccess: refresh })

  return (
    <>
      <Tooltip title={label(mode, running.length, unseen.size)}>
        <IconButton
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label={label(mode, running.length, unseen.size)}
          aria-live="polite"
        >
          {/* Three separate cases rather than one badge with clever
              props: MUI treats a badge whose content is 0 as one to
              hide, which quietly swallowed the finished-work dot. */}
          {mode === 'busy' ? (
            <Badge
              badgeContent={running.length}
              color="primary"
              slotProps={{ badge: { sx: { fontSize: 10, height: 16, minWidth: 16 } } }}
            >
              <NotificationsNoneIcon sx={bellIcon(mode)} />
            </Badge>
          ) : mode === 'idle' ? (
            <NotificationsNoneIcon sx={bellIcon(mode)} />
          ) : (
            <Badge variant="dot" color={mode === 'failed' ? 'error' : 'success'}>
              <NotificationsNoneIcon sx={bellIcon(mode)} />
            </Badge>
          )}
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
          <Typography sx={{ fontSize: 14, color: 'text.primary' }}>Notifications</Typography>
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
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
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
        '&:hover': { bgcolor: 'surface.subtle' },
      }}
    >
      <Box sx={{ mt: 0.3, width: 18, display: 'flex', justifyContent: 'center' }}>
        {running ? (
          <CircularProgress size={14} thickness={5} />
        ) : failed ? (
          <ErrorIcon sx={{ fontSize: 18, color: 'error.main' }} />
        ) : (
          <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, color: 'text.primary' }}>{operation.title}</Typography>
        <Typography
          sx={{
            fontSize: 12,
            color: failed ? '#d93025' : '#5f6368',
            overflowWrap: 'anywhere',
          }}
        >
          {operation.error || operation.step || (running ? 'Starting…' : 'Finished')}
        </Typography>
        <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.25 }}>
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

type BellMode = 'idle' | 'busy' | 'done' | 'failed'

/**
 * The bell rings while work is running, because the whole point is not
 * having to open it to find out. It swings for under a second and then
 * rests, rather than shaking continuously — a permanent animation in a
 * toolbar stops being information and becomes a distraction.
 */
function bellIcon(mode: BellMode) {
  const busy = mode === 'busy'
  return {
    fontSize: 22,
    color: busy ? '#1a73e8' : mode === 'failed' ? '#d93025' : '#5f6368',
    transformOrigin: 'top center',
    animation: busy ? 'lcmBellRing 2.4s ease-in-out infinite' : 'none',
    '@keyframes lcmBellRing': {
      '0%, 45%, 100%': { transform: 'rotate(0deg)' },
      '4%': { transform: 'rotate(14deg)' },
      '9%': { transform: 'rotate(-12deg)' },
      '14%': { transform: 'rotate(10deg)' },
      '19%': { transform: 'rotate(-8deg)' },
      '24%': { transform: 'rotate(5deg)' },
      '29%': { transform: 'rotate(-3deg)' },
      '34%': { transform: 'rotate(1deg)' },
    },
    // Movement isn't the only signal — the colour and the badge say the
    // same thing — so it costs nothing to leave people alone here.
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  }
}

function label(mode: BellMode, running: number, unseen: number): string {
  switch (mode) {
    case 'busy':
      return `${running} operation${running === 1 ? '' : 's'} in progress`
    case 'failed':
      return `${unseen} finished, one of them badly`
    case 'done':
      return `${unseen} finished`
    default:
      return 'Notifications'
  }
}
