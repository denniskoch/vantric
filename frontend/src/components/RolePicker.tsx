import { useMemo, useRef, useState } from 'react'
import {
  Box,
  InputAdornment,
  Popover,
  Tooltip,
  TextField,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import type { Role } from '../api/client'
import { sections } from './nav'

/**
 * Choosing one role out of forty-one.
 *
 * A FLAT DROPDOWN IS A WALL. The list is every section times every
 * tier, and a menu that scrolls past forty items makes you read all of
 * them to find the one you want — the same complaint the guests-not-in-
 * backup chips answered. So it is two panes, GCP's shape: the service
 * on the left, its roles on the right, and a search across both for
 * when you already know the word.
 *
 * A POPOVER, NOT A MODAL. The rule here is that a form which creates a
 * resource gets a page; this is a picker on one field, which is what
 * TimeRangePicker and the schedule builder already are.
 *
 * A ROW IS ONE LINE. It carried the role string under its label —
 * "Editor" over "editor" — which says the same thing twice and doubled
 * the height of a list whose whole problem was length. The name is in
 * the list to browse and in the search box to type, so nothing is lost
 * by dropping it.
 *
 * THE DESCRIPTION IS A TOOLTIP, the way GCP's is: it is the answer to
 * "what does this one do", asked about one row at a time, and putting
 * it on every row at once is the wall again. It still sits under the
 * field once something is chosen, where it answers "what did I just
 * grant".
 */
export default function RolePicker({
  value,
  roles,
  disabledRoles = [],
  onChange,
}: {
  value: string
  roles: Role[]
  /** Already on another row — shown, but not selectable twice. */
  disabledRoles?: string[]
  onChange: (role: string) => void
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('basic')

  const sectionLabel = (id: string) =>
    sections.find((s) => s.id === id)?.label ?? id

  // Groups down the left: the basic three first, because they are what
  // most accounts get, then every section that has roles.
  const groups = useMemo(() => {
    const ids = [...new Set(roles.map((r) => r.section))]
    return [
      { id: 'basic', label: 'Basic' },
      ...ids.filter(Boolean).map((id) => ({ id, label: sectionLabel(id) })),
    ]
  }, [roles])

  // SEARCHING FLATTENS THE PANES, which is what GCP does and the right
  // answer: once you have typed "admin" the question is no longer which
  // section you are in.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) {
      return roles.filter(
        (r) =>
          r.label.toLowerCase().includes(q) ||
          r.role.toLowerCase().includes(q) ||
          r.help.toLowerCase().includes(q),
      )
    }
    return roles.filter((r) => (group === 'basic' ? !r.section : r.section === group))
  }, [roles, query, group])

  const selected = roles.find((r) => r.role === value)

  const choose = (role: string) => {
    onChange(role)
    setOpen(false)
    setQuery('')
  }

  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Box
        ref={anchorRef}
        onClick={() => setOpen(true)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          minHeight: 40,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          cursor: 'pointer',
          bgcolor: 'background.paper',
          '&:hover': { borderColor: 'text.primary' },
        }}
      >
        <Typography
          sx={{ flex: 1, fontSize: 14, color: selected ? 'text.primary' : 'text.secondary' }}
        >
          {selected?.label ?? 'Select a role'}
        </Typography>
        <ArrowDropDownIcon sx={{ color: 'text.secondary' }} />
      </Box>
      {selected?.help && (
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5, ml: 1.5 }}>
          {selected.help}
        </Typography>
      )}

      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => {
          setOpen(false)
          setQuery('')
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 620, maxWidth: '90vw' } } }}
      >
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'surface.subtle' }}>
          <TextField
            autoFocus
            size="small"
            fullWidth
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Section or role"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', height: 320 }}>
          {/* The left pane goes away while searching: it would be
              filtering a list the results no longer come from. */}
          {!query.trim() && (
            <Box
              sx={{
                width: 200,
                overflowY: 'auto',
                borderRight: 1,
                borderColor: 'divider',
              }}
            >
              {groups.map((g) => (
                <Box
                  key={g.id}
                  onClick={() => setGroup(g.id)}
                  sx={{
                    px: 2,
                    py: 0.5,
                    minHeight: 28,
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 14,
                    cursor: 'pointer',
                    bgcolor: group === g.id ? 'action.selected' : undefined,
                    '&:hover': { bgcolor: 'surface.subtle' },
                  }}
                >
                  {g.label}
                </Box>
              ))}
            </Box>
          )}

          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            {shown.length === 0 && (
              <Typography sx={{ p: 2, fontSize: 13, color: 'text.secondary' }}>
                No role matches “{query}”.
              </Typography>
            )}
            {shown.map((r) => {
              const taken = disabledRoles.includes(r.role) && r.role !== value
              return (
                <Tooltip
                  key={r.role}
                  title={r.help}
                  placement="right"
                  enterDelay={400}
                  slotProps={{ tooltip: { sx: { maxWidth: 260, fontSize: 12 } } }}
                >
                  <Box
                    onClick={() => !taken && choose(r.role)}
                    sx={{
                      px: 2,
                      py: 0.5,
                      minHeight: 28,
                      display: 'flex',
                      alignItems: 'center',
                      fontSize: 14,
                      cursor: taken ? 'default' : 'pointer',
                      color: taken ? 'text.disabled' : 'text.primary',
                      bgcolor: r.role === value ? 'action.selected' : undefined,
                      '&:hover': { bgcolor: taken ? undefined : 'surface.subtle' },
                    }}
                  >
                    {r.label}
                    {taken && (
                      <Box component="span" sx={{ color: 'text.disabled', ml: 1 }}>
                        · added
                      </Box>
                    )}
                  </Box>
                </Tooltip>
              )
            })}
          </Box>
        </Box>
      </Popover>
    </Box>
  )
}
