import { Box } from '@mui/material'
import BrandIcon from './BrandIcon'
import { aiProviderMark } from '../brands'

/**
 * A model provider with its mark, keyed on the name the gateway
 * reports.
 *
 * simple-icons has no OpenAI, xAI or Cerebras mark, so those get the
 * neutral glyph rather than a lookalike — X's logo is not xAI's, and a
 * hand-drawn approximation of OpenAI's knot would be a wrong logo
 * beside a real provider.
 */
export default function ProviderName({ name, size = 16 }: { name: string; size?: number }) {
  const mark = aiProviderMark(name)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {mark ? (
        mark.kind === 'brand' ? (
          <BrandIcon icon={mark.icon} size={size} />
        ) : (
          <mark.icon sx={{ fontSize: size, color: 'text.secondary', display: 'block' }} />
        )
      ) : (
        <Box sx={{ width: size }} />
      )}
      {name}
    </Box>
  )
}
