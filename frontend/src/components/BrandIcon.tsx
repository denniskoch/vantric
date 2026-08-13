import type { SimpleIcon } from 'simple-icons'

/**
 * A brand mark from simple-icons, drawn inline — the app makes no
 * outside requests, so nothing is loaded from a CDN.
 *
 * Brand colour is the default because that's what makes a logo
 * recognisable at 16px; pass `color` where the surrounding text should
 * win instead.
 */
export default function BrandIcon({
  icon,
  size = 16,
  color,
  title,
}: {
  icon: SimpleIcon
  size?: number
  color?: string
  /** Overrides the tooltip/label; defaults to the brand's own name. */
  title?: string
}) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={color ?? `#${icon.hex}`}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <title>{title ?? icon.title}</title>
      <path d={icon.path} />
    </svg>
  )
}
