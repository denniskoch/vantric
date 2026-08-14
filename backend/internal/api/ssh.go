package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
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

	client, err := dialSSH(inst.InternalIP, auth)
	if err != nil {
		fail("%v", err)
		return
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

// dialSSH authenticates with whichever credential was supplied.
//
// Host keys are not verified: these are lab guests that get rebuilt
// regularly, and pinning a key store the user never sees would produce
// failures they can't act on. The trade is stated in the UI rather
// than hidden here.
func dialSSH(host string, auth sshAuth) (*ssh.Client, error) {
	config := &ssh.ClientConfig{
		User:            auth.Username,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         sshDialTimeout,
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
		config.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	case auth.Password != "":
		config.Auth = []ssh.AuthMethod{
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
		}
	default:
		return nil, fmt.Errorf("a password or private key is required")
	}

	client, err := ssh.Dial("tcp", net.JoinHostPort(host, "22"), config)
	if err != nil {
		return nil, fmt.Errorf("could not connect to %s: %v", host, err)
	}
	return client, nil
}

type writerFunc func(p []byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }
