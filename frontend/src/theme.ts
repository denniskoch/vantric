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
          // Row height is set by whatever is tallest in the cell, so
          // the controls that live in tables are tightened with it —
          // otherwise padded icon buttons undo the denser rows.
          '& .MuiIconButton-sizeSmall': { padding: 4 },
          '& .MuiCheckbox-root': { padding: 4 },
        },
        sizeSmall: { padding: '3px 12px' },
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
