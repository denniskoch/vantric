import { createTheme } from '@mui/material/styles'

/**
 * Surfaces the standard palette has no name for: the tints GCP uses
 * behind rows, chips and alert strips.
 *
 * They live under `palette` rather than beside it so `sx` resolves
 * them the same way it resolves `text.secondary` — a token you can
 * only reach through `useTheme` is a token people will keep typing
 * the hex for instead.
 */
declare module '@mui/material/styles' {
  interface Palette {
    surface: SurfacePalette
  }
  interface PaletteOptions {
    surface?: SurfacePalette
  }
}

interface SurfacePalette {
  /** Row hover, and the canvas behind an empty shell. */
  subtle: string
  /** Chip and search-field fill. */
  muted: string
  /** Hairlines lighter than a divider — chart grid, inner rules. */
  faint: string
  errorTint: string
  warningTint: string
  infoTint: string
}

// GCP-inspired: Google blue primary, white surfaces, subtle gray borders,
// dense tables.
export const theme = createTheme({
  palette: {
    primary: { main: '#1a73e8' },
    secondary: { main: '#5f6368' },
    background: { default: '#ffffff', paper: '#ffffff' },
    text: { primary: '#202124', secondary: '#5f6368', disabled: '#80868b' },
    divider: '#dadce0',
    success: { main: '#188038' },
    error: { main: '#d93025' },
    warning: { main: '#f29900', dark: '#e37400' },
    surface: {
      subtle: '#f8f9fa',
      muted: '#f1f3f4',
      faint: '#e8eaed',
      errorTint: '#fce8e6',
      warningTint: '#fef7e0',
      infoTint: '#e8f0fe',
    },
  },
  typography: {
    fontFamily: `'Roboto', 'Helvetica Neue', Arial, sans-serif`,
    fontSize: 13,
    h5: { fontSize: 18, fontWeight: 400, color: '#202124' },
    h6: { fontSize: 16, fontWeight: 500, color: '#202124' },
    body2: { fontSize: 13 },
  },
  shape: { borderRadius: 4 },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#fff',
          color: '#5f6368',
          boxShadow: 'none',
          borderBottom: '1px solid #dadce0',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 500 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontSize: 13,
          borderBottomColor: '#e8eaed',
          // A row is as tall as the tallest thing in it, so every
          // control that lives in a cell is tightened to fit the text
          // line rather than setting its own height. Without this a
          // table with a checkbox column stands ten pixels taller than
          // one without, and the section stops looking like itself.
          //
          // Scoped to cells on purpose: the same small button in a page
          // header stays comfortable to hit.
          '& .MuiIconButton-root': { padding: 1 },
          '& .MuiCheckbox-root': { padding: 1 },
          '& .MuiIconButton-root .MuiSvgIcon-root': { fontSize: 18 },
          '& .MuiCheckbox-root .MuiSvgIcon-root': { fontSize: 18 },
          // An inline <svg> sits on the text baseline and drags a few
          // pixels of descender space into the row with it, which is why
          // a table with a status icon stood taller than one without.
          '& > .MuiSvgIcon-root': { display: 'block' },
          '& .MuiButton-sizeSmall': {
            paddingTop: 0,
            paddingBottom: 0,
            minHeight: 20,
            lineHeight: 1.5,
          },
        },
        // A table cell treats height as a minimum, so this is the floor
        // every row sits on. Set it rather than shrinking the checkbox
        // below its own icon: a row with controls can't go under 28, so
        // 28 is the house row and a text-only table matches it instead
        // of running two pixels tighter.
        sizeSmall: { padding: '3px 12px', height: 28 },
        head: { color: '#5f6368', fontWeight: 500, whiteSpace: 'nowrap' },
      },
    },
    MuiMenu: {
      defaultProps: {
        slotProps: {
          // EIGHT ROWS, THEN SCROLL. A select over every host or every
          // CVE otherwise opens a menu the height of the window, and
          // GCP caps its own region picker the same way.
          //
          // Sized in rows of the ordinary single-line item this app
          // uses (30px, plus the menu's own 8px of padding top and
          // bottom). A menu whose items run to two lines therefore
          // shows fewer than eight — which is the right trade: the
          // point is a menu that fits on screen and scrolls, not a
          // promise about a number.
          paper: { sx: { maxHeight: 8 * 30 + 16 } },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        // Chips are for tags and labels only — never for what a row
        // fundamentally is. No pill border: a tag is a tinted label
        // with the same 4px corner as everything else.
        root: { borderRadius: 4 },
        outlined: {
          border: 'none',
          backgroundColor: '#f1f3f4',
          color: '#3c4043',
        },
        label: { paddingLeft: 6, paddingRight: 6 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderTopRightRadius: 20,
          borderBottomRightRadius: 20,
          '&.Mui-selected': {
            backgroundColor: '#e8f0fe',
            color: '#1a73e8',
            '& .MuiListItemIcon-root': { color: '#1a73e8' },
          },
        },
      },
    },
  },
})
