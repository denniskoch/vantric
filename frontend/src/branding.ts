import kochlabsLogo from './assets/brand/kochlabs-logo-light.svg'

/**
 * Who this console says it is.
 *
 * The project is Vantric; an instance of it may be somebody's lab and
 * want to say so. Both were hardcoded in three components and
 * index.html, which is fine while there is one deployment and wrong
 * the moment there are two — a fork shouldn't have to patch a JSX file
 * to stop advertising a stranger's lab.
 *
 * Build-time rather than a stored setting, deliberately. A logo is an
 * asset the bundler has to see, and whoever builds the image is the
 * same person who would set the name; making it a runtime setting
 * would mean an upload endpoint and a settings page for something
 * changed once in a deployment's life.
 */
const logos: Record<string, string> = {
  kochlabs: kochlabsLogo,
}

export const brand = {
  /** The word before the section name. */
  name: import.meta.env.VITE_BRAND_NAME || 'Vantric',
  /**
   * The lighter word after it, GCP's "Google Cloud". Empty renders
   * the name alone.
   */
  suffix: import.meta.env.VITE_BRAND_SUFFIX ?? 'Cloud',
  /**
   * A wordmark to draw instead of the name. Unset renders the name as
   * text, which is what a fork gets and what this was designed
   * against — the logo is the special case, not the default.
   */
  logo: logos[import.meta.env.VITE_BRAND_LOGO ?? ''] ?? '',
}

/** What the browser tab says. */
export const documentTitle = [brand.name, brand.suffix, 'Console']
  .filter(Boolean)
  .join(' ')
