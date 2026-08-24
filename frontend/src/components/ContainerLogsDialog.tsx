import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
} from '@mui/material'
import SelectField from './SelectField'
import { api } from '../api/client'
import type { DockerContainer } from '../api/client'

/**
 * A container's recent output.
 *
 * A DIALOG, WHICH THE HOUSE RULE ALLOWS: the rule is that anything you
 * FILL IN gets its own page, and this fills in nothing — it is a look
 * at something, closed as soon as you have looked.
 *
 * READ ON DEMAND, NEVER POLLED. It is somebody else's ring buffer and
 * the tail of a chatty container is megabytes; opening this is the only
 * thing that fetches it.
 */
export default function ContainerLogsDialog({
  container,
  onClose,
}: {
  container: DockerContainer | null
  onClose: () => void
}) {
  const [lines, setLines] = useState('200')

  const { data, isFetching, error } = useQuery({
    queryKey: ['dockerLogs', container?.hostId, container?.id, lines],
    queryFn: () => api.dockerContainerLogs(container!.hostId, container!.id, Number(lines)),
    enabled: Boolean(container),
  })

  return (
    <Dialog open={Boolean(container)} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 2 }}>
        {container?.name}
        <Box sx={{ flex: 1 }} />
        <SelectField
          size="small"
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          sx={{ width: 130 }}
        >
          <MenuItem value="100">Last 100</MenuItem>
          <MenuItem value="200">Last 200</MenuItem>
          <MenuItem value="1000">Last 1000</MenuItem>
        </SelectField>
      </DialogTitle>
      <DialogContent>
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1.5,
            bgcolor: '#202124',
            color: '#e8eaed',
            borderRadius: '4px',
            fontSize: 12,
            lineHeight: 1.5,
            overflow: 'auto',
            maxHeight: '60vh',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {error
            ? (error as Error).message
            : isFetching && !data
              ? 'Loading…'
              : data?.logs?.trim() || 'This container has written nothing.'}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
