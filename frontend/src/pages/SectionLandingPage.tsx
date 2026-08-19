import type { ReactNode } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { Box, Paper, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { sectionFor } from '../components/nav'
import type { SectionItem } from '../components/nav'

/**
 * The landing page every section shares: a header, an optional summary
 * supplied by the section itself, and cards for the pages it contains.
 */
export default function SectionLandingPage({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const section = sectionFor(location.pathname)
  if (!section) return null

  // The landing page links to everything except itself.
  const groups = [
    { label: '', items: section.items },
    ...section.groups,
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.to !== section.home) }))
    .filter((g) => g.items.length > 0)

  return (
    <Box sx={{ p: 3, maxWidth: 1100 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <section.icon sx={{ fontSize: 32, color: 'text.secondary' }} />
        <Typography variant="h5">{section.label}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 720 }}>
        {section.description}
      </Typography>

      {children}

      {groups.map((group) => (
        <Box key={group.label || 'main'} sx={{ mb: 3 }}>
          {group.label && (
            <Typography sx={{ fontSize: 16, color: 'text.primary', mb: 1.5 }}>
              {group.label}
            </Typography>
          )}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
              gap: 2,
            }}
          >
            {group.items.map((item) => (
              <ItemCard key={item.to} item={item} />
            ))}
          </Box>
        </Box>
      ))}

    </Box>
  )
}

function ItemCard({ item }: { item: SectionItem }) {
  return (
    <Paper
      component={RouterLink}
      to={item.to}
      variant="outlined"
      sx={{
        p: 2,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        textDecoration: 'none',
        color: 'inherit',
        '&:hover': { bgcolor: 'surface.subtle', borderColor: 'primary.main' },
      }}
    >
      <item.icon sx={{ color: 'primary.main', fontSize: 20, mt: 0.2 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, color: 'text.primary' }}>{item.label}</Typography>
        {item.hint && (
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12, mt: 0.3 }}>
            {item.hint}
          </Typography>
        )}
      </Box>
      <ChevronRightIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
    </Paper>
  )
}
