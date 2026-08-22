import type { ReactNode } from 'react'
import { Box } from '@mui/material'

/**
 * One line per item inside a table cell, so two columns of stacked
 * values stay in step with each other.
 *
 * Deliberately no gap: these are lines of a list, not separate blocks,
 * and spacing them apart makes a row holding three keys look like
 * three rows. Pair it with DataTable's `alignTop`, or line one of one
 * column sits against line two of the next.
 */
export default function CellLines({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', flexDirection: 'column' }}>{children}</Box>
}
