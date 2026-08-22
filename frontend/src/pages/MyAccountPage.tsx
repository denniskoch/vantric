import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Snackbar,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import KeyIcon from '@mui/icons-material/Key'
import { api } from '../api/client'
import DetailTable, { DetailSection } from '../components/DetailTable'
import { useSession, sshUsername } from '../user'

/**
 * Your own account: who you are here, your password, and the SSH key
 * the console signs in to guests with.
 *
 * The key is per-account rather than per-console, so a guest's auth log
 * names a person. The private half is write-only — you can replace it
 * or have a new one made, but nothing ever shows it back to you.
 */
export default function MyAccountPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)

  const { data: roles = [] } = useQuery({ queryKey: ['iamRoles'], queryFn: api.listRoles })
  const { data: key } = useQuery({ queryKey: ['mySSHKey'], queryFn: api.mySSHKey })

  const rotate = useMutation({
    mutationFn: api.rotateMySSHKey,
    onSuccess: () => {
      setConfirmRotate(false)
      queryClient.invalidateQueries({ queryKey: ['mySSHKey'] })
    },
    onError: (e: Error) => {
      setConfirmRotate(false)
      setError(e.message)
    },
  })

  const role = roles.find((r) => r.id === user?.role)

  if (!user) return null

  return (
    <Box sx={{ p: 3, maxWidth: 900 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        My account
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Your identity in this console, and how it signs in to your guests.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <DetailSection title="Profile">
        <DetailTable
          rows={[
            { label: 'Email', value: user.email },
            { label: 'Name', value: user.name || '—' },
            {
              label: 'Role',
              value: (
                <Box>
                  {role?.title ?? user.role}
                  {role && (
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {role.description}
                    </Typography>
                  )}
                </Box>
              ),
            },
            {
              label: 'SSH login',
              value: (
                <Box>
                  {sshUsername(user)}
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    The account Connect signs in as on your guests
                  </Typography>
                </Box>
              ),
            },
            {
              label: 'Last sign-in',
              value: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never',
            },
          ]}
        />
      </DetailSection>

      <DetailSection
        title="Password"
        action={
          <Button size="small" onClick={() => navigate('/iam/account/password')}>
            Change password
          </Button>
        }
      >
        <Typography variant="body2" color="text.secondary">
          Changing it signs you out everywhere, including here.
        </Typography>
      </DetailSection>

      <DetailSection
        title="SSH key"
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              startIcon={<KeyIcon />}
              onClick={() => navigate('/iam/account/ssh-key')}
            >
              Replace key
            </Button>
            <Button
              size="small"
              startIcon={<AutorenewIcon />}
              onClick={() => setConfirmRotate(true)}
            >
              Generate new
            </Button>
          </Box>
        }
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          The console signs in to guests as you, with this key. Deploy the
          public half to a guest's <code>~/.ssh/authorized_keys</code> — or let
          the hypervisor's guest agent do it for you the first time Connect
          fails.
        </Typography>

        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'surface.subtle' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box
              component="code"
              sx={{
                flex: 1,
                fontSize: 12,
                wordBreak: 'break-all',
                color: 'text.primary',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              {key?.publicKey ?? 'Loading…'}
            </Box>
            <Button
              size="small"
              startIcon={<ContentCopyIcon />}
              disabled={!key}
              onClick={() => {
                if (!key) return
                navigator.clipboard.writeText(key.publicKey)
                setCopied(true)
              }}
            >
              Copy
            </Button>
          </Box>
        </Paper>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {key?.fingerprint}
          </Typography>
          {key?.imported && <Chip label="imported" size="small" sx={{ fontSize: 10, height: 18 }} />}
        </Box>
      </DetailSection>

      <Dialog open={confirmRotate} onClose={() => setConfirmRotate(false)}>
        <DialogTitle>Generate a new SSH key?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The current key stops working immediately. Guests still holding it will
            refuse you until the guest agent installs the new one, which it does on
            the next Connect wherever it can reach.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRotate(false)}>Cancel</Button>
          <Button color="error" disabled={rotate.isPending} onClick={() => rotate.mutate()}>
            Generate
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Public key copied"
      />
    </Box>
  )
}
