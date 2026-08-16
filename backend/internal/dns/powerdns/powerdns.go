// Package powerdns implements dns.Provider against the PowerDNS
// Authoritative Server's HTTP API.
//
// PowerDNS has no per-record identity. Its unit is the RRSET — every
// record sharing a name and type, with ONE ttl for the set — and it is
// written by PATCHing the whole set at once. That is the same shape
// this console's UI already edits (see saveDNSRecordSet), but it is not
// the shape dns.Provider speaks: the interface addresses records one at
// a time, because Cloudflare does.
//
// So this driver bridges the two. Reads flatten rrsets into individual
// records under a synthetic id. Writes come in two flavours: the
// per-record methods the interface demands read the set, change the one
// record and PATCH it back, while SaveRecordSet — the dns.RecordSetWriter
// capability, which is what the record-set editor actually calls —
// writes the whole set in a single request and reads nothing first.
//
// The capability is not an optimisation. The per-record path reaches
// its end state through a SEQUENCE of writes, and PowerDNS validates
// each one: shrinking {a, b} to {b} is performed as "update a to b,
// then delete the spare", and the first step is a set holding b twice,
// which it rejects outright. Writing the set entire has no intermediate
// state to be wrong about.
//
// Two things remain true however a write arrives: a record's TTL is the
// SET's TTL, so editing one edits its siblings, and two simultaneous
// edits to one set are last-writer-wins.
package powerdns

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"vantric/internal/dns"
)

type Config struct {
	// BaseURL is the API root, e.g. http://192.168.80.4:8081. The
	// /api/v1 prefix is this driver's business, not the operator's.
	BaseURL string
	// APIKey goes in X-API-Key. PowerDNS has no notion of a user.
	APIKey string
	// ServerID is the API's server name, "localhost" on every
	// single-server install, which is all of them outside a hosting
	// provider.
	ServerID string
}

type Driver struct {
	cfg    Config
	client *http.Client
}

func New(cfg Config) *Driver {
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if cfg.ServerID == "" {
		cfg.ServerID = "localhost"
	}
	return &Driver{cfg: cfg, client: &http.Client{Timeout: 20 * time.Second}}
}

func (d *Driver) Type() string { return "powerdns" }

func (d *Driver) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.cfg.BaseURL+"/api/v1"+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", d.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == http.StatusNotFound {
		return dns.ErrNotFound
	}
	if resp.StatusCode >= 400 {
		return apiError(resp.StatusCode, raw)
	}
	if out == nil || len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// apiError names the two failures an operator can actually act on.
// PowerDNS answers 401 to a wrong key and to no key alike, and the
// bare status is the least useful thing to show for either.
func apiError(status int, raw []byte) error {
	var body struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(raw, &body)
	switch {
	case status == http.StatusUnauthorized:
		return fmt.Errorf("powerdns: the API key was rejected — check api-key in pdns.conf")
	case body.Error != "":
		return fmt.Errorf("powerdns: %s", body.Error)
	default:
		return fmt.Errorf("powerdns: request failed with status %d", status)
	}
}

// Verify proves the key AND the server id in one call: /servers is what
// an unauthenticated caller gets 401 from, and the named server is what
// every later path is built on.
func (d *Driver) Verify(ctx context.Context) error {
	var server struct {
		ID string `json:"id"`
	}
	if err := d.do(ctx, http.MethodGet, "/servers/"+url.PathEscape(d.cfg.ServerID), nil, &server); err != nil {
		if err == dns.ErrNotFound {
			return fmt.Errorf("powerdns: no server called %q — it is \"localhost\" on a standard install", d.cfg.ServerID)
		}
		return err
	}
	return nil
}

// Accounts is empty by design. PowerDNS carries an `account` string on
// each zone for provisioning tools to stamp, but there is nothing to
// enumerate and nothing that owns a zone — so reporting an empty list
// is the honest answer, not a missing feature.
func (d *Driver) Accounts(ctx context.Context) ([]dns.Account, error) {
	return []dns.Account{}, nil
}

type pdnsZone struct {
	ID      string      `json:"id"`
	Name    string      `json:"name"`
	Kind    string      `json:"kind"` // Native, Master, Slave
	Account string      `json:"account"`
	Serial  int64       `json:"serial"`
	DNSSEC  bool        `json:"dnssec"`
	Masters []string    `json:"masters"`
	RRsets  []pdnsRRset `json:"rrsets"`
}

type pdnsRRset struct {
	Name    string       `json:"name"`
	Type    string       `json:"type"`
	TTL     int          `json:"ttl"`
	Records []pdnsRecord `json:"records"`
}

type pdnsRecord struct {
	Content  string `json:"content"`
	Disabled bool   `json:"disabled"`
}

func (d *Driver) zonesPath() string {
	return "/servers/" + url.PathEscape(d.cfg.ServerID) + "/zones"
}

func (d *Driver) zonePath(zoneID string) string {
	return d.zonesPath() + "/" + url.PathEscape(zoneID)
}

// trimDot converts PowerDNS's canonical trailing-dot names to the bare
// names the rest of this app uses, since Cloudflare reports them bare
// and the UI shouldn't have to know which provider it's looking at.
func trimDot(name string) string { return strings.TrimSuffix(name, ".") }

func canonical(name string) string {
	if name == "" || strings.HasSuffix(name, ".") {
		return name
	}
	return name + "."
}

func (d *Driver) convertZone(z pdnsZone) dns.Zone {
	zone := dns.Zone{
		ID:   z.ID,
		Name: trimDot(z.Name),
		// A PowerDNS zone is served the moment it exists — there is no
		// pending state to wait through the way a hosted provider has,
		// so "active" is not a guess.
		Status: "active",
		// Type is left EMPTY rather than "full". Full-versus-partial is
		// a hosted-DNS product's answer to "who is authoritative for
		// this domain" — an authoritative server has no such setting,
		// and stamping one here would render as a confident statement
		// about a mode that does not exist.
		AccountName: z.Account,
	}
	for _, rr := range z.RRsets {
		if rr.Type == "NS" && trimDot(rr.Name) == trimDot(z.Name) {
			for _, rec := range rr.Records {
				zone.Nameservers = append(zone.Nameservers, trimDot(rec.Content))
			}
		}
	}
	return zone
}

func (d *Driver) Zones(ctx context.Context) ([]dns.Zone, error) {
	var zones []pdnsZone
	if err := d.do(ctx, http.MethodGet, d.zonesPath(), nil, &zones); err != nil {
		return nil, err
	}
	out := make([]dns.Zone, 0, len(zones))
	for _, z := range zones {
		out = append(out, d.convertZone(z))
	}
	return out, nil
}

// Zone reads one zone. Unlike the listing this includes rrsets, which
// is where the nameservers come from.
func (d *Driver) Zone(ctx context.Context, zoneID string) (*dns.Zone, error) {
	var z pdnsZone
	if err := d.do(ctx, http.MethodGet, d.zonePath(zoneID), nil, &z); err != nil {
		return nil, err
	}
	zone := d.convertZone(z)
	return &zone, nil
}

// recordID is the synthetic handle this driver hands out for a record
// PowerDNS itself cannot address.
//
// It encodes the three things needed to find that record again inside
// its set — name, type, content — because there is no server-side id to
// remember. Base64 because it travels in a URL path, and one field
// (a TXT value, an SPF record) can contain anything at all.
func recordID(name, rtype, content string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(name + "\x00" + rtype + "\x00" + content))
}

func parseRecordID(id string) (name, rtype, content string, err error) {
	raw, decodeErr := base64.RawURLEncoding.DecodeString(id)
	if decodeErr != nil {
		return "", "", "", fmt.Errorf("powerdns: unreadable record id")
	}
	parts := strings.SplitN(string(raw), "\x00", 3)
	if len(parts) != 3 {
		return "", "", "", fmt.Errorf("powerdns: unreadable record id")
	}
	return parts[0], parts[1], parts[2], nil
}

// PowerDNS keeps MX and SRV priority INSIDE the content ("10 mail.")
// where Cloudflare has a separate field. splitPriority and joinPriority
// are the two halves of that translation; getting it wrong would make
// every MX record read as a hostname beginning with a number.
func splitPriority(rtype, content string) (int, string) {
	if rtype != "MX" && rtype != "SRV" {
		return 0, content
	}
	first, rest, found := strings.Cut(content, " ")
	if !found {
		return 0, content
	}
	priority, err := strconv.Atoi(first)
	if err != nil {
		return 0, content
	}
	return priority, rest
}

func joinPriority(rtype, content string, priority int) string {
	if rtype != "MX" && rtype != "SRV" {
		return content
	}
	// A value that already leads with a priority is what somebody
	// typed, and wins over the separate field — otherwise "10 mail."
	// pasted into the box would come back as "10 10 mail.".
	if _, rest := splitPriority(rtype, content); rest != content {
		return content
	}
	return strconv.Itoa(priority) + " " + content
}

// hostnameContent is the record types whose VALUE is a domain name.
// PowerDNS stores those fully qualified and REFUSES a relative one —
// "Not in expected format" — where Cloudflare takes either and every
// other provider this app might grow will have its own opinion. So the
// dot is added on the way out and removed on the way in, and the rest
// of the app never sees it.
//
// TXT is deliberately absent: its value is free text that may end in a
// dot meaning nothing at all.
var hostnameContent = map[string]bool{
	"CNAME": true, "NS": true, "PTR": true, "DNAME": true, "ALIAS": true,
}

// canonicalContent qualifies the hostname inside a value. MX and SRV
// carry theirs after a priority (and, for SRV, a weight and port), so
// the name is the last field rather than the whole string.
func canonicalContent(rtype, content string) string {
	if hostnameContent[rtype] {
		return canonical(content)
	}
	fields := strings.Fields(content)
	switch {
	case rtype == "MX" && len(fields) == 2, rtype == "SRV" && len(fields) == 4:
		fields[len(fields)-1] = canonical(fields[len(fields)-1])
		return strings.Join(fields, " ")
	}
	return content
}

// displayContent is canonicalContent's inverse, so a value written here
// reads back the way it was typed.
//
// It counts fields more loosely than canonicalContent does, because it
// runs AFTER splitPriority has taken the priority off the front: an MX
// arrives here as "mail.example." rather than "10 mail.example.". The
// hostname is the last field either way, which is the only thing this
// needs to be sure of.
func displayContent(rtype, content string) string {
	if hostnameContent[rtype] {
		return trimDot(content)
	}
	if rtype == "MX" || rtype == "SRV" {
		if fields := strings.Fields(content); len(fields) > 0 {
			fields[len(fields)-1] = trimDot(fields[len(fields)-1])
			return strings.Join(fields, " ")
		}
	}
	return content
}

// SaveRecordSet writes a whole set in ONE request — the capability that
// exists because PowerDNS's unit is the set. Nothing is read first: the
// spec is the complete contents, so there is no merge to get wrong and
// no intermediate state for the server to reject.
func (d *Driver) SaveRecordSet(ctx context.Context, zoneID string, spec dns.RecordSetSpec) ([]dns.Record, error) {
	set := pdnsRRset{
		Name: canonical(spec.Name),
		Type: spec.Type,
		TTL:  ttlOrDefault(spec.TTL),
	}
	records := []dns.Record{}
	seen := map[string]bool{}
	for _, value := range spec.Values {
		content := canonicalContent(spec.Type,
			joinPriority(spec.Type, strings.TrimSpace(value.Content), value.Priority))
		// PowerDNS rejects the whole PATCH over a repeated value, which
		// would turn one duplicated row in the editor into an error
		// about the set as a whole.
		if seen[content] {
			continue
		}
		seen[content] = true
		set.Records = append(set.Records, pdnsRecord{Content: content})
		priority, bare := splitPriority(spec.Type, content)
		records = append(records, dns.Record{
			ID:       recordID(set.Name, spec.Type, content),
			Name:     trimDot(set.Name),
			Type:     spec.Type,
			Content:  displayContent(spec.Type, bare),
			TTL:      set.TTL,
			Priority: priority,
		})
	}
	if len(set.Records) == 0 {
		return nil, fmt.Errorf("powerdns: a record set needs at least one value")
	}
	if err := d.patch(ctx, zoneID, set, false); err != nil {
		return nil, err
	}
	return records, nil
}

func (d *Driver) Records(ctx context.Context, zoneID string) ([]dns.Record, error) {
	var z pdnsZone
	if err := d.do(ctx, http.MethodGet, d.zonePath(zoneID), nil, &z); err != nil {
		return nil, err
	}
	records := []dns.Record{}
	for _, rr := range z.RRsets {
		for _, rec := range rr.Records {
			priority, content := splitPriority(rr.Type, rec.Content)
			records = append(records, dns.Record{
				ID:       recordID(rr.Name, rr.Type, rec.Content),
				Name:     trimDot(rr.Name),
				Type:     rr.Type,
				Content:  displayContent(rr.Type, content),
				TTL:      rr.TTL,
				Priority: priority,
			})
		}
	}
	return records, nil
}

// rrset reads one set. Absent is not an error here: creating the first
// record of a name/type is exactly the case where there is no set yet.
func (d *Driver) rrset(ctx context.Context, zoneID, name, rtype string) (*pdnsRRset, error) {
	var z pdnsZone
	if err := d.do(ctx, http.MethodGet, d.zonePath(zoneID), nil, &z); err != nil {
		return nil, err
	}
	for _, rr := range z.RRsets {
		if rr.Name == canonical(name) && rr.Type == rtype {
			found := rr
			return &found, nil
		}
	}
	return nil, nil
}

// patch writes one rrset. REPLACE sends the set's complete contents, so
// every caller here reads before it writes; an empty record list is how
// PowerDNS is told to delete the set.
func (d *Driver) patch(ctx context.Context, zoneID string, set pdnsRRset, delete bool) error {
	type change struct {
		Name       string       `json:"name"`
		Type       string       `json:"type"`
		TTL        int          `json:"ttl,omitempty"`
		ChangeType string       `json:"changetype"`
		Records    []pdnsRecord `json:"records"`
	}
	c := change{
		Name:       canonical(set.Name),
		Type:       set.Type,
		TTL:        set.TTL,
		ChangeType: "REPLACE",
		Records:    set.Records,
	}
	if delete || len(set.Records) == 0 {
		c.ChangeType = "DELETE"
		c.Records = nil
		c.TTL = 0
	}
	body := map[string]any{"rrsets": []change{c}}
	return d.do(ctx, http.MethodPatch, d.zonePath(zoneID), body, nil)
}

// defaultTTL is what a record gets when the caller doesn't say. 1 is
// Cloudflare's "automatic" sentinel and a legal-but-absurd one second
// here, so it is translated rather than passed through.
const defaultTTL = 3600

func ttlOrDefault(ttl int) int {
	if ttl <= 1 {
		return defaultTTL
	}
	return ttl
}

func (d *Driver) CreateRecord(ctx context.Context, zoneID string, spec dns.RecordSpec) (*dns.Record, error) {
	content := canonicalContent(spec.Type, joinPriority(spec.Type, spec.Content, spec.Priority))
	set, err := d.rrset(ctx, zoneID, spec.Name, spec.Type)
	if err != nil {
		return nil, err
	}
	if set == nil {
		set = &pdnsRRset{Name: canonical(spec.Name), Type: spec.Type}
	}
	for _, rec := range set.Records {
		if rec.Content == content {
			return nil, fmt.Errorf("powerdns: %s %s already has the value %q", trimDot(spec.Name), spec.Type, spec.Content)
		}
	}
	// One TTL for the set: a new record's TTL applies to its siblings
	// too, so an unspecified one must not quietly reset theirs.
	if spec.TTL > 1 || set.TTL == 0 {
		set.TTL = ttlOrDefault(spec.TTL)
	}
	set.Records = append(set.Records, pdnsRecord{Content: content})
	if err := d.patch(ctx, zoneID, *set, false); err != nil {
		return nil, err
	}
	return &dns.Record{
		ID:       recordID(canonical(spec.Name), spec.Type, content),
		Name:     trimDot(spec.Name),
		Type:     spec.Type,
		Content:  spec.Content,
		TTL:      set.TTL,
		Priority: spec.Priority,
	}, nil
}

func (d *Driver) UpdateRecord(ctx context.Context, zoneID, id string, spec dns.RecordSpec) (*dns.Record, error) {
	oldName, oldType, oldContent, err := parseRecordID(id)
	if err != nil {
		return nil, err
	}
	// A changed name or type moves the record between sets, which is a
	// delete and a create rather than an edit — PowerDNS has no way to
	// express it as one operation.
	if canonical(spec.Name) != oldName || spec.Type != oldType {
		if err := d.DeleteRecord(ctx, zoneID, id); err != nil {
			return nil, err
		}
		return d.CreateRecord(ctx, zoneID, spec)
	}

	set, err := d.rrset(ctx, zoneID, oldName, oldType)
	if err != nil {
		return nil, err
	}
	if set == nil {
		return nil, dns.ErrNotFound
	}
	content := canonicalContent(spec.Type, joinPriority(spec.Type, spec.Content, spec.Priority))
	replaced := false
	for i, rec := range set.Records {
		if rec.Content == oldContent {
			set.Records[i].Content = content
			replaced = true
			break
		}
	}
	if !replaced {
		return nil, dns.ErrNotFound
	}
	if spec.TTL > 1 {
		set.TTL = spec.TTL
	}
	if err := d.patch(ctx, zoneID, *set, false); err != nil {
		return nil, err
	}
	return &dns.Record{
		ID:       recordID(oldName, oldType, content),
		Name:     trimDot(oldName),
		Type:     oldType,
		Content:  spec.Content,
		TTL:      set.TTL,
		Priority: spec.Priority,
	}, nil
}

func (d *Driver) DeleteRecord(ctx context.Context, zoneID, id string) error {
	name, rtype, content, err := parseRecordID(id)
	if err != nil {
		return err
	}
	set, err := d.rrset(ctx, zoneID, name, rtype)
	if err != nil {
		return err
	}
	if set == nil {
		return dns.ErrNotFound
	}
	kept := make([]pdnsRecord, 0, len(set.Records))
	for _, rec := range set.Records {
		if rec.Content != content {
			kept = append(kept, rec)
		}
	}
	if len(kept) == len(set.Records) {
		return dns.ErrNotFound
	}
	set.Records = kept
	// An emptied set is deleted rather than written empty, which
	// PowerDNS would reject.
	return d.patch(ctx, zoneID, *set, len(kept) == 0)
}

func (d *Driver) CreateZone(ctx context.Context, spec dns.ZoneSpec) (*dns.Zone, error) {
	// Native is the right default for a lab: it serves the zone without
	// expecting AXFR peers, where Master would advertise transfers to
	// secondaries that don't exist.
	body := map[string]any{
		"name": canonical(spec.Name),
		"kind": "Native",
	}
	if spec.AccountID != "" {
		body["account"] = spec.AccountID
	}
	var z pdnsZone
	if err := d.do(ctx, http.MethodPost, d.zonesPath(), body, &z); err != nil {
		return nil, err
	}
	zone := d.convertZone(z)
	return &zone, nil
}

func (d *Driver) DeleteZone(ctx context.Context, zoneID string) error {
	return d.do(ctx, http.MethodDelete, d.zonePath(zoneID), nil, nil)
}
