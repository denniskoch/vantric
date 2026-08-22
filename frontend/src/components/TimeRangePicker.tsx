import { useState } from 'react'
import {
  Box,
  Button,
  Divider,
  ListItemText,
  Menu,
  MenuItem,
  MenuList,
  TextField,
  Typography,
} from '@mui/material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DateRangeIcon from '@mui/icons-material/DateRange'
import SelectField from './SelectField'
import { filterButton } from './filterButton'
import {
  ANY_TIME,
  aroundRange,
  dayRange,
  lastRange,
  parseRelative,
  presets,
  toLocalInput,
} from '../timeRange'
import type { TimeRange } from '../timeRange'

/**
 * The window a page is looking at, picked the way a log console lets
 * you pick one: a list of the usual answers, the shorthand for the
 * unusual ones, and two panels for the cases a list can't cover.
 *
 * ONE COMPONENT because every page that reads the gateway wants the
 * same vocabulary, and three pages each inventing "last 24 hours"
 * would eventually disagree about whether a day is 24 hours or since
 * midnight.
 *
 * No timezone control: this console renders in the browser's zone and
 * a lab is in one place. GCP offers it because its logs are global.
 */
export default function TimeRangePicker({
  value,
  onChange,
}: {
  value: TimeRange
  onChange: (range: TimeRange) => void
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const [view, setView] = useState<'presets' | 'absolute' | 'around'>('presets')
  const [relative, setRelative] = useState('')

  const close = () => {
    setAnchor(null)
    setView('presets')
    setRelative('')
  }
  const pick = (range: TimeRange) => {
    onChange(range)
    close()
  }

  const relativeRange = relative ? parseRelative(relative) : null

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<AccessTimeIcon sx={{ fontSize: 16 }} />}
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={filterButton}
      >
        {value.label}
      </Button>

      {/* THE PANELS OPEN BESIDE THE LIST, NOT OVER IT. Swapping the
          menu's contents made changing your mind cost two clicks —
          cancel out of the panel, then pick the preset you actually
          wanted. Side by side, the list never leaves, so it stays one.
          The paper widens only while a panel is open. */}
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{
          paper: { sx: { width: view === 'presets' ? 340 : 680, maxWidth: '95vw' } },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
        <Box sx={{ width: 340, flexShrink: 0 }}>
        {[
          <Box key="relative" sx={{ px: 1.5, pt: 0.5, pb: 1 }}>
            <TextField
              size="small"
              fullWidth
              autoFocus
              placeholder="Relative time (15m, 1h, 1d, 1w)"
              value={relative}
              onChange={(e) => setRelative(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && relativeRange) pick(relativeRange)
                // The menu treats typing as a jump-to-item search, which
                // eats the keystrokes this field is for.
                e.stopPropagation()
              }}
              error={Boolean(relative) && !relativeRange}
              helperText={
                relative && !relativeRange ? 'A number and one of s, m, h, d, w' : ' '
              }
            />
          </Box>,
          <MenuItem key="any" onClick={() => pick(ANY_TIME)}>
            <ListItemText primary="Any time" />
          </MenuItem>,
          <MenuItem key="today" onClick={() => pick(dayRange(0))}>
            <ListItemText primary="Today" />
          </MenuItem>,
          <MenuItem key="yesterday" onClick={() => pick(dayRange(1))}>
            <ListItemText primary="Yesterday" />
          </MenuItem>,
          <Divider key="d1" />,
          ...presets.map((p) => (
            <MenuItem key={p.label} onClick={() => pick(lastRange(p.label, p.seconds))}>
              <ListItemText primary={p.label} />
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {shorthand(p.seconds)}
              </Typography>
            </MenuItem>
          )),
          <Divider key="d2" />,
          <MenuItem
            key="absolute"
            selected={view === 'absolute'}
            onClick={() => setView(view === 'absolute' ? 'presets' : 'absolute')}
          >
            <DateRangeIcon sx={{ fontSize: 18, mr: 1.5, color: 'text.secondary' }} />
            <ListItemText primary="Start and end times" />
            <ChevronRightIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          </MenuItem>,
          <MenuItem
            key="around"
            selected={view === 'around'}
            onClick={() => setView(view === 'around' ? 'presets' : 'around')}
          >
            <AccessTimeIcon sx={{ fontSize: 18, mr: 1.5, color: 'text.secondary' }} />
            <ListItemText primary="Around a time" />
            <ChevronRightIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          </MenuItem>,
        ]}
        </Box>

        {view !== 'presets' && (
          <>
            <Divider orientation="vertical" flexItem />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {view === 'absolute' && (
                <Absolute onApply={pick} onCancel={() => setView('presets')} />
              )}
              {view === 'around' && <Around onApply={pick} onCancel={() => setView('presets')} />}
            </Box>
          </>
        )}
        </Box>
      </Menu>
    </>
  )
}

/** Two moments. The end may be left off, which means "and everything
 *  since" rather than an error. */
function Absolute({
  onApply,
  onCancel,
}: {
  onApply: (range: TimeRange) => void
  onCancel: () => void
}) {
  const [from, setFrom] = useState(toLocalInput(new Date(Date.now() - 24 * 3600_000)))
  const [to, setTo] = useState('')
  const start = from ? new Date(from) : null
  const end = to ? new Date(to) : null
  const backwards = Boolean(start && end && end <= start)

  return (
    <MenuList onKeyDown={(e) => e.stopPropagation()} sx={{ px: 2, py: 1, outline: 'none' }}>
      <Typography sx={{ fontSize: 14, mb: 1.5 }}>Start and end times</Typography>
      <TextField
        label="Start"
        type="datetime-local"
        size="small"
        fullWidth
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label="End"
        type="datetime-local"
        size="small"
        fullWidth
        sx={{ mt: 2 }}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        error={backwards}
        helperText={backwards ? 'The end is before the start' : 'Leave blank for “and since”'}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <Actions
        disabled={!start || backwards}
        onCancel={onCancel}
        onApply={() =>
          start &&
          onApply({
            label: end
              ? `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`
              : `Since ${start.toLocaleDateString()}`,
            since: start.toISOString(),
            until: end?.toISOString(),
          })
        }
      />
    </MenuList>
  )
}

/** A moment and a radius, for when you know when it happened. */
function Around({
  onApply,
  onCancel,
}: {
  onApply: (range: TimeRange) => void
  onCancel: () => void
}) {
  const [at, setAt] = useState(toLocalInput(new Date()))
  const [value, setValue] = useState('30')
  const [unit, setUnit] = useState('60')
  const moment = at ? new Date(at) : null
  const amount = Number(value)
  const valid = Boolean(moment) && amount > 0

  return (
    <MenuList onKeyDown={(e) => e.stopPropagation()} sx={{ px: 2, py: 1, outline: 'none' }}>
      <Typography sx={{ fontSize: 14, mb: 1.5 }}>Around a time</Typography>
      <TextField
        label="Time"
        type="datetime-local"
        size="small"
        fullWidth
        value={at}
        onChange={(e) => setAt(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
        <TextField
          label="Either side"
          size="small"
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={Boolean(value) && amount <= 0}
          sx={{ width: 110 }}
        />
        <SelectField
          label="Unit"
          size="small"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          sx={{ flex: 1 }}
        >
          <MenuItem value="60">Minutes</MenuItem>
          <MenuItem value="3600">Hours</MenuItem>
          <MenuItem value="86400">Days</MenuItem>
        </SelectField>
      </Box>
      <Actions
        disabled={!valid}
        onCancel={onCancel}
        onApply={() => moment && onApply(aroundRange(moment, amount, Number(unit)))}
      />
    </MenuList>
  )
}

function Actions({
  disabled,
  onCancel,
  onApply,
}: {
  disabled: boolean
  onCancel: () => void
  onApply: () => void
}) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
      <Button size="small" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="small" variant="contained" disabled={disabled} onClick={onApply}>
        Apply
      </Button>
    </Box>
  )
}

/** The shorthand beside a preset, so the text field's syntax teaches
 *  itself rather than needing explaining. */
function shorthand(seconds: number): string {
  if (seconds % (7 * 24 * 3600) === 0) return `${seconds / (7 * 24 * 3600)}w`
  if (seconds % (24 * 3600) === 0) return `${seconds / (24 * 3600)}d`
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  return `${seconds / 60}m`
}
