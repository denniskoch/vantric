import { Box, LinearProgress } from '@mui/material'
import { formatBytes } from '../format'

/**
 * A used/total bar that turns amber then red as it fills.
 *
 * Shared rather than per-page: datastores, hosts and their root
 * filesystems all answer "how full", and three copies of the same bar
 * is three places for the thresholds to drift apart.
 */
export default function UsageBar({
  used,
  total,
  format = formatBytes,
  minWidth = 180,
  showValues = true,
}: {
  used: number
  total: number
  /** how the two numbers are spelled; bytes unless told otherwise */
  format?: (value: number) => string
  minWidth?: number
  /**
   * Whether to print the used/total pair beside the percentage. Off
   * for a RATE — CPU is already a percentage, and spelling it out as
   * "2.5% of 100%" invents an occupancy that doesn't exist.
   */
  showValues?: boolean
}) {
  if (!total) return <>—</>
  const pct = Math.min(100, (used / total) * 100)
  return (
    <Box sx={{ minWidth }}>
      {/* Label and bar together have to fit the standard row, so the
          line is tightened rather than letting this one page stand
          taller than every other table. */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          lineHeight: 1.2,
          mb: 0.25,
        }}
      >
        {showValues && (
          <span>
            {format(used)} / {format(total)}
          </span>
        )}
        <span style={{ color: 'text.secondary' }}>{pct.toFixed(0)}%</span>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 4,
          borderRadius: 2,
          bgcolor: 'surface.faint',
          '& .MuiLinearProgress-bar': {
            bgcolor: pct > 90 ? 'error.main' : pct > 75 ? 'warning.main' : 'primary.main',
          },
        }}
      />
    </Box>
  )
}
