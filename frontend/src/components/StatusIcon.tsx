import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import StopCircleIcon from '@mui/icons-material/StopCircle'
import { CircularProgress, Tooltip } from '@mui/material'
import type { InstanceStatus } from '../api/client'

// GCP-style status glyphs: green check when running, gray stop when
// terminated, spinner during transitions.
export default function StatusIcon({ status }: { status: InstanceStatus }) {
  let icon
  switch (status) {
    case 'RUNNING':
      icon = <CheckCircleIcon sx={{ color: 'success.main', fontSize: 18 }} />
      break
    case 'TERMINATED':
      icon = <StopCircleIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
      break
    default:
      icon = <CircularProgress size={14} thickness={5} />
  }
  return (
    <Tooltip title={status}>
      <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>{icon}</span>
    </Tooltip>
  )
}
