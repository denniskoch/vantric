import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, IconButton, Menu, MenuItem, Paper, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import LoginIcon from '@mui/icons-material/Login'
import { api } from '../api/client'
import type { Shortcut } from '../api/client'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

/**
 * Somebody's own tiles, for the systems this console doesn't reach.
 *
 * THIS IS THE ONE SECTION THAT ADMITS THE PANE OF GLASS HAS EDGES. A
 * NAS's own UI, a SaaS account with no integration here yet, the vendor
 * portal you need twice a year — none of them are a view onto an API
 * this app speaks, and none of them are going to be. Without somewhere
 * to put them they live in a bookmarks bar the console can't see.
 *
 * PERSONAL, so it sits second, after the overview and before the
 * sections that describe the lab: what's wrong, then where you were
 * going, then everything else.
 */
export default function ShortcutsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<Shortcut | null>(null)
  const [deleting, setDeleting] = useState<Shortcut | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['shortcuts'], queryFn: api.listShortcuts })

  // The grid is held locally so a drag can rearrange it as the pointer
  // moves rather than after a round trip. The server's copy wins
  // whenever a drag isn't in flight.
  const [items, setItems] = useState<Shortcut[]>([])
  const dragging = useRef<string | null>(null)
  useEffect(() => {
    if (data && !dragging.current) setItems(data)
  }, [data])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['shortcuts'] })

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.reorderShortcuts(ids),
    onSuccess: invalidate,
    onError: (e: Error) => {
      setError(e.message)
      invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteShortcut(id),
    onSuccess: () => {
      setDeleting(null)
      invalidate()
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  // Dragging over a tile moves the held one into its place. Doing it on
  // dragover rather than on drop is what makes the grid reflow under
  // the pointer instead of jumping once at the end.
  const dragOver = (targetID: string) => {
    const held = dragging.current
    if (!held || held === targetID) return
    setItems((current) => {
      const from = current.findIndex((i) => i.id === held)
      const to = current.findIndex((i) => i.id === targetID)
      if (from < 0 || to < 0 || from === to) return current
      const next = current.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Shortcuts"
        actions={
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => navigate('/shortcuts/new')}
          >
            Add shortcut
          </Button>
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {isLoading ? 'Loading…' : 'No shortcuts yet.'}
          </Typography>
        </Paper>
      ) : (
        <Box
          onDragOver={(e) => e.preventDefault()}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 2,
          }}
        >
          {items.map((item) => (
            <Tile
              key={item.id}
              item={item}
              held={dragging.current === item.id}
              onDragStart={(e) => {
                dragging.current = item.id
                // Firefox starts no drag at all without something set.
                e.dataTransfer.setData('text/plain', item.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={() => dragOver(item.id)}
              onDragEnd={() => {
                dragging.current = null
                const ids = items.map((i) => i.id)
                // Nothing moved: don't write, and don't put a row in the
                // audit log for a click that changed the order to itself.
                if (data && ids.join() !== data.map((i) => i.id).join()) reorder.mutate(ids)
              }}
              onMenu={(e) => {
                setMenuAnchor(e.currentTarget)
                setSelected(item)
              }}
            />
          ))}
        </Box>
      )}

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (selected) navigate(`/shortcuts/${selected.id}/edit`)
            setMenuAnchor(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleting(selected)
            setMenuAnchor(null)
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name}?`}
        body="The tile is removed from your grid."
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Box>
  )
}

function Tile({
  item,
  held,
  onDragStart,
  onDragOver,
  onDragEnd,
  onMenu,
}: {
  item: Shortcut
  held: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: () => void
  onDragEnd: () => void
  onMenu: (e: React.MouseEvent<HTMLElement>) => void
}) {
  return (
    <Paper
      variant="outlined"
      component="a"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDragEnd={onDragEnd}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        height: 64,
        px: 1,
        textDecoration: 'none',
        color: 'inherit',
        cursor: 'pointer',
        // The tile being dragged stays in the grid so the gap it leaves
        // is the drop target, but reads as the one in the hand.
        opacity: held ? 0.35 : 1,
        '&:hover': { boxShadow: 1, borderColor: 'text.disabled' },
        '&:hover .shortcut-open': { opacity: 0 },
        '&:hover .shortcut-actions': { opacity: 1 },
      }}
    >
      <Icon item={item} />
      <Typography
        sx={{
          fontSize: 13,
          fontWeight: 500,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.name}
      </Typography>
      {/* The arrow and the menu share one slot, so hovering swaps them
          instead of shifting the name. */}
      <Box sx={{ position: 'relative', width: 24, height: 24, flexShrink: 0 }}>
        <Box
          className="shortcut-open"
          sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}
        >
          <LoginIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
        </Box>
        <IconButton
          className="shortcut-actions"
          size="small"
          aria-label={`Actions for ${item.name}`}
          // The tile is a link, so a click on anything inside it opens
          // the link unless it says otherwise.
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onMenu(e)
          }}
          // A button inside a draggable anchor drags the anchor; this
          // lets you reach the menu without starting one.
          draggable
          onDragStart={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          sx={{ position: 'absolute', inset: 0, opacity: 0, transition: 'opacity .1s' }}
        >
          <MoreVertIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Paper>
  )
}

/**
 * The uploaded icon, or a monogram where there isn't one.
 *
 * NOTHING IS FETCHED FROM THE SITE ITSELF. Reading a favicon would mean
 * this console making requests to wherever a tile points, which is a
 * different thing from the backends it is configured to talk to — so a
 * tile with no icon draws its own, and the colour is a hash of the name
 * rather than a choice anybody has to make.
 */
function Icon({ item }: { item: Shortcut }) {
  // A LOGO ARRIVES WITH ITS OWN MARGIN. A wordmark PNG is mostly
  // whitespace at the edges, so the tile's padding was being paid
  // twice — the mark gets the space back rather than the border.
  const size = 44
  if (item.icon) {
    return (
      <Box
        component="img"
        // The name is stable while the bytes are not, so a replaced
        // icon needs something to make the URL new.
        src={`/api/v1/shortcuts/${item.id}/icon?v=${encodeURIComponent(item.updatedAt)}`}
        alt=""
        sx={{ width: size, height: size, objectFit: 'contain', borderRadius: '4px', flexShrink: 0 }}
      />
    )
  }
  const hue = hashHue(item.name)
  return (
    <Box
      sx={{
        // Optically matched to a logo rather than measured to one: an
        // uploaded mark carries its own margin, so a tint block filling
        // the whole slot reads as the biggest thing in the grid.
        width: size - 8,
        height: size - 8,
        mx: '4px',
        borderRadius: '4px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 19,
        fontWeight: 500,
        bgcolor: `hsl(${hue} 42% 91%)`,
        color: `hsl(${hue} 38% 32%)`,
      }}
    >
      {monogram(item.name)}
    </Box>
  )
}

function monogram(name: string): string {
  const letter = [...name.trim()].find((c) => /\S/.test(c))
  return letter ? letter.toUpperCase() : '?'
}

/** Deterministic, so a tile keeps its colour across reloads. */
function hashHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360
  return hash
}
