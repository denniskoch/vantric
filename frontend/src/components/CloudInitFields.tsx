import {
  Box,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import SelectField from './SelectField'
import type { CloudInitConfig } from '../api/client'

interface Props {
  value: CloudInitConfig
  onChange: (next: CloudInitConfig) => void
}

/**
 * Cloud-init settings, split so each group can sit in the section it
 * belongs to: addressing under Networking, credentials under Security,
 * first-boot behaviour under Advanced. Everything is optional — blank
 * fields leave the image's own defaults alone.
 */
export function CloudInitLoginFields({ value, onChange }: Props) {
  const set = <K extends keyof CloudInitConfig>(key: K, v: CloudInitConfig[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Default user"
          size="small"
          value={value.user}
          onChange={(e) => set('user', e.target.value)}
          helperText="Blank keeps the image default (debian, ubuntu…)"
          sx={{ flex: 1 }}
        />
        <TextField
          label="Password"
          size="small"
          type="password"
          value={value.password}
          onChange={(e) => set('password', e.target.value)}
          helperText="Console login; hashed by the hypervisor"
          sx={{ flex: 1 }}
        />
      </Box>
      <TextField
        label="SSH public keys"
        size="small"
        multiline
        minRows={3}
        value={value.sshKeys}
        onChange={(e) => set('sshKeys', e.target.value)}
        placeholder="ssh-ed25519 AAAA... user@host"
        helperText="One key per line"
        fullWidth
      />

    </>
  )
}

export function CloudInitNetworkFields({ value, onChange }: Props) {
  const set = <K extends keyof CloudInitConfig>(key: K, v: CloudInitConfig[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        IPv4
      </Typography>
      <FormControlLabel
        control={
          <Checkbox size="small" checked={value.dhcp} onChange={(e) => set('dhcp', e.target.checked)} />
        }
        label="Use DHCP"
      />
      {!value.dhcp && (
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="Address"
            size="small"
            value={value.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="192.168.1.50/24"
            helperText="CIDR notation"
            sx={{ flex: 1 }}
          />
          <TextField
            label="Gateway"
            size="small"
            value={value.gateway}
            onChange={(e) => set('gateway', e.target.value)}
            placeholder="192.168.1.1"
            sx={{ flex: 1 }}
          />
        </Box>
      )}

      <Typography variant="body2" sx={{ fontWeight: 500, mt: 1 }}>
        IPv6
      </Typography>
      <TextField
        label="Mode"
        size="small"
        select
        value={value.ipv6Mode}
        onChange={(e) => set('ipv6Mode', e.target.value as CloudInitConfig['ipv6Mode'])}
        sx={{ maxWidth: 260 }}
      >
        <MenuItem value="none">Disabled</MenuItem>
        <MenuItem value="dhcp">DHCPv6</MenuItem>
        <MenuItem value="slaac">SLAAC (router advertisement)</MenuItem>
        <MenuItem value="static">Static</MenuItem>
      </TextField>
      {value.ipv6Mode === 'static' && (
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="IPv6 address"
            size="small"
            value={value.address6}
            onChange={(e) => set('address6', e.target.value)}
            placeholder="2001:db8::5/64"
            sx={{ flex: 1 }}
          />
          <TextField
            label="IPv6 gateway"
            size="small"
            value={value.gateway6}
            onChange={(e) => set('gateway6', e.target.value)}
            placeholder="2001:db8::1"
            sx={{ flex: 1 }}
          />
        </Box>
      )}

      <Typography variant="body2" sx={{ fontWeight: 500, mt: 1 }}>
        DNS
      </Typography>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Nameservers"
          size="small"
          value={value.nameservers}
          onChange={(e) => set('nameservers', e.target.value)}
          placeholder="192.168.1.1 1.1.1.1"
          helperText="Space or comma separated; blank uses the host's"
          sx={{ flex: 1 }}
        />
        <TextField
          label="Search domain"
          size="small"
          value={value.searchDomain}
          onChange={(e) => set('searchDomain', e.target.value)}
          placeholder="lan"
          sx={{ flex: 1 }}
        />
      </Box>
    </>
  )
}

export function CloudInitAdvancedFields({ value, onChange }: Props) {
  const set = <K extends keyof CloudInitConfig>(key: K, v: CloudInitConfig[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={value.upgradePackages}
            onChange={(e) => set('upgradePackages', e.target.checked)}
          />
        }
        label="Upgrade packages on first boot (slower, but current)"
      />
      <SelectField
        label="Datasource format"
        size="small"
        value={value.datasource}
        onChange={(e) => set('datasource', e.target.value)}
        helperText="Some images only accept one format"
        sx={{ maxWidth: 260 }}
      >
        <MenuItem value="">Hypervisor default</MenuItem>
        <MenuItem value="nocloud">NoCloud (most Linux images)</MenuItem>
        <MenuItem value="configdrive2">ConfigDrive 2 (OpenStack-style)</MenuItem>
      </SelectField>
    </>
  )
}

/** All groups together, for a form with a single cloud-init section. */
export default function CloudInitFields(props: Props) {
  return (
    <>
      <CloudInitLoginFields {...props} />
      <CloudInitNetworkFields {...props} />
      <CloudInitAdvancedFields {...props} />
    </>
  )
}
