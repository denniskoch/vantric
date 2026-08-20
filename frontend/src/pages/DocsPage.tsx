import { Box, Card, CardActionArea, Typography } from '@mui/material'
import ArticleIcon from '@mui/icons-material/Article'
import { Link as RouterLink } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { docs } from '../docs'

/**
 * What we've written down.
 *
 * A list rather than the section landing template, because a doc's
 * summary is a sentence rather than a hint — the point of the card is to
 * tell you whether this is the page you need before you open it.
 */
export default function DocsPage() {
  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Documentation"
        description="How to set up the things this console talks to."
      />
      <Box sx={{ display: 'grid', gap: 1.5, maxWidth: 760 }}>
        {docs.map((doc) => (
          <Card key={doc.slug} variant="outlined">
            <CardActionArea component={RouterLink} to={`/docs/${doc.slug}`} sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <ArticleIcon sx={{ fontSize: 18, color: 'text.secondary', mt: '1px' }} />
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 500, mb: 0.25 }}>
                    {doc.title}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                    {doc.summary}
                  </Typography>
                </Box>
              </Box>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Box>
  )
}
