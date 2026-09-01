import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Menu,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import CloseIcon from '@mui/icons-material/Close'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
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
 * which is the whole point of putting it in the toolbar: a ring turns
 * around it while something is running, and once work lands the ring
 * holds the number that finished since you last looked. Nobody should
 * have to sit with a menu open to find out their VM came up.
 */

/** Which cached lists an operation's outcome invalidates. The backend
 *  says what kind of thing it touched; the query keys stay here, where
 *  they're declared. */
const affects: Record<string, string[]> = {
  instance: ['instances', 'instance', 'instanceDetail', 'overview'],
  snapshot: ['snapshots', 'instance', 'instanceDetail'],
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

  const [outputOf, setOutputOf] = useState<Operation | null>(null)
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

  // One state drives the shape, the count and the label, so they can't
  // contradict each other: busy while something runs — which outranks
  // anything waiting to be read, since it's the thing still changing —
  // then done or failed until you look, then idle.
  const mode: BellMode =
    running.length > 0
      ? 'busy'
      : unseen.size === 0
        ? 'idle'
        : operations.some((op) => unseen.has(op.id) && op.status === 'ERROR')
          ? 'failed'
          : // WORST UNREAD WINS, and a warning is its own rank between
            // finished and failed. Folding it into 'done' would hide the
            // one thing worth glancing at; folding it into 'failed'
            // would cry wolf, which is what this change is undoing.
            operations.some((op) => unseen.has(op.id) && op.status === 'WARNING')
            ? 'warned'
            : 'done'

  // A ring that turns is the signal here, so there is no colour or dot
  // left to carry it when motion is unwelcome: the ring stays, still.
  const stillMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

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
          // The ring is the same 30px as the avatar beside it, which
          // leaves the default 8px padding too tall for a 48px toolbar.
          sx={{ p: 0.75 }}
        >
          {/* Three shapes, one per state: a bare bell when there is
              nothing to say, the bell inside a turning ring while work
              runs, and — once it lands — the ring alone with the count
              in it, since at that point the number IS the news. */}
          {mode === 'busy' ? (
            <Ring color="#1a73e8" spinning={!stillMotion}>
              <NotificationsNoneIcon sx={bellIcon(mode)} />
            </Ring>
          ) : mode === 'idle' ? (
            <NotificationsNoneIcon sx={bellIcon(mode)} />
          ) : (
            <Ring color={modeColor(mode)}>
              <Typography
                component="span"
                sx={{
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1,
                  color: modeColor(mode),
                }}
              >
                {unseen.size}
              </Typography>
            </Ring>
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
              No history to show.
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
              onShowOutput={() => setOutputOf(op)}
            />
          ))
        )}
      </Menu>

      {/* THE HYPERVISOR'S OWN WORDS. A dialog rather than a page, which
          the modal rule allows: its reasoning is that a form in a modal
          cannot be linked to or survive a reload, and an operation is
          in-memory and cannot either. Proxmox calls its equivalent a
          task viewer, and this is the same thing without the second
          browser tab. */}
      <Dialog
        open={Boolean(outputOf)}
        onClose={() => setOutputOf(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 16, pb: 1 }}>
          {outputOf?.title}
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {outputOf?.error || outputOf?.warning || 'Output'}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              bgcolor: 'surface.subtle',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              // The lines are the hypervisor's, wrapped rather than cut:
              // the useful part of a warning is often the end of it.
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: 420,
              overflowY: 'auto',
            }}
          >
            {outputOf?.output?.join('\n')}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  )
}

function OperationRow({
  operation,
  onDismiss,
  onOpen,
  onShowOutput,
}: {
  operation: Operation
  onDismiss: () => void
  onOpen: () => void
  onShowOutput: () => void
}) {
  const running = operation.status === 'RUNNING'
  const failed = operation.status === 'ERROR'
  // A WARNING IS NOT A FIRE. Proxmox ends a task with OK, with
  // "WARNINGS: N", or with a reason it failed — and the middle one is
  // work that HAPPENED. Painting it red taught you to distrust the
  // colour, which costs you the time it is red for a reason.
  const warned = operation.status === 'WARNING'
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
        ) : warned ? (
          <WarningAmberIcon sx={{ fontSize: 18, color: 'warning.main' }} />
        ) : (
          <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, color: 'text.primary' }}>{operation.title}</Typography>
        <Typography
          sx={{
            fontSize: 12,
            color: failed ? '#d93025' : warned ? '#b06000' : '#5f6368',
            overflowWrap: 'anywhere',
          }}
        >
          {operation.error ||
            operation.warning ||
            operation.step ||
            (running ? 'Starting…' : 'Finished')}
        </Typography>
        {/* WHAT IT SAID, not just that it said something. "WARNINGS: 1"
            sends you to the hypervisor's own task viewer to find out
            what the warning was, which is the console reporting nothing.
            The bell is too small for a task log, so it opens one. */}
        {operation.output && operation.output.length > 0 && (
          <Link
            component="button"
            underline="hover"
            sx={{ fontSize: 12, mt: 0.25, display: 'block' }}
            onClick={(e) => {
              e.stopPropagation()
              onShowOutput()
            }}
          >
            View output
          </Link>
        )}
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

type BellMode = 'idle' | 'busy' | 'done' | 'warned' | 'failed'

/**
 * A circle drawn around whatever the bell is currently saying — turning
 * while work is in flight, closed and still once it has landed. It is
 * the same 30px either way, so the toolbar doesn't shift as operations
 * come and go.
 */
function Ring({
  color,
  spinning,
  children,
}: {
  color: string
  spinning?: boolean
  children: ReactNode
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 30,
        height: 30,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <CircularProgress
        variant={spinning ? 'indeterminate' : 'determinate'}
        value={100}
        size={30}
        thickness={2.4}
        // Without this the arc shrinks to a dash twice a turn, and a
        // signal that keeps vanishing is the problem the shake had.
        disableShrink
        sx={{ position: 'absolute', color }}
      />
      {children}
    </Box>
  )
}

/** The one place the state's colour is decided, so the ring, the count
 *  and the icon can't disagree about it. */
function modeColor(mode: BellMode): string {
  if (mode === 'failed') return '#d93025'
  if (mode === 'warned') return '#b06000'
  return '#1e8e3e'
}

function bellIcon(mode: BellMode) {
  return {
    fontSize: 22,
    color:
      mode === 'busy'
        ? '#1a73e8'
        : mode === 'failed'
          ? '#d93025'
          : mode === 'warned'
            ? '#b06000'
            : '#5f6368',
  }
}

function label(mode: BellMode, running: number, unseen: number): string {
  switch (mode) {
    case 'busy':
      return `${running} operation${running === 1 ? '' : 's'} in progress`
    case 'warned':
      return `${unseen} finished with warnings`
    case 'failed':
      return `${unseen} finished, one of them badly`
    case 'done':
      return `${unseen} finished`
    default:
      return 'Notifications'
  }
}
