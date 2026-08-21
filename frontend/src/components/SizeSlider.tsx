import { Box, Slider, TextField, Typography } from '@mui/material'

/**
 * Picking a number that has a sensible range and an occasional exception
 * — vCPUs and memory, everywhere they're chosen.
 *
 * The slider is for the answer you almost always want, and the box next
 * to it is why the slider can stay coarse: memory steps in gigabytes
 * because that is how people size a machine, and the 1.5 GB somebody
 * genuinely needs is still typeable. Neither control is the master —
 * they edit the same value, so dragging updates the box and typing moves
 * the handle.
 *
 * The BOX IS NOT CLAMPED to the slider's range, deliberately. A slider
 * has to end somewhere and a lab occasionally wants more than the number
 * we guessed; a form that silently rewrites what you typed is worse than
 * one whose handle sits at the far end. Validation stays where it always
 * was — the caller's `error` and `helperText`.
 */
export default function SizeSlider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  caption,
  formatBound = String,
  error,
  helperText,
  disabled,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  /** Shown inside the box: "vCPU", "MB". */
  unit: string
  /** A second reading of the same value, e.g. "8 GB" under 8192 MB. */
  caption?: string
  /**
   * How the numbers at either end of the track are written. Memory
   * passes gigabytes: "1024" and "65536" are the units the API wants and
   * not the ones anybody reads a range in.
   */
  formatBound?: (value: number) => string
  error?: boolean
  helperText?: string
  disabled?: boolean
}) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography sx={{ fontSize: 13, color: 'text.primary', mb: 0.5 }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
            {formatBound(min)}
          </Typography>
          <Slider
            size="small"
            // Clamped for the HANDLE only: a typed value beyond the range
            // leaves it parked at the end rather than dragging the number
            // back down to something nobody asked for.
            value={Math.min(Math.max(value, min), max)}
            onChange={(_, next) => onChange(next as number)}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            aria-label={label}
            sx={{ flex: 1 }}
          />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
            {formatBound(max)}
          </Typography>
        </Box>
        <TextField
          size="small"
          type="number"
          value={value || ''}
          onChange={(e) => onChange(Number(e.target.value))}
          error={error}
          helperText={helperText || caption || ' '}
          disabled={disabled}
          slotProps={{
            htmlInput: { min, step, 'aria-label': `${label} value` },
            input: {
              endAdornment: (
                <Typography sx={{ fontSize: 12, color: 'text.secondary', ml: 1 }}>
                  {unit}
                </Typography>
              ),
            },
          }}
          sx={{ width: 150, flexShrink: 0 }}
        />
      </Box>
    </Box>
  )
}

/**
 * The ranges every sizing control here uses, so four forms can't drift
 * apart on what a reasonable machine looks like.
 *
 * Memory steps in whole gigabytes because that is how anybody sizes a
 * guest, while the UNIT STAYS MB — the API takes MB, and the instance
 * list, the detail page and the container pages all report MB, so
 * switching to GB here would make this the one screen that disagrees.
 */
export const cpuSlider = { min: 1, max: 32, step: 1, unit: 'vCPU' } as const
export const memorySlider = {
  min: 1024,
  max: 65536,
  step: 1024,
  unit: 'MB',
  // The ends of the track read in gigabytes while the box stays in MB.
  // The unit is spelled out on them precisely BECAUSE the two disagree:
  // a bare "64" beside a box labelled MB invites exactly one wrong
  // reading, and it is a factor of a thousand out.
  formatBound: (mb: number) => `${mb / 1024} GB`,
} as const
