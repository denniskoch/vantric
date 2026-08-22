package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"vantric/internal/guac"
)

// A desktop in the browser, the same shape as the terminal next door.
//
// browser ⇄ websocket ⇄ this handler ⇄ guacd ⇄ the guest. guacd speaks
// RDP; this speaks the protocol guacd uses to describe what it sees,
// and mostly just carries it.
//
// WHAT DOESN'T CARRY OVER FROM SSH IS THE SIGN-IN, and deliberately not.
// The terminal connects as the signed-in account with a key this console
// mints, so a guest's auth log names a person. RDP has no key
// equivalent, so credentials are TYPED PER SESSION and arrive as the
// socket's first frame — never a query parameter, which lands in proxy
// logs — used for one handshake and written down nowhere.
//
// The handshake is done HERE rather than in the page: guacd is told
// which host to dial, so a compromised page cannot re-point the
// connection, and the browser never learns the guest's address.

// rdpAuth is the first frame. Blank is allowed on all three: a Windows
// guest may prompt for credentials itself, and refusing to open a
// session without them would make this useless for exactly the case
// where you want a screen.
type rdpAuth struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Domain   string `json:"domain"`
}

// The screen guacd is told about at connect time. RDP fixes a
// resolution when the session starts; the browser can resize afterwards
// because resize-method is set, but the first frame has to be honest
// about the window it is going into.
const (
	defaultWidth  = 1280
	defaultHeight = 800
	defaultDPI    = 96
)

func (s *Server) instanceRDP(w http.ResponseWriter, r *http.Request) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	if inst.InternalIP == "" {
		s.err(w, http.StatusConflict, "no address known for this instance — is the guest agent running?")
		return
	}
	if inst.Status != "RUNNING" {
		// A stopped guest has no RDP service. Said before the upgrade,
		// because a browser can't read a status once the socket is open.
		s.err(w, http.StatusConflict, "the instance is not running")
		return
	}

	conn, err := s.sshUpgrader().Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already answered
	}
	defer conn.Close()

	// gorilla/websocket panics on concurrent writes and two goroutines
	// write here: the relay and the ping ticker.
	var writeMu sync.Mutex
	write := func(kind int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(kind, data)
	}
	// Past the upgrade there is no HTTP status left to send, so failures
	// go down the socket as a guacd `error` instruction — which is what
	// the browser's client already knows how to display.
	fail := func(msg string) {
		_ = write(websocket.TextMessage,
			[]byte(guac.Instruction{Opcode: "error", Args: []string{msg, "519"}}.String()))
	}

	var auth rdpAuth
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Minute))
	if err := conn.ReadJSON(&auth); err != nil {
		fail("No credentials received.")
		return
	}
	me := userFrom(r.Context())
	if me == nil {
		fail("Sign in and try again.")
		return
	}

	// A desktop is as privileged as a shell and the auditing middleware
	// can't see either, so it leaves the same trail as the terminal:
	// who, which guest, and how long it lasted. Deliberately after the
	// first frame — a socket that opens and says nothing is a page load,
	// not an attempt on a guest.
	//
	// The username is worth keeping and the password obviously is not:
	// unlike SSH, where the account IS the console's, this is whoever
	// they chose to be on that Windows box, and it's the only record
	// that connects the two.
	opened := time.Now()
	payload := ""
	if auth.Username != "" {
		payload = "as " + auth.Username
		if auth.Domain != "" {
			payload = "as " + auth.Domain + `\` + auth.Username
		}
	}
	dialCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	session, err := guac.Dial(dialCtx, s.guacdAddr, guac.Connection{
		Protocol: "rdp",
		Host:     inst.InternalIP,
		Port:     3389,
		Username: auth.Username,
		Password: auth.Password,
		Domain:   auth.Domain,
		Screen:   screenFrom(r),
	})
	if err != nil {
		s.log.Warn("rdp connect failed", "instance", inst.Name, "error", err)
		s.recordGuestAccess(r, guestAccessEntry{
			action: "instances.rdp.open", resource: inst.Name, payload: payload,
			at: opened, duration: time.Since(opened), err: err,
		})
		fail(err.Error())
		return
	}
	defer session.Close()
	s.recordGuestAccess(r, guestAccessEntry{
		action: "instances.rdp.open", resource: inst.Name, payload: payload,
		at: opened, duration: 0,
	})
	defer func() {
		s.recordGuestAccess(r, guestAccessEntry{
			action: "instances.rdp.close", resource: inst.Name, payload: payload,
			at: opened, duration: time.Since(opened),
		})
	}()

	// guacd → browser. Instructions are re-rendered rather than copied
	// verbatim: what arrives is framed by element, and re-encoding is
	// how a partially-read instruction can't be forwarded as a whole
	// one.
	// guacd → browser. Instructions are re-rendered rather than copied
	// verbatim: what arrives is framed by element, and re-encoding is
	// how a partially-read instruction can't be forwarded as a whole
	// one. No per-session tallying here any more — the audit rows carry
	// open/close/duration, and the ?debug readout on the page itself is
	// the instrument for a session that misbehaves.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			instruction, err := session.Read()
			if err != nil {
				return
			}
			if err := write(websocket.TextMessage, []byte(instruction.String())); err != nil {
				return
			}
		}
	}()

	// A desktop can sit untouched for a long time and a tunnel between
	// here and the browser is free to reap a socket that says nothing,
	// so the same ping the terminal uses keeps it alive.
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	go func() {
		for {
			select {
			case <-done:
				return
			case <-ping.C:
				if err := write(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	// browser → guacd, verbatim: the page is driving a session it can
	// already see, so there is nothing to inspect that it couldn't do
	// anyway.
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Time{})
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if err := session.Write(raw); err != nil {
			return
		}
	}
}

// screenFrom reads the window the page is opening into, with defaults
// that are a reasonable desktop rather than zero — guacd would take a
// zero literally.
func screenFrom(r *http.Request) guac.Screen {
	screen := guac.Screen{Width: defaultWidth, Height: defaultHeight, DPI: defaultDPI}
	q := r.URL.Query()
	if n, err := strconv.Atoi(strings.TrimSpace(q.Get("width"))); err == nil && n > 0 {
		screen.Width = min(n, 4096)
	}
	if n, err := strconv.Atoi(strings.TrimSpace(q.Get("height"))); err == nil && n > 0 {
		screen.Height = min(n, 2160)
	}
	if n, err := strconv.Atoi(strings.TrimSpace(q.Get("dpi"))); err == nil && n > 0 {
		screen.DPI = min(n, 300)
	}
	return screen
}
