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
/**
 * One height for everything in a filter row.
 *
 * A small outlined button is 29px and a small outlined text field is
 * 38, so a row of them steps up and down by nine pixels for no reason
 * anybody can see. This is the middle: the buttons grow a little, the
 * field loses some of the padding it reserves for a floating label it
 * no longer has, and they share a font size so the values read at one
 * weight.
 */
export const filterHeight = 33

export const filterButton: SxProps<Theme> = {
  textTransform: 'none',
  color: 'text.primary',
  borderColor: 'divider',
  fontWeight: 400,
  fontSize: 13,
  minHeight: filterHeight,
  py: 0,
  '& .MuiButton-endIcon': { color: 'text.secondary' },
  '&:hover': {
    borderColor: 'text.disabled',
    backgroundColor: 'surface.subtle',
  },
}

/** The search box beside them, brought to the same height. */
export const filterField: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    height: filterHeight,
    fontSize: 13,
    paddingLeft: 1.25,
  },
  '& .MuiOutlinedInput-input': { padding: 0 },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
}
