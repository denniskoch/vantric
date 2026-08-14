/**
 * How you get into a guest.
 *
 * SSH the console proxies itself, so it opens in a browser window and
 * needs nothing installed. RDP it can't, so Windows guests get the URI
 * the desktop's own client already knows how to open.
 */
export interface Connection {
  kind: 'SSH' | 'RDP'
  /** Where the button goes: an in-app terminal for SSH, a URI the
   *  desktop hands to its own client for RDP. */
  href: string
  /** True when href is an app route rather than an external scheme. */
  internal: boolean
  /** The same thing as a command, for pasting into a terminal. */
  command: string
  port: number
}

/** Proxmox's guest types: win7, win10, win11, w2k19, wxp, wvista… */
const windows = /^(win|w2k|wxp|wvista)/i

export function connectionFor(
  osType: string,
  ip: string,
  instanceName: string,
): Connection | null {
  if (!ip) return null
  if (windows.test(osType)) {
    return {
      kind: 'RDP',
      // No RDP proxy here, so this hands the desktop the URI
      // Microsoft's own clients register on macOS and Windows.
      href: `rdp://full%20address=s:${ip}:3389`,
      internal: false,
      command: `mstsc /v:${ip}`,
      port: 3389,
    }
  }
  return {
    kind: 'SSH',
    // The console proxies the session itself; no local client needed.
    href: `/compute/instances/${encodeURIComponent(instanceName)}/ssh`,
    internal: true,
    command: `ssh ${ip}`,
    port: 22,
  }
}
