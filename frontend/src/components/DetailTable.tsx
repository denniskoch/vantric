import type { ReactNode } from 'react'
import { Box, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material'

export interface DetailRow {
  label: string
  value: ReactNode
}

/** A titled block of the detail view, GCP-style. */
export function DetailSection({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <Typography sx={{ fontSize: 16, color: '#202124' }}>{title}</Typography>
        {action}
      </Box>
      {children}
    </Box>
  )
}

/** Zebra-striped label/value table used throughout the detail view. */
export default function DetailTable({ rows }: { rows: DetailRow[] }) {
  return (
    <Table
      size="small"
      sx={{
        border: '1px solid #e8eaed',
        '& tr:nth-of-type(odd)': { bgcolor: '#f8f9fa' },
        '& td': { border: 0, py: 0.75 },
      }}
    >
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={`${row.label}-${i}`}>
            <TableCell sx={{ color: '#5f6368', width: 280, verticalAlign: 'top' }}>
              {row.label}
            </TableCell>
            <TableCell sx={{ color: '#202124' }}>{row.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
