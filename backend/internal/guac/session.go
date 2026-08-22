package guac

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strconv"
	"time"
)

// Screen is what the browser says it can show, which guacd needs before
// it connects: RDP negotiates a resolution at session start.
type Screen struct {
	Width  int
	Height int
	DPI    int
}

// Connection is a guest to reach and how.
//
// Credentials live here and nowhere else: they arrive on the socket's
// first frame, are used for this handshake, and are not written down.
type Connection struct {
	// Protocol is "rdp" or "vnc".
	Protocol string
	Host     string
	Port     int
	Username string
	Password string
	Domain   string
	Screen   Screen
}

// parameters maps a connection onto the argument names guacd asks for.
//
// GUACD DICTATES THE ORDER, not this map: the handshake answers with
// the names it wants and `connect` must supply values in exactly that
// order. So this is a lookup and the ordering is done at connect time —
// hardcoding a list would work until a guacd release inserted an
// argument, and then it would silently send the password as the
// hostname.
func (c Connection) parameters() map[string]string {
	p := map[string]string{
		"hostname": c.Host,
		"port":     strconv.Itoa(c.Port),
		"username": c.Username,
		"password": c.Password,
		"domain":   c.Domain,
		// A lab's Windows guests use self-signed certificates, which is
		// what a lab's Windows guests do. Refusing them would make this
		// work nowhere; the connection is already inside the LAN and
		// the console reached the guest through its own network.
		"ignore-cert": "true",
		// Let the desktop follow the browser window rather than fixing
		// the resolution at connect time.
		"resize-method": "display-update",
	}
	if c.Protocol == "rdp" {
		// "any" lets guacd negotiate rather than insisting on a security
		// mode the guest may not offer. NLA is the usual answer and is
		// what "any" lands on where it's available.
		p["security"] = "any"
	}
	return p
}

// Session is an open connection to guacd, after the handshake.
type Session struct {
	conn net.Conn
	in   *bufio.Reader
}

// Dial connects to guacd and performs the handshake, so that what the
// caller gets back is a stream ready to relay.
//
// The FIRST instruction the caller will read is guacd's `ready`, which
// is what the browser's client expects to see first — everything before
// it is this console's business.
func Dial(ctx context.Context, addr string, c Connection) (*Session, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("guac: reaching guacd at %s: %w", addr, err)
	}
	s := &Session{conn: conn, in: bufio.NewReaderSize(conn, 64*1024)}

	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	}

	if err := s.send(Instruction{Opcode: "select", Args: []string{c.Protocol}}); err != nil {
		s.Close()
		return nil, err
	}
	args, err := s.expect("args")
	if err != nil {
		s.Close()
		return nil, err
	}

	if err := s.send(Instruction{Opcode: "size", Args: []string{
		strconv.Itoa(c.Screen.Width), strconv.Itoa(c.Screen.Height), strconv.Itoa(c.Screen.DPI),
	}}); err != nil {
		s.Close()
		return nil, err
	}
	// Announced empty: this console proxies a screen, not sound or
	// video, and claiming support for a codec nothing will decode is how
	// you get a session that plays silence very efficiently.
	for _, opcode := range []string{"audio", "video", "image"} {
		if err := s.send(Instruction{Opcode: opcode}); err != nil {
			s.Close()
			return nil, err
		}
	}

	// Values in guacd's order, blank for anything it asked for that this
	// console has no opinion about — a missing element would shift every
	// later one by a place.
	params := c.parameters()
	values := make([]string, len(args.Args))
	for i, name := range args.Args {
		values[i] = params[name]
	}
	if err := s.send(Instruction{Opcode: "connect", Args: values}); err != nil {
		s.Close()
		return nil, err
	}

	// The deadline was for the handshake. A desktop session is idle for
	// minutes at a time and must not be reaped for it.
	_ = conn.SetDeadline(time.Time{})
	return s, nil
}

func (s *Session) send(i Instruction) error {
	if _, err := s.conn.Write([]byte(i.String())); err != nil {
		return fmt.Errorf("guac: writing %s: %w", i.Opcode, err)
	}
	return nil
}

// expect reads until the named opcode arrives, so a guacd that logs
// something first doesn't derail the handshake.
func (s *Session) expect(opcode string) (Instruction, error) {
	for {
		inst, err := Read(s.in)
		if err != nil {
			return inst, fmt.Errorf("guac: waiting for %s: %w", opcode, err)
		}
		switch inst.Opcode {
		case opcode:
			return inst, nil
		case "error":
			return inst, fmt.Errorf("guac: %s", errorText(inst))
		}
	}
}

// Read returns the next instruction from guacd.
func (s *Session) Read() (Instruction, error) { return Read(s.in) }

// Write sends an instruction the browser produced. It is relayed
// VERBATIM: the browser is driving a session it can already see, so
// there is nothing here to inspect that it couldn't do anyway.
func (s *Session) Write(raw []byte) error {
	_, err := s.conn.Write(raw)
	return err
}

func (s *Session) Close() error { return s.conn.Close() }

// errorText pulls the human half out of guacd's error instruction,
// which carries a message and a status code.
func errorText(inst Instruction) string {
	if len(inst.Args) > 0 && inst.Args[0] != "" {
		return inst.Args[0]
	}
	return "the desktop gateway refused the connection"
}
