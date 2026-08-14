/**
 * How you'd reach a guest from your own machine.
 *
 * The console can't open a session itself — it has no console proxy —
 * so it hands you the thing your desktop already knows how to open,
 * and the command to paste when it doesn't.
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
