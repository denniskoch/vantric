import { Link as RouterLink, useLocation } from 'react-router-dom'
import { Box, Button, Typography } from '@mui/material'

/**
 * The catch-all, so a mistyped or stale address is a page rather than a
 * white screen. It renders INSIDE the shell: the address is wrong, not
 * the session, so the search bar and the section menu stay where they
 * are and you can leave without using the back button.
 */
export default function NotFoundPage() {
  const location = useLocation()
  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        There's nothing at this address
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        The console has no page for{' '}
        <Box component="code" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
          {location.pathname}
        </Box>
        . It may have moved, or the link may be out of date.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        This is the console's own routing, not a resource that's missing — a page for a guest or
        bucket that no longer exists says so on the page itself.
      </Typography>
      <Button variant="contained" size="small" component={RouterLink} to="/overview">
        Go to the overview
      </Button>
    </Box>
  )
}
