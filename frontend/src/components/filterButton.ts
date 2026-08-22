import type { SxProps, Theme } from '@mui/material'

/**
 * How a filter control looks: the console's own text and hairline,
 * not the primary blue an outlined button defaults to.
 *
 * Blue is what this theme uses for the thing you came to do — Create,
 * a link, a running operation. A filter is furniture: it should read
 * at the same weight as the table it sits above, and four blue buttons
 * in a row draw the eye to the controls instead of the data.
 *
 * Shared so the range picker and the selects beside it can't drift
 * apart, since the whole point is that the row reads as one row.
 */
export const filterButton: SxProps<Theme> = {
  textTransform: 'none',
  color: 'text.primary',
  borderColor: 'divider',
  fontWeight: 400,
  '& .MuiButton-endIcon': { color: 'text.secondary' },
  '&:hover': {
    borderColor: 'text.disabled',
    backgroundColor: 'surface.subtle',
  },
}
