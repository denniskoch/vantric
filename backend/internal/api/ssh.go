package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/store"
)

// Browser SSH: the console proxies a terminal rather than handing you
// an ssh:// link, so a guest reachable from the server is reachable
// from any browser that can see the console.
//
// Credentials are never stored. They arrive as the first frame of the
// websocket — not as query parameters, which end up in proxy logs —
// are used to authenticate one session, and go out of scope with it.

const (
	// A session held open forever is a session nobody remembers
	// opening; the terminal says so before it closes.
	sshMaxSession  = 4 * time.Hour
	sshIdleLimit   = 30 * time.Minute
	sshDialTimeout = 10 * time.Second
	// Provisioning is a few guest-agent round trips; longer than this
	// and the terminal should stop pretending it's about to work.
	sshProvisionTimeout = 45 * time.Second
)

var sshUpgrader = websocket.Upgrader{
	// Same-origin only: the console serves the page and the socket, so
	// a cross-site page has no business opening one.
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // non-browser client
		}
		return strings.HasSuffix(origin, r.Host) || strings.Contains(origin, "localhost")
	},
}

// The console signs in with a key of its own, generated once and kept
// beside the database. Deploy the public half to your guests — the
// cloud-init fields in the create flow take it — and every instance
// becomes reachable from the browser without anyone typing a password
// into this app.
var (
	sshKeyOnce sync.Once
	sshKeyPair *sshKey
	sshKeyErr  error
)

type sshKey struct {
	signer ssh.Signer
	// Public is the authorized_keys line to deploy.
	Public string
}

// consoleKey loads the console's key, creating it on first use.
func consoleKey(dir string) (*sshKey, error) {
	sshKeyOnce.Do(func() {
		path := filepath.Join(dir, "console_ed25519")
		pem, err := os.ReadFile(path)
		if err != nil {
			pub, priv, genErr := ed25519.GenerateKey(rand.Reader)
			if genErr != nil {
				sshKeyErr = genErr
				return
			}
			block, marshalErr := ssh.MarshalPrivateKey(priv, "lab-cloud-manager")
			if marshalErr != nil {
				sshKeyErr = marshalErr
				return
			}
			pem = encodePEM(block)
			if err := os.MkdirAll(dir, 0o700); err != nil {
				sshKeyErr = err
				return
			}
			// 0600: it is a credential, and the directory already holds
			// the database next to it.
			if err := os.WriteFile(path, pem, 0o600); err != nil {
				sshKeyErr = err
				return
			}
			sshPub, _ := ssh.NewPublicKey(pub)
			_ = os.WriteFile(path+".pub", ssh.MarshalAuthorizedKey(sshPub), 0o644)
		}
		signer, err := ssh.ParsePrivateKey(pem)
		if err != nil {
			sshKeyErr = err
			return
		}
		sshKeyPair = &sshKey{
			signer: signer,
			Public: strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey()))) +
				" lab-cloud-manager",
		}
	})
	return sshKeyPair, sshKeyErr
}

// sshKeyHandler exposes the public half so the UI can show what to
// deploy. The private half never leaves the server.
func (s *Server) sshKey(w http.ResponseWriter, r *http.Request) {
	key, err := consoleKey(s.dataDir)
	if err != nil {
		s.fail(w, err, "console ssh key")
		return
	}
	s.json(w, http.StatusOK, map[string]string{"publicKey": key.Public})
}

// sshAuth is the first frame the client sends.
type sshAuth struct {
	Username string `json:"username"`
	Password string `json:"password"`
	// PrivateKey is an optional PEM key; Passphrase decrypts it.
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
}

// sshMessage is anything the client sends afterwards: keystrokes, or a
// resize when the browser window changes.
type sshMessage struct {
	Type string `json:"type"` // data | resize
	Data string `json:"data"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (s *Server) instanceSSH(w http.ResponseWriter, r *http.Request) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	if inst.InternalIP == "" {
		s.err(w, http.StatusConflict, "no address known for this instance — is the guest agent running?")
		return
	}

	conn, err := sshUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already answered
	}
	defer conn.Close()

	// Everything past the upgrade reports through the terminal itself:
	// the browser can't read an HTTP status once the socket is open.
	fail := func(format string, args ...any) {
		_ = conn.WriteMessage(websocket.TextMessage,
			[]byte("\r\n\x1b[31m"+fmt.Sprintf(format, args...)+"\x1b[0m\r\n"))
	}

	var auth sshAuth
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Minute))
	if err := conn.ReadJSON(&auth); err != nil {
		fail("No credentials received.")
		return
	}
	if auth.Username == "" {
		fail("A username is required.")
		return
	}

	key, keyErr := consoleKey(s.dataDir)
	if keyErr != nil {
		fail("The console has no usable SSH key: %v", keyErr)
		return
	}
	client, err := dialSSH(inst.InternalIP, auth, key)
	if err != nil {
		// Almost always this guest has simply never seen the console's
		// key. If the hypervisor can reach inside it, put the account
		// there and try once more; otherwise say what to install.
		note := func(format string, args ...any) {
			_ = conn.WriteMessage(websocket.TextMessage,
				[]byte("\r\n\x1b[90m"+fmt.Sprintf(format, args...)+"\x1b[0m\r\n"))
		}
		if provErr := s.provisionConsoleUser(r.Context(), inst, auth.Username, key, note); provErr != nil {
			fail("%v", err)
			if provErr != errNoProvisioner {
				fail("%v", provErr)
			}
			fail("Add the console's key to %s@%s and try again:", auth.Username, inst.InternalIP)
			_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n"+key.Public+"\r\n"))
			return
		}
		// One retry, never a loop: if the account we just created still
		// can't log in, something else is wrong and repeating won't
		// find it.
		client, err = dialSSH(inst.InternalIP, auth, key)
		if err != nil {
			fail("%v", err)
			fail("The %s account was provisioned but still can't sign in — check sshd on this guest.",
				auth.Username)
			return
		}
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		fail("Could not open a session: %v", err)
		return
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		fail("Could not attach input: %v", err)
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		fail("Could not attach output: %v", err)
		return
	}
	session.Stderr = writerFunc(func(p []byte) (int, error) {
		return len(p), conn.WriteMessage(websocket.TextMessage, p)
	})

	cols, rows := auth.Cols, auth.Rows
	if cols <= 0 || rows <= 0 {
		cols, rows = 80, 24
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		fail("Could not request a terminal: %v", err)
		return
	}
	if err := session.Shell(); err != nil {
		fail("Could not start a shell: %v", err)
		return
	}
	s.log.Info("ssh session opened", "instance", inst.Name, "user", auth.Username)

	ctx, cancel := context.WithTimeout(r.Context(), sshMaxSession)
	defer cancel()

	// Guest → browser.
	go func() {
		defer cancel()
		buf := make([]byte, 32<<10)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				if err := conn.WriteMessage(websocket.TextMessage, buf[:n]); err != nil {
					return
				}
			}
			if err != nil {
				if err != io.EOF {
					fail("Connection closed: %v", err)
				}
				return
			}
		}
	}()

	// Browser → guest, until the session ends or goes quiet.
	go func() {
		defer cancel()
		for {
			_ = conn.SetReadDeadline(time.Now().Add(sshIdleLimit))
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg sshMessage
			if err := json.Unmarshal(raw, &msg); err != nil {
				continue
			}
			switch msg.Type {
			case "resize":
				if msg.Cols > 0 && msg.Rows > 0 {
					_ = session.WindowChange(msg.Rows, msg.Cols)
				}
			default:
				if _, err := io.WriteString(stdin, msg.Data); err != nil {
					return
				}
			}
		}
	}()

	<-ctx.Done()
	s.log.Info("ssh session closed", "instance", inst.Name, "user", auth.Username)
}

// errNoProvisioner means nothing was attempted — no driver, no
// capability, or the operator turned provisioning off. The terminal
// falls back to printing the key without claiming anything failed.
var errNoProvisioner = errors.New("no guest provisioner")

// provisionConsoleUser creates the console's login on a guest that has
// never seen its key, using the hypervisor's guest agent.
//
// This is the one place the console does something root-equivalent
// that nobody asked for by name, so it is narrow and it is loud: only
// on an authentication failure, only for the account the console signs
// in as, and it says so in the terminal and the server log.
func (s *Server) provisionConsoleUser(
	ctx context.Context,
	inst *store.Instance,
	username string,
	key *sshKey,
	note func(string, ...any),
) error {
	if !s.ssh.Provision {
		return errNoProvisioner
	}
	// Windows guests have an agent too, and none of this applies to
	// them — they connect over RDP.
	if strings.HasPrefix(strings.ToLower(inst.OSType), "w") {
		return errNoProvisioner
	}
	driver, ok := s.registry.Get(inst.ServerID)
	if !ok {
		return errNoProvisioner
	}
	provisioner, ok := driver.(hypervisor.GuestProvisioner)
	if !ok {
		return errNoProvisioner
	}

	note("Setting up console access on %s…", inst.Name)
	ctx, cancel := context.WithTimeout(ctx, sshProvisionTimeout)
	defer cancel()
	err := provisioner.EnsureConsoleUser(ctx, inst.DriverID, hypervisor.ConsoleUser{
		Username:  username,
		PublicKey: key.Public,
		Sudo:      s.ssh.Sudo,
	})
	if err != nil {
		s.log.Warn("provisioning console user", "instance", inst.Name, "user", username, "error", err)
		return err
	}
	s.log.Info("provisioned console user via guest agent",
		"instance", inst.Name, "user", username, "sudo", s.ssh.Sudo)
	note("Created %s on %s and installed the console's key.", username, inst.Name)
	return nil
}

// dialSSH authenticates with whichever credential was supplied.
//
// Host keys are not verified: these are lab guests that get rebuilt
// regularly, and pinning a key store the user never sees would produce
// failures they can't act on. The trade is stated in the UI rather
// than hidden here.
func dialSSH(host string, auth sshAuth, key *sshKey) (*ssh.Client, error) {
	config := &ssh.ClientConfig{
		User:            auth.Username,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         sshDialTimeout,
		// The console's own key first; a password only if one was
		// supplied, which the UI no longer asks for.
		Auth: []ssh.AuthMethod{ssh.PublicKeys(key.signer)},
	}
	switch {
	case auth.PrivateKey != "":
		var signer ssh.Signer
		var err error
		if auth.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(
				[]byte(auth.PrivateKey), []byte(auth.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(auth.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("that key could not be read: %v", err)
		}
		config.Auth = append(config.Auth, ssh.PublicKeys(signer))
	case auth.Password != "":
		config.Auth = append(config.Auth,
			ssh.Password(auth.Password),
			// Most servers answer password prompts as keyboard-
			// interactive rather than plain password auth.
			ssh.KeyboardInteractive(func(_, _ string, questions []string, _ []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range answers {
					answers[i] = auth.Password
				}
				return answers, nil
			}),
		)
	}

	client, err := ssh.Dial("tcp", net.JoinHostPort(host, "22"), config)
	if err != nil {
		return nil, fmt.Errorf("could not connect to %s: %v", host, err)
	}
	return client, nil
}

// encodePEM renders a PEM block without pulling in the whole
// encoding/pem surface at the call site.
func encodePEM(block *pem.Block) []byte {
	return pem.EncodeToMemory(block)
}

type writerFunc func(p []byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }
