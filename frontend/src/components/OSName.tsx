import { Box } from '@mui/material'
import BrandIcon from './BrandIcon'
import { osMark } from '../brands'

/**
 * The mark for anything that names an operating system, at whatever
 * size the row wants — or nothing, when the name says nothing.
 */
export function OSIcon({ name, size = 16 }: { name: string; size?: number }) {
  const mark = osMark(name)
  if (!mark) return null
  if (mark.kind === 'brand') return <BrandIcon icon={mark.icon} size={size} />
  // A glyph is not a logo, so it takes the muted colour of secondary
  // text rather than pretending to be a brand.
  return <mark.icon sx={{ fontSize: size, color: '#5f6368', display: 'block' }} />
}

/**
 * A name with the operating system it implies.
 *
 * Everything this console lists is named after its OS somewhere —
 * ubuntu-24.04-server-cloudimg-amd64.img, a `win11` template, a
 * pfSense ISO — so the mark comes free from the name the backend
 * already returns. Names that match nothing keep their alignment via a
 * spacer, so a column of names doesn't jog left and right.
 */
export default function OSName({ name, size = 16 }: { name: string; size?: number }) {
  const mark = osMark(name)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {mark ? <OSIcon name={name} size={size} /> : <Box sx={{ width: size }} />}
      {name}
    </Box>
  )
}
