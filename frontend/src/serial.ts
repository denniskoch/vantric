/**
 * A hardware serial, or nothing.
 *
 * DMI has a serial field and a great many machines ship with it filled
 * in by nobody: both MSI boards here report "To be filled by O.E.M.",
 * and other vendors leave "Default string" or "System Serial Number".
 * Those look like data and aren't. The column exists to identify one
 * specific machine, so a string every board of that model shares
 * identifies none of them — it's the same trap as a VM whose SMBIOS
 * serial the hypervisor never set.
 *
 * Shared because four pages show a serial and each would otherwise
 * decide for itself. Callers render null as "—", or as whatever their
 * own words for absent are.
 */
const placeholders = [
  'to be filled by o.e.m.',
  'to be filled by oem',
  'system serial number',
  'default string',
  'not specified',
  'not applicable',
  'unknown',
  'none',
  'n/a',
  '0',
]

export function realSerial(serial: string | undefined | null): string | null {
  const value = (serial ?? '').trim()
  if (!value || placeholders.includes(value.toLowerCase())) return null
  return value
}
