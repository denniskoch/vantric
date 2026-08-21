import ReactMarkdown from 'react-markdown'
import { Link as RouterLink } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import {
  Box,
  Divider,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { externalHref } from '../safeUrl'

/**
 * Documentation, rendered in the console's own vocabulary.
 *
 * Every element is mapped to a MUI component rather than left to the
 * browser's defaults, because a doc page styled by user-agent CSS reads
 * as a different application — the type scale, the borders and the
 * table density here are the ones the rest of the console uses.
 *
 * react-markdown renders to REACT ELEMENTS. It never builds an HTML
 * string, so there is no dangerouslySetInnerHTML anywhere in this
 * component — which matters because the whole frontend has none, and a
 * markdown viewer is the obvious place for the first one to appear.
 *
 * Links go through externalHref for the same reason they do on the CVE
 * pages: it costs nothing and means the rule holds wherever a URL
 * arrives from a file rather than from this code.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <Box sx={{ maxWidth: 760 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <Typography variant="h5" sx={{ mt: 4, mb: 1.5, fontWeight: 400 }}>
              {children}
            </Typography>
          ),
          h2: ({ children }) => (
            <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
              {children}
            </Typography>
          ),
          h3: ({ children }) => (
            <Typography sx={{ mt: 3, mb: 0.75, fontSize: 14, fontWeight: 500 }}>
              {children}
            </Typography>
          ),
          p: ({ children }) => (
            <Typography sx={{ fontSize: 13, lineHeight: 1.7, mb: 1.5 }}>{children}</Typography>
          ),
          a: ({ href, children }) => {
            // A link to another page of this console stays in the tab and
            // routes client-side. Treating it as external — which is what
            // every link here did until docs started referring to each
            // other — opens a second tab and reloads the whole app to
            // land somewhere the router could have reached instantly.
            if (href && href.startsWith('/')) {
              return (
                <Link component={RouterLink} to={href} sx={{ fontSize: 'inherit' }}>
                  {children}
                </Link>
              )
            }
            const safe = externalHref(href)
            if (!safe) return <>{children}</>
            return (
              <Link href={safe} target="_blank" rel="noreferrer" sx={{ fontSize: 'inherit' }}>
                {children}
              </Link>
            )
          },
          ul: ({ children }) => (
            <Box component="ul" sx={{ pl: 2.5, mb: 1.5, mt: 0 }}>
              {children}
            </Box>
          ),
          ol: ({ children }) => (
            <Box component="ol" sx={{ pl: 2.5, mb: 1.5, mt: 0 }}>
              {children}
            </Box>
          ),
          li: ({ children }) => (
            <Box component="li" sx={{ fontSize: 13, lineHeight: 1.7, mb: 0.5 }}>
              {children}
            </Box>
          ),
          // An inline `thing` and a fenced block are the same node in
          // markdown, told apart by whether it sits inside a <pre>.
          code: ({ children, ...props }) => {
            const inline = !('data-inline' in props) && !String(children).includes('\n')
            if (inline) {
              return (
                <Box
                  component="code"
                  sx={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 12,
                    bgcolor: 'surface.muted',
                    px: 0.5,
                    py: '1px',
                    borderRadius: '4px',
                  }}
                >
                  {children}
                </Box>
              )
            }
            return <>{children}</>
          },
          pre: ({ children }) => (
            <Box
              component="pre"
              sx={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                lineHeight: 1.6,
                bgcolor: 'surface.subtle',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '4px',
                p: 1.5,
                mb: 2,
                // A long command must not widen the page.
                overflowX: 'auto',
                whiteSpace: 'pre',
              }}
            >
              {children}
            </Box>
          ),
          blockquote: ({ children }) => (
            <Box
              sx={{
                borderLeft: '3px solid',
                borderColor: 'primary.main',
                bgcolor: 'surface.infoTint',
                px: 2,
                py: 1,
                mb: 2,
                '& p:last-child': { mb: 0 },
              }}
            >
              {children}
            </Box>
          ),
          hr: () => <Divider sx={{ my: 3 }} />,
          table: ({ children }) => (
            <TableContainer
              component={Paper}
              variant="outlined"
              sx={{ mb: 2, borderColor: 'divider' }}
            >
              <Table size="small">{children}</Table>
            </TableContainer>
          ),
          thead: ({ children }) => <TableHead>{children}</TableHead>,
          tbody: ({ children }) => <TableBody>{children}</TableBody>,
          tr: ({ children }) => <TableRow>{children}</TableRow>,
          th: ({ children }) => (
            <TableCell sx={{ fontWeight: 500, color: 'text.secondary' }}>{children}</TableCell>
          ),
          td: ({ children }) => <TableCell>{children}</TableCell>,
          strong: ({ children }) => (
            <Box component="strong" sx={{ fontWeight: 500 }}>
              {children}
            </Box>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </Box>
  )
}
