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
              // COLUMNS DROP, THEY DO NOT SQUEEZE. Fixed breakpoints
              // gave two columns from 600px up, which at tablet width
              // is a 224px card — narrow enough that most hints ran
              // past the two lines the card reserves for them. A
              // minimum track width lets the grid shed a column
              // instead, so a card is never narrower than the text it
              // has to hold.
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
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

/**
 * A CARD IS ONE SIZE, WHICH IS WHAT MAKES IT A GRID.
 *
 * The grid already stretched cards to match WITHIN a row — that is what
 * `align-items: stretch` does — so the ragged edge was between rows: a
 * row whose hints all fit on one line stood shorter than the row under
 * it, and the page read as a stack of unrelated blocks rather than one
 * grid. Uniformity has to be a property of the card, not of its
 * neighbours.
 *
 * So both lines are RESERVED rather than measured: one for the label,
 * two for the hint, whether a given card's hint uses one, two, or none
 * at all. The longest hint here is 73 characters, which is two lines at
 * the narrowest the cards go (three columns). A hint that needed a
 * third is clipped, and that is the intended pressure: the fix is a
 * shorter hint, not a taller card, since the moment one card grows
 * every card grows with it.
 */
const hintLines = 2
const hintLineHeight = 1.45

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
        {/* One line, always. A section item is a short noun phrase —
            the same string the left nav shows — so a wrap here is the
            card being too narrow rather than the name being long, and
            an ellipsis says that better than a card standing a line
            taller than the one beside it. */}
        <Typography
          noWrap
          sx={{ fontSize: 14, lineHeight: 1.5, color: 'text.primary' }}
        >
          {item.label}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            fontSize: 12,
            lineHeight: hintLineHeight,
            mt: 0.3,
            // Both ends pinned: the height is the same with a hint of
            // one line, two, or none, and a longer one is clamped to it
            // rather than pushing the card taller than its row.
            minHeight: `${hintLines * hintLineHeight}em`,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: hintLines,
            overflow: 'hidden',
          }}
        >
          {item.hint}
        </Typography>
      </Box>
      <ChevronRightIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
    </Paper>
  )
}
