import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import { api } from '../api/client'
import { useRefreshSession } from '../user'
import logoLight from '../assets/brand/kochlabs-logo-light.svg'

/**
 * Local sign-in — the console's own account table.
 *
 * This is the fallback door and it's meant to stay one. Signing in
 * through the lab's identity provider is the better everyday route,
 * but a console reachable only through another service is unreachable
 * exactly when that service is what's broken.
 */
export default function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const refreshSession = useRefreshSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Where they were headed before being bounced here.
  const from = (location.state as { from?: string } | null)?.from ?? '/compute/instances'

  const signIn = useMutation({
    mutationFn: () => api.login(email.trim(), password),
    onSuccess: async () => {
      await refreshSession()
      navigate(from, { replace: true })
    },
    onError: (e: Error) => setError(e.message),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    signIn.mutate()
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#f8f9fa',
        p: 2,
      }}
    >
      <Paper
        variant="outlined"
        component="form"
        onSubmit={submit}
        sx={{ p: 4, width: '100%', maxWidth: 400 }}
      >
        <Box component="img" src={logoLight} alt="" sx={{ height: 24, mb: 3 }} />
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Use your Lab Cloud account.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          autoComplete="username"
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          fullWidth
          size="small"
          sx={{ mb: 3 }}
        />
        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={!email || !password || signIn.isPending}
        >
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </Paper>
    </Box>
  )
}
