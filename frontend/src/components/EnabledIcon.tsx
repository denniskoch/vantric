import { Tooltip } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'

/**
 * On or off, as a mark rather than a word.
 *
 * Shared by the gateway's upstream keys and its virtual keys because
 * they mean the same thing — the gateway will use this, or it won't —
 * and two pages drawing it separately were free to disagree about what
 * off looks like.
 *
 * A green check is a POSITIVE statement, not the absence of a warning:
 * a badge that appears only on the unusual case leaves the ordinary
 * case saying nothing.
 */
export default function EnabledIcon({
  enabled,
  on,
  off,
}: {
  enabled: boolean
  /** What being on means here, for the tooltip. */
  on: string
  off: string
}) {
  return (
    <Tooltip title={enabled ? on : off}>
      <span style={{ display: 'inline-flex' }}>
        {enabled ? (
          <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main', display: 'block' }} />
        ) : (
          <CancelIcon sx={{ fontSize: 16, color: 'error.main', display: 'block' }} />
        )}
      </span>
    </Tooltip>
  )
}
