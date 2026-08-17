package dns

import "testing"

// The SOA's mailbox field is a domain name standing in for an email
// address, and getting it wrong produces something that still looks
// like a valid record — which is why this is one of the repo's tests
// rather than something checked by eye.
func TestSOAHostmasterRoundTrip(t *testing.T) {
	cases := []struct {
		rname string
		email string
	}{
		{"hostmaster.lab.example.", "hostmaster@lab.example"},
		{"admin.example.com.", "admin@example.com"},
		// An escaped dot is part of the LOCAL part, not a separator.
		{`first\.last.example.com.`, "first.last@example.com"},
		// No dot at all isn't an address; it comes back untouched
		// rather than becoming one.
		{"hostmaster", "hostmaster"},
	}
	for _, c := range cases {
		if got := rnameToEmail(c.rname); got != c.email {
			t.Errorf("rnameToEmail(%q) = %q, want %q", c.rname, got, c.email)
		}
		if c.email == "hostmaster" {
			continue
		}
		if got := emailToRname(c.email); got != trimDot(c.rname) {
			t.Errorf("emailToRname(%q) = %q, want %q", c.email, got, trimDot(c.rname))
		}
	}
}

func trimDot(s string) string {
	if len(s) > 0 && s[len(s)-1] == '.' {
		return s[:len(s)-1]
	}
	return s
}

func TestParseSOA(t *testing.T) {
	// The record PowerDNS writes into every zone it creates.
	const placeholder = "a.misconfigured.dns.server.invalid. hostmaster.80.168.192.in-addr.arpa. 2026081601 10800 3600 604800 3600"
	soa, err := ParseSOA(placeholder, 3600)
	if err != nil {
		t.Fatalf("ParseSOA: %v", err)
	}
	if soa.Serial != 2026081601 || soa.Refresh != 10800 || soa.NegativeTTL != 3600 {
		t.Errorf("numbers parsed wrong: %+v", soa)
	}
	if soa.Hostmaster != "hostmaster@80.168.192.in-addr.arpa" {
		t.Errorf("hostmaster = %q", soa.Hostmaster)
	}
	// .invalid is reserved to mean exactly this, and reporting it is
	// the whole point of parsing the record.
	if !soa.Placeholder {
		t.Error("a .invalid primary nameserver should read as a placeholder")
	}

	real, err := ParseSOA("ns1.lab.example. hostmaster.lab.example. 1 10800 3600 604800 3600", 3600)
	if err != nil {
		t.Fatalf("ParseSOA: %v", err)
	}
	if real.Placeholder {
		t.Error("a real nameserver should not read as a placeholder")
	}
	if got := real.Content(); got != "ns1.lab.example. hostmaster.lab.example. 1 10800 3600 604800 3600" {
		t.Errorf("Content() = %q", got)
	}

	if _, err := ParseSOA("too few fields", 3600); err == nil {
		t.Error("expected an error for a malformed record")
	}
}
