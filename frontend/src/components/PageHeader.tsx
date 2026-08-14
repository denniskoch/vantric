import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

/**
 * The top of every list page: title, the actions that belong to it,
 * and an optional line saying what you're looking at.
 *
 * It exists so the spacing is the same everywhere. Written by hand,
 * a page with buttons beside its title sits a few pixels lower than
 * one without, and a page with a description leaves a different gap
 * above its table — small enough to look like carelessness rather
 * than a bug, and visible the moment you move between sections.
 *
 * The title row has a fixed height for exactly that reason: buttons
 * are taller than the text they sit next to, and without it they
 * would push the title down on some pages and not others.
 */
export default function PageHeader({
  title,
  actions,
  description,
}: {
  title: string
  /** Buttons for the page as a whole — Create, Refresh, and the like. */
  actions?: ReactNode
  description?: ReactNode
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 34 }}>
        <Typography variant="h5">{title}</Typography>
        {actions}
      </Box>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 900 }}>
          {description}
        </Typography>
      )}
    </Box>
  )
}
