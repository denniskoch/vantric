import { createTheme } from '@mui/material/styles'

// GCP-inspired: Google blue primary, white surfaces, subtle gray borders,
// dense tables.
export const theme = createTheme({
  palette: {
    primary: { main: '#1a73e8' },
    secondary: { main: '#5f6368' },
    background: { default: '#ffffff', paper: '#ffffff' },
    text: { primary: '#202124', secondary: '#5f6368' },
    divider: '#dadce0',
    success: { main: '#188038' },
    error: { main: '#d93025' },
    warning: { main: '#f29900' },
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
