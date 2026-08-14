/**
 * How you'd reach a guest from your own machine.
 *
 * The console can't open a session itself — it has no console proxy —
 * so it hands you the thing your desktop already knows how to open,
 * and the command to paste when it doesn't.
 */
export interface Connection {
  kind: 'SSH' | 'RDP'
  /** A URI the desktop can hand to a client. */
  href: string
  /** The same thing as a command, for pasting into a terminal. */
  command: string
  port: number
}

/** Proxmox's guest types: win7, win10, win11, w2k19, wxp, wvista… */
const windows = /^(win|w2k|wxp|wvista)/i

export function connectionFor(osType: string, ip: string): Connection | null {
  if (!ip) return null
  if (windows.test(osType)) {
    return {
      kind: 'RDP',
      // The URI Microsoft's own clients register on macOS and Windows.
      href: `rdp://full%20address=s:${ip}:3389`,
      command: `mstsc /v:${ip}`,
      port: 3389,
    }
  }
  return {
    kind: 'SSH',
    href: `ssh://${ip}`,
    command: `ssh ${ip}`,
    port: 22,
  }
}
