import { Box, Link, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { Link as RouterLink, useParams } from 'react-router-dom'
import Markdown from '../components/Markdown'
import { docFor } from '../docs'
import NotFoundPage from './NotFoundPage'

/**
 * One doc.
 *
 * The title and summary come from the index rather than from the
 * markdown's own first heading, so the list and the page agree without
 * anyone keeping two copies of the same sentence in step.
 */
export default function DocsArticlePage() {
  const { slug } = useParams()
  const doc = docFor(slug)
  if (!doc) return <NotFoundPage />

  return (
    <Box sx={{ p: 3 }}>
      <Link
        component={RouterLink}
        to="/docs"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 13, mb: 1 }}
      >
        <ArrowBackIcon sx={{ fontSize: 16 }} />
        Documentation
      </Link>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        {doc.title}
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2, maxWidth: 760 }}>
        {doc.summary}
      </Typography>
      <Markdown>{doc.markdown}</Markdown>
    </Box>
  )
}
