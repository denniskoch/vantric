import { TextField } from '@mui/material'
import type { TextFieldProps } from '@mui/material'

/**
 * A select whose "none" option is actually visible.
 *
 * MUI treats an empty string as NO SELECTION rather than as a value, so a
 * `<MenuItem value="">Hypervisor default</MenuItem>` renders as an empty
 * box — it puts a zero-width space there instead of the item's label.
 * That happens both before you touch the field and after you deliberately
 * choose that option, which is why it reads as two bugs: nothing is
 * selected by default, and picking the default does nothing visible.
 *
 * The unset value stays the empty string, because that's what the API
 * means by "leave this alone" and every form here relies on it. What
 * changes is that the field is told to render it: `displayEmpty` shows
 * the matching item, and the label is shrunk to sit above rather than
 * across the text it would otherwise overlap.
 *
 * This is a component rather than two props copied into each form
 * because the incantation is the kind the next select forgets — eight
 * of them had already forgotten it.
 */
export default function SelectField({ children, slotProps, ...props }: TextFieldProps) {
  return (
    <TextField
      {...props}
      select
      slotProps={{
        ...slotProps,
        select: { displayEmpty: true, ...(slotProps?.select as object) },
        inputLabel: { shrink: true, ...(slotProps?.inputLabel as object) },
      }}
    >
      {children}
    </TextField>
  )
}
