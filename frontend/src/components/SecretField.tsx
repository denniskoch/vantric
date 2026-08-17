import { useState } from 'react'
import { Box, IconButton, InputAdornment, TextField, Tooltip } from '@mui/material'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'

/**
 * A secret you are SETTING, not one you are reading back.
 *
 * The console generates a strong value by default, because the
 * alternative is a form that asks somebody to invent 40 random
 * characters and gets `password123` about a third of the time. It is
 * generated IN THE BROWSER, so the only copy that ever exists is the one
 * on its way to the store — nothing here mints it, logs it or keeps it.
 *
 * It shows in the clear by default for the same reason: this is the one
 * moment the value is visible anywhere, so hiding it behind dots would
 * only stop you checking what you're about to save.
 */
export function generateSecret(length = 40) {
  // No ambiguous glyphs and no URL punctuation — these end up pasted
  // into config files, env vars and connection strings by hand.
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export default function SecretField({
  label,
  value,
  onChange,
  error,
  helperText,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | null
  helperText: string
}) {
  const [visible, setVisible] = useState(true)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <TextField
      label={label}
      size="small"
      value={value}
      type={visible ? 'text' : 'password'}
      onChange={(e) => onChange(e.target.value)}
      error={Boolean(error)}
      helperText={error ?? helperText}
      fullWidth
      slotProps={{
        input: {
          sx: { fontFamily: visible ? 'monospace' : undefined },
          endAdornment: (
            <InputAdornment position="end">
              <Box sx={{ display: 'flex' }}>
                <Tooltip title={visible ? 'Hide' : 'Show'}>
                  <IconButton size="small" onClick={() => setVisible(!visible)}>
                    {visible ? (
                      <VisibilityOffIcon fontSize="small" />
                    ) : (
                      <VisibilityIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
                <Tooltip title={copied ? 'Copied' : 'Copy'}>
                  <IconButton size="small" onClick={copy}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Generate a new one">
                  <IconButton size="small" onClick={() => onChange(generateSecret())}>
                    <AutorenewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
