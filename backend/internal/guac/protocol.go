// Package guac speaks the Guacamole protocol to guacd, the daemon that
// knows RDP and VNC.
//
// It exists so a desktop can reach the browser the way a terminal
// already does: browser, websocket, this console, guacd, guest. Go
// speaks no RDP and never will; guacd does, and it says what it sees in
// a stream of instructions simple enough to relay.
//
// THE WIRE FORMAT IS ONE RULE. An instruction is comma-separated
// elements terminated by a semicolon, and every element is its LENGTH
// IN CHARACTERS, a full stop, then the value:
//
//	4.size,4.1024,3.768,2.96;
//
// The length is measured in UNICODE CODE POINTS, not bytes — guacd
// counts characters — so a value with an accent in it is mis-framed by
// anything that reaches for len() on a Go string. That is the one place
// this is easy to get wrong and impossible to notice until somebody's
// password has a £ in it.
//
// THE HANDSHAKE IS OURS, NOT THE BROWSER'S. guacd is told which host to
// dial and with what credentials, and only the stream after that
// reaches the page. So the browser never learns the guest's address,
// and a page that is compromised cannot re-point the connection —
// which is the whole reason the parameters are assembled here rather
// than passed through.
package guac

import (
	"bufio"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

// ErrMalformed is a stream that isn't the protocol — usually something
// other than guacd on the far end of the address.
var ErrMalformed = errors.New("guac: malformed instruction")

// maxElement bounds one element, so a wrong port answering with an
// enormous number can't be asked to allocate it.
const maxElement = 1 << 20

// Instruction is one message: an opcode and its arguments.
type Instruction struct {
	Opcode string
	Args   []string
}

// String renders the instruction in the wire format.
func (i Instruction) String() string {
	var b strings.Builder
	write := func(s string) {
		// utf8.RuneCountInString, NOT len: the length is in characters.
		b.WriteString(strconv.Itoa(utf8.RuneCountInString(s)))
		b.WriteByte('.')
		b.WriteString(s)
	}
	write(i.Opcode)
	for _, a := range i.Args {
		b.WriteByte(',')
		write(a)
	}
	b.WriteByte(';')
	return b.String()
}

// Read decodes one instruction from r.
func Read(r *bufio.Reader) (Instruction, error) {
	var inst Instruction
	for {
		length, err := readLength(r)
		if err != nil {
			return inst, err
		}
		value, err := readRunes(r, length)
		if err != nil {
			return inst, err
		}
		if inst.Opcode == "" && len(inst.Args) == 0 {
			inst.Opcode = value
		} else {
			inst.Args = append(inst.Args, value)
		}
		sep, err := r.ReadByte()
		if err != nil {
			return inst, err
		}
		switch sep {
		case ',':
			continue
		case ';':
			return inst, nil
		default:
			return inst, fmt.Errorf("%w: expected , or ; after an element, got %q", ErrMalformed, sep)
		}
	}
}

func readLength(r *bufio.Reader) (int, error) {
	digits, err := r.ReadString('.')
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(strings.TrimSuffix(digits, "."))
	if err != nil || n < 0 || n > maxElement {
		return 0, fmt.Errorf("%w: %q is not an element length", ErrMalformed, digits)
	}
	return n, nil
}

// readRunes reads exactly n CHARACTERS, which is not n bytes.
func readRunes(r *bufio.Reader, n int) (string, error) {
	var b strings.Builder
	for i := 0; i < n; i++ {
		ch, _, err := r.ReadRune()
		if err != nil {
			return "", err
		}
		b.WriteRune(ch)
	}
	return b.String(), nil
}
