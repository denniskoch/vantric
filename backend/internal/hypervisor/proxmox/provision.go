package proxmox

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"lab-cloud-manager/internal/hypervisor"
)

// Just-in-time account provisioning through the QEMU guest agent.
//
// The console adopts VMs it didn't create, so most guests have never
// heard of its key and the first Connect can only fail. The agent is
// the one channel that reaches inside a running guest without already
// having a login for it — which is exactly how a cloud console does
// this: click SSH and the account appears.
//
// The channel is root and leaves nothing in the guest's auth log, so
// it is used for one thing and stopped: create the account, install
// the key, get out. Every session after that is ordinary SSH.

const (
	// The script is small and the agent answers in milliseconds; a guest
	// that hasn't finished in this long is wedged, not slow.
	execTimeout = 30 * time.Second
	execPoll    = 300 * time.Millisecond
)

// EnsureConsoleUser creates the console's login on a guest if it isn't
// there and installs the console's key. Idempotent: running it twice
// changes nothing the second time.
func (d *Driver) EnsureConsoleUser(ctx context.Context, driverID string, user hypervisor.ConsoleUser) error {
	if user.Username == "" || user.PublicKey == "" {
		return fmt.Errorf("proxmox: console user needs a name and a key")
	}
	// root is what this exists to avoid, and "provision root" would mean
	// rewriting the account that already owns the machine.
	if user.Username == "root" {
		return fmt.Errorf("proxmox: refusing to provision root")
	}
	node, err := d.node(ctx, driverID)
	if err != nil {
		return err
	}

	script := provisionScript(user)
	// Handed over base64-encoded so nothing in the key or the username
	// has to survive form encoding, argv splitting and a shell intact.
	encoded := base64.StdEncoding.EncodeToString([]byte(script))
	form := url.Values{}
	form.Add("command", "/bin/sh")
	form.Add("command", "-c")
	form.Add("command", "echo "+encoded+" | base64 -d | /bin/sh")

	var started struct {
		PID int `json:"pid"`
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%s/agent/exec", node, driverID)
	if err := d.do(ctx, http.MethodPost, path, form, &started); err != nil {
		return execError(err)
	}

	statusPath := fmt.Sprintf("/nodes/%s/qemu/%s/agent/exec-status?pid=%d", node, driverID, started.PID)
	deadline := time.Now().Add(execTimeout)
	for {
		var status struct {
			Exited   int    `json:"exited"`
			ExitCode int    `json:"exitcode"`
			OutData  string `json:"out-data"`
			ErrData  string `json:"err-data"`
		}
		if err := d.do(ctx, http.MethodGet, statusPath, nil, &status); err != nil {
			return execError(err)
		}
		if status.Exited != 0 {
			if status.ExitCode != 0 {
				detail := strings.TrimSpace(status.ErrData)
				if detail == "" {
					detail = strings.TrimSpace(status.OutData)
				}
				if detail == "" {
					detail = fmt.Sprintf("exit status %d", status.ExitCode)
				}
				return fmt.Errorf("provisioning %s failed in the guest: %s", user.Username, detail)
			}
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the guest agent did not finish within %s", execTimeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(execPoll):
		}
	}
}

// execError translates the two failures worth naming. Everything else
// passes through: a guest agent that isn't running says so plainly.
func execError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "403"), strings.Contains(msg, "Permission check failed"):
		return fmt.Errorf("this API token may not run commands in guests — it needs the VM.Monitor privilege: %w", err)
	case strings.Contains(msg, "QEMU guest agent is not running"),
		strings.Contains(msg, "No QEMU guest agent"):
		return fmt.Errorf("the QEMU guest agent isn't running on this guest: %w", err)
	}
	return err
}

// provisionScript renders the work as POSIX sh: the guests worth
// reaching this way run everything from Alpine's busybox to RHEL, and
// the differences between them are all in this one script.
//
// Every step is written to be safe on a second run — the console calls
// this whenever authentication fails, which includes the case where
// the account exists and only the key has rotated.
func provisionScript(user hypervisor.ConsoleUser) string {
	var b strings.Builder
	fmt.Fprintf(&b, "set -e\nuser=%s\nkey=%s\n", shellQuote(user.Username), shellQuote(user.PublicKey))
	b.WriteString(`
if ! id -u "$user" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$user" 2>/dev/null \
    || adduser -D -s /bin/sh "$user" 2>/dev/null \
    || { echo "could not create $user: no useradd or adduser" >&2; exit 1; }
fi

home=$(getent passwd "$user" 2>/dev/null | cut -d: -f6)
[ -n "$home" ] || home="/home/$user"
mkdir -p "$home/.ssh"

# Replace any key this console left before rather than appending a new
# one each time it rotates, and leave the user's own keys alone.
touch "$home/.ssh/authorized_keys"
grep -v ' lab-cloud-manager$' "$home/.ssh/authorized_keys" > "$home/.ssh/authorized_keys.lcm" 2>/dev/null || true
printf '%s\n' "$key" >> "$home/.ssh/authorized_keys.lcm"
mv "$home/.ssh/authorized_keys.lcm" "$home/.ssh/authorized_keys"

chown -R "$user:" "$home/.ssh" 2>/dev/null || chown -R "$user" "$home/.ssh"
chmod 700 "$home/.ssh"
chmod 600 "$home/.ssh/authorized_keys"
`)
	if user.Sudo {
		b.WriteString(`
if [ -d /etc/sudoers.d ]; then
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$user" > "/etc/sudoers.d/$user"
  chmod 440 "/etc/sudoers.d/$user"
fi
`)
	} else {
		// Turning the setting back off should take the grant away too,
		// or "sudo: off" would only describe guests provisioned since.
		b.WriteString("\nrm -f \"/etc/sudoers.d/$user\"\n")
	}
	b.WriteString("\necho provisioned \"$user\"\n")
	return b.String()
}

// shellQuote wraps a value in single quotes so a key comment or an odd
// username can't end the string and start a command.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
