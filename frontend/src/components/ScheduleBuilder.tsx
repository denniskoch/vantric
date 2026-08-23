import { useState } from 'react'
import {
  Box,
  Button,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import SelectField from './SelectField'

/**
 * Building a systemd calendar event without knowing it is one.
 *
 * THE FIELD STAYS FREE TEXT AND THIS ONLY WRITES INTO IT. Proxmox
 * accepts far more than four shapes — "mon..fri 8..17,22:0/15" is a
 * real answer to a real question — and a builder that replaced the
 * field would make the console the limit. So this covers the cases
 * anybody actually schedules a backup for, and anything else is still
 * typed.
 *
 * A POPOVER, NOT A DIALOG. The modal rule here is about forms that
 * create a resource; this is a picker on one field, the same shape
 * TimeRangePicker already uses.
 */

const days = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'S' },
]

type Frequency = 'daily' | 'weekdays' | 'days' | 'hours'

export default function ScheduleBuilder({ onPick }: { onPick: (schedule: string) => void }) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [time, setTime] = useState('21:00')
  const [picked, setPicked] = useState<string[]>(['sat'])
  const [every, setEvery] = useState('4')

  const expression = build(frequency, time, picked, every)

  return (
    <>
      <Button size="small" onClick={(e) => setAnchor(e.currentTarget)}>
        Build
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 380, p: 2 } } }}
      >
        <Box sx={{ display: 'grid', gap: 2 }}>
          <SelectField
            label="How often"
            size="small"
            fullWidth
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
          >
            <MenuItem value="daily">Every day</MenuItem>
            <MenuItem value="weekdays">Weekdays</MenuItem>
            <MenuItem value="days">Certain days</MenuItem>
            <MenuItem value="hours">Every few hours</MenuItem>
          </SelectField>

          {frequency === 'days' && (
            <Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
                Days
              </Typography>
              <ToggleButtonGroup
                size="small"
                value={picked}
                onChange={(_, next: string[]) => setPicked(next)}
              >
                {days.map((d) => (
                  <ToggleButton key={d.key} value={d.key} sx={{ px: 1.25, py: 0.25 }}>
                    {d.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          )}

          {frequency === 'hours' ? (
            <TextField
              label="Hours apart"
              size="small"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
          ) : (
            <TextField
              label="At"
              type="time"
              size="small"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}

          {/* The expression itself, because the point is not to hide it
              — the field is free text and somebody will want to tweak
              what this produced. */}
          <Box
            sx={{
              bgcolor: 'surface.subtle',
              px: 1.5,
              py: 1,
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: 13,
            }}
          >
            {expression || '—'}
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="contained"
              disabled={!expression}
              onClick={() => {
                onPick(expression)
                setAnchor(null)
              }}
            >
              Use this
            </Button>
            <Button size="small" onClick={() => setAnchor(null)}>
              Cancel
            </Button>
          </Box>
        </Box>
      </Menu>
    </>
  )
}

/**
 * The four shapes, in Proxmox's own grammar.
 *
 * "mon..fri" is a RANGE and "mon,wed" is a LIST, which is the one bit
 * of the syntax worth getting right here — a range written as a list
 * works, but reads as though somebody didn't know.
 */
function build(frequency: Frequency, time: string, picked: string[], every: string): string {
  switch (frequency) {
    case 'daily':
      return time
    case 'weekdays':
      return `mon..fri ${time}`
    case 'days': {
      // Kept in week order rather than click order, so Saturday and
      // Sunday don't come out ahead of Monday.
      const ordered = days.filter((d) => picked.includes(d.key)).map((d) => d.key)
      return ordered.length > 0 ? `${ordered.join(',')} ${time}` : ''
    }
    case 'hours': {
      const n = Number(every)
      if (!Number.isInteger(n) || n < 1 || n > 23) return ''
      return `*/${n}:00`
    }
  }
}
