package dns

import (
	"fmt"
	"strconv"
	"strings"
)

// The start-of-authority record, taken apart.
//
// SOA is the one record type that carries seven fields in a single
// string, which is why it is not in the app's editable types: run
// through a plain text box it is seven chances to shift a value one
// place left and change how long the internet caches a failure. Parsed
// here, each field gets a name and its own validation.

// SOA is a zone's start-of-authority record.
type SOA struct {
	// PrimaryNS is the MNAME — the server that holds the master copy.
	PrimaryNS string `json:"primaryNs"`
	// Hostmaster is the RNAME as an EMAIL ADDRESS. On the wire it is a
	// domain name with the @ replaced by a dot, which is the single
	// most misread field in DNS, so the conversion happens here and
	// the rest of the app deals in addresses.
	Hostmaster string `json:"hostmaster"`
	Serial     int64  `json:"serial"`
	// Refresh, Retry and Expire govern secondaries; NegativeTTL is how
	// long a resolver caches "no such name", which is the one that
	// bites when a record is added and the world can't see it yet.
	Refresh     int `json:"refresh"`
	Retry       int `json:"retry"`
	Expire      int `json:"expire"`
	NegativeTTL int `json:"negativeTtl"`
	TTL         int `json:"ttl"`
	// Placeholder reports that the server filled this in rather than a
	// person — see placeholderNS.
	Placeholder bool `json:"placeholder"`
}

// placeholderNS reports a primary nameserver that means "nobody set
// this". PowerDNS writes a.misconfigured.dns.server.invalid into every
// zone it creates, and .invalid is the TLD RFC 2606 reserves for
// exactly this purpose — so the test is the reserved suffix rather
// than one server's particular wording.
func placeholderNS(name string) bool {
	trimmed := strings.ToLower(strings.TrimSuffix(name, "."))
	return trimmed == "" || strings.HasSuffix(trimmed, ".invalid")
}

// ParseSOA takes apart the seven-field content of an SOA record.
func ParseSOA(content string, ttl int) (*SOA, error) {
	fields := strings.Fields(content)
	if len(fields) != 7 {
		return nil, fmt.Errorf("dns: SOA record has %d fields, expected 7", len(fields))
	}
	numbers := make([]int64, 5)
	for i, raw := range fields[2:] {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("dns: SOA field %q is not a number", raw)
		}
		numbers[i] = n
	}
	return &SOA{
		PrimaryNS:   strings.TrimSuffix(fields[0], "."),
		Hostmaster:  rnameToEmail(fields[1]),
		Serial:      numbers[0],
		Refresh:     int(numbers[1]),
		Retry:       int(numbers[2]),
		Expire:      int(numbers[3]),
		NegativeTTL: int(numbers[4]),
		TTL:         ttl,
		Placeholder: placeholderNS(fields[0]),
	}, nil
}

// Content renders the record back to its wire form. Names are written
// fully qualified: a relative one would be taken as relative to the
// zone and silently name something else.
func (s SOA) Content() string {
	return fmt.Sprintf("%s %s %d %d %d %d %d",
		qualify(s.PrimaryNS), qualify(emailToRname(s.Hostmaster)),
		s.Serial, s.Refresh, s.Retry, s.Expire, s.NegativeTTL)
}

func qualify(name string) string {
	if name == "" || strings.HasSuffix(name, ".") {
		return name
	}
	return name + "."
}

// rnameToEmail converts the SOA's domain-encoded mailbox to an address.
// The local part's own dots are escaped on the wire (`first\.last`), so
// the split is at the first UNESCAPED dot rather than the first dot.
func rnameToEmail(rname string) string {
	name := strings.TrimSuffix(rname, ".")
	var local strings.Builder
	for i := 0; i < len(name); i++ {
		switch {
		case name[i] == '\\' && i+1 < len(name):
			local.WriteByte(name[i+1])
			i++
		case name[i] == '.':
			return local.String() + "@" + name[i+1:]
		default:
			local.WriteByte(name[i])
		}
	}
	// No dot at all: not an address this can make sense of, so it is
	// handed back untouched rather than turned into something wrong.
	return name
}

func emailToRname(email string) string {
	local, domain, found := strings.Cut(email, "@")
	if !found {
		return email
	}
	return strings.ReplaceAll(local, ".", `\.`) + "." + domain
}

// Validate checks the fields a person can get wrong. The timers are
// bounded rather than merely positive: a refresh of 10 seconds asks
// every secondary to hammer the primary forever, and a negative TTL of
// a week means a typo stays visible for a week after it's fixed.
func (s SOA) Validate() error {
	if s.PrimaryNS == "" {
		return fmt.Errorf("a primary nameserver is required")
	}
	if placeholderNS(s.PrimaryNS) {
		return fmt.Errorf("%q is a placeholder, not a nameserver", s.PrimaryNS)
	}
	if !strings.Contains(s.Hostmaster, "@") {
		return fmt.Errorf("the hostmaster must be an email address")
	}
	if s.Serial < 0 || s.Serial > 4294967295 {
		return fmt.Errorf("the serial must be between 0 and 4294967295")
	}
	for _, check := range []struct {
		name      string
		value     int
		low, high int
	}{
		{"refresh", s.Refresh, 60, 86400},
		{"retry", s.Retry, 60, 86400},
		{"expire", s.Expire, 3600, 2419200},
		{"negative TTL", s.NegativeTTL, 60, 86400},
	} {
		if check.value < check.low || check.value > check.high {
			return fmt.Errorf("%s must be between %d and %d seconds", check.name, check.low, check.high)
		}
	}
	if s.Expire <= s.Refresh {
		return fmt.Errorf("expire must be longer than refresh, or a secondary gives up before it retries")
	}
	return nil
}
