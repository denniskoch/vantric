import { useState } from 'react'
import { Box, Button, Menu, TextField, Typography } from '@mui/material'

/**
 * Building a prune-backups policy without remembering its spelling.
 *
 * THE RULES ARE PROXMOX'S AND SO ARE THE NAMES. keep-daily=14 means
 * "keep the newest backup of each of the last 14 days", not "keep 14
 * daily backups", and the two differ the moment a run is missed — so
 * the summary below says which it is rather than paraphrasing the
 * numbers into something friendlier and wrong.
 */

const rules = [
  { key: 'keep-last', label: 'Last', says: (n: number) => `the newest ${n}` },
  { key: 'keep-hourly', label: 'Hourly', says: (n: number) => `one per hour for ${n} hours` },
  { key: 'keep-daily', label: 'Daily', says: (n: number) => `one per day for ${n} days` },
  { key: 'keep-weekly', label: 'Weekly', says: (n: number) => `one per week for ${n} weeks` },
  { key: 'keep-monthly', label: 'Monthly', says: (n: number) => `one per month for ${n} months` },
  { key: 'keep-yearly', label: 'Yearly', says: (n: number) => `one per year for ${n} years` },
]

export default function RetentionBuilder({
  value,
  onPick,
}: {
  value: string
  onPick: (retention: string) => void
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const [counts, setCounts] = useState<Record<string, string>>(() => parse(value))

  const expression = rules
    .filter((r) => Number(counts[r.key]) > 0)
    .map((r) => `${r.key}=${Number(counts[r.key])}`)
    .join(',')

  const summary = rules
    .filter((r) => Number(counts[r.key]) > 0)
    .map((r) => r.says(Number(counts[r.key])))

  return (
    <>
      <Button
        size="small"
        onClick={(e) => {
          // Read the field again on open: it is free text and may have
          // been edited since this was last used.
          setCounts(parse(value))
          setAnchor(e.currentTarget)
        }}
      >
        Build
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 380, p: 2 } } }}
      >
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            Blank keeps none of that kind.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            {rules.map((r) => (
              <TextField
                key={r.key}
                label={r.label}
                size="small"
                value={counts[r.key] ?? ''}
                onChange={(e) =>
                  setCounts((c) => ({ ...c, [r.key]: e.target.value.replace(/\D/g, '') }))
                }
              />
            ))}
          </Box>

          <Box
            sx={{
              bgcolor: 'surface.subtle',
              px: 1.5,
              py: 1,
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: 13,
              overflowWrap: 'anywhere',
            }}
          >
            {expression || 'nothing pruned — every archive is kept'}
          </Box>
          {summary.length > 0 && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Keeps {summary.join(', ')}.
            </Typography>
          )}

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="contained"
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

/** Read an existing policy back into the boxes, so opening the builder
 *  on a job that has one starts from what it has. */
function parse(value: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of value.split(',')) {
    const [key, count] = part.split('=').map((x) => x.trim())
    if (key && count) out[key] = count
  }
  return out
}
