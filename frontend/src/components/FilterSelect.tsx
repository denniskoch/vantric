import { useState } from 'react'
import { Button, ListItemText, Menu, MenuItem } from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'

export interface FilterOption {
  value: string
  label: string
}

/**
 * A filter that shows what it is set to, and nothing else.
 *
 * NOT a form control. An outlined select with a floating label is for
 * a field you are filling in — it reserves room for a label you have
 * already read, and it makes a row of filters look like a form nobody
 * asked you to complete. A filter only has to answer "what am I
 * looking at", so it shows the chosen value and gets out of the way.
 *
 * Same shape as TimeRangePicker on purpose: a row of filters should
 * read as one row of the same thing.
 */
export default function FilterSelect({
  value,
  onChange,
  options,
  /** What to show, and what to offer, for "no filter at all". */
  anyLabel,
  icon,
}: {
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  anyLabel: string
  icon?: React.ReactNode
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const chosen = options.find((o) => o.value === value)

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={icon}
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          textTransform: 'none',
          maxWidth: 260,
          // A model name can be long; the button shouldn't grow to fit
          // one and push the rest of the row off screen.
          '& .MuiButton-startIcon + span, & > span': { minWidth: 0 },
        }}
      >
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {chosen?.label ?? anyLabel}
        </span>
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          selected={!value}
          onClick={() => {
            onChange('')
            setAnchor(null)
          }}
        >
          <ListItemText primary={anyLabel} />
        </MenuItem>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            selected={o.value === value}
            onClick={() => {
              onChange(o.value)
              setAnchor(null)
            }}
          >
            <ListItemText primary={o.label} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
