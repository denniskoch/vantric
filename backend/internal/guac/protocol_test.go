package guac

import (
	"bufio"
	"strings"
	"testing"
)

// THE LENGTH IS IN CHARACTERS, NOT BYTES, and this is the only place
// that can be checked cheaply. Everything works on ASCII, so a
// byte-counting bug ships green and surfaces the first time somebody's
// password has a £ in it or a hostname carries an accent — by which
// point the symptom is guacd hanging up on a stream it can't frame.
func TestLengthIsCharacters(t *testing.T) {
	cases := []struct {
		name string
		in   Instruction
		want string
	}{
		{"ascii", Instruction{Opcode: "size", Args: []string{"1024", "768", "96"}},
			"4.size,4.1024,3.768,2.96;"},
		{"no arguments", Instruction{Opcode: "nop"}, "3.nop;"},
		{"empty argument", Instruction{Opcode: "connect", Args: []string{""}}, "7.connect,0.;"},
		// £ is two bytes and one character; naive len() would say 9.
		{"multi-byte", Instruction{Opcode: "arg", Args: []string{"pa£w"}}, "3.arg,4.pa£w;"},
		// An emoji is four bytes and — for this protocol — one character.
		{"astral plane", Instruction{Opcode: "x", Args: []string{"🔒"}}, "1.x,1.🔒;"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.String(); got != tc.want {
				t.Fatalf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestReadRoundTrips(t *testing.T) {
	original := Instruction{Opcode: "connect", Args: []string{"10.0.0.5", "3389", "pa£w", ""}}
	got, err := Read(bufio.NewReader(strings.NewReader(original.String())))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.Opcode != original.Opcode {
		t.Fatalf("opcode = %q, want %q", got.Opcode, original.Opcode)
	}
	if len(got.Args) != len(original.Args) {
		t.Fatalf("args = %q, want %q", got.Args, original.Args)
	}
	for i := range got.Args {
		if got.Args[i] != original.Args[i] {
			t.Fatalf("arg %d = %q, want %q", i, got.Args[i], original.Args[i])
		}
	}
}

// Something other than guacd on the far end must be an error, not a
// hang or an allocation the size of whatever it sent.
func TestReadRejectsRubbish(t *testing.T) {
	for _, in := range []string{"hello;", "999999999999.x;", "-1.x;", "4.size|"} {
		if _, err := Read(bufio.NewReader(strings.NewReader(in))); err == nil {
			t.Fatalf("Read(%q) accepted it", in)
		}
	}
}
