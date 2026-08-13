import { Box } from '@mui/material'
import BrandIcon from './BrandIcon'
import { osBrand } from '../brands'

/**
 * A volume's file name with the distro it's for, when the name says.
 * ISOs, CT templates and cloud images are all named after their OS —
 * ubuntu-24.04-server-cloudimg-amd64.img — so the mark comes free.
 * Names that match nothing (a Windows ISO, a home-made image) keep
 * their alignment via a spacer.
 */
export default function VolumeName({ name }: { name: string }) {
  const brand = osBrand(name)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {brand ? <BrandIcon icon={brand} size={14} /> : <Box sx={{ width: 14 }} />}
      {name}
    </Box>
  )
}
