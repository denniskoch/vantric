import { useQuery } from '@tanstack/react-query'

/**
 * Who this console says it is.
 *
 * A STORED SETTING, NOT A BUILD ARGUMENT. This was three Vite variables
 * baked into the bundle, on the reasoning that a logo is an asset the
 * bundler has to see and whoever builds the image is whoever sets the
 * name. That stopped being true the moment there was a published image:
 * pulling `vantric:edge` and rebranding it would have meant building
 * your own copy, which is the opposite of what publishing one is for.
 *
 * READ BEFORE SIGN-IN, because the sign-in page wears it.
 */

export interface Branding {
  name: string
  suffix: string
  hasLogo: boolean
  /** Changes when the logo does, so a replaced one isn't served from
   *  cache — the URL is otherwise constant. */
  version: string
}

/** What a console called nothing in particular is called. Matches the
 *  backend's own default, so the two can't drift apart mid-load. */
export const defaultBranding: Branding = {
  name: 'Vantric',
  suffix: 'Cloud',
  hasLogo: false,
  version: '',
}

export const brandLogoURL = (version: string) =>
  `/api/v1/branding/logo${version ? `?v=${version}` : ''}`

/**
 * The branding, everywhere it is drawn.
 *
 * Cached with no expiry: it changes when somebody changes it, and a
 * masthead that re-fetched its own name every thirty seconds would be
 * spending requests on a string. The settings page invalidates it.
 */
export function useBranding(): Branding {
  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: async (): Promise<Branding> => {
      const res = await fetch('/api/v1/branding', { credentials: 'same-origin' })
      if (!res.ok) return defaultBranding
      return res.json()
    },
    staleTime: Infinity,
    // The default is the right answer while this is in flight, so the
    // masthead never flashes empty.
    placeholderData: defaultBranding,
  })
  return data ?? defaultBranding
}

/** What the browser tab says. */
export function documentTitle(brand: Branding): string {
  return [brand.name, brand.suffix, 'Console'].filter(Boolean).join(' ')
}
