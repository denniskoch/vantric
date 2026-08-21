import vmTemplates from './vm-templates.md?raw'
import windowsTemplates from './windows-templates.md?raw'

/**
 * The docs, bundled with the app.
 *
 * They are FILES IN THE REPO rather than rows in the database, for the
 * same reason the installers are files in a directory: there is one copy,
 * it is versioned with the code it describes, and editing it is a pull
 * request rather than a form. A doc that says "tick enable guest agent"
 * about a checkbox that has been renamed is worse than no doc, and the
 * only thing that reliably prevents that is the doc living next to the
 * checkbox.
 *
 * Vite's `?raw` inlines the markdown at build time, so a doc page makes
 * no request and works with the backend down — which is the state
 * somebody reading the troubleshooting half is most likely to be in.
 */
export interface Doc {
  slug: string
  title: string
  /** One line, shown in the list and under the title. */
  summary: string
  markdown: string
}

export const docs: Doc[] = [
  {
    slug: 'vm-templates',
    title: 'Building a VM template',
    summary:
      'The guest-side setup that makes Connect work: the guest agent, guest exec on RHEL, sudo, and the serial not to set.',
    markdown: vmTemplates,
  },
  {
    slug: 'windows-templates',
    title: 'Building a Windows template',
    summary:
      'Built by hand rather than by this console: virtio at install time, the agent, RDP, and why sysprep goes last.',
    markdown: windowsTemplates,
  },
]

export function docFor(slug: string | undefined): Doc | undefined {
  return docs.find((d) => d.slug === slug)
}
