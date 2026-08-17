package storage

import (
	"strings"
	"testing"
)

// "Is this bucket public" is the one question in this section where a
// wrong answer is expensive in the direction of silence, so the shapes
// are pinned. The documents here are real ones: the first is what RustFS
// stored and served back when a prefix was opened during development.
func TestAnalyzePolicy(t *testing.T) {
	cases := []struct {
		name     string
		doc      string
		public   bool
		listable bool
		writable bool
	}{
		{"no policy at all", "", false, false, false},
		{
			"anonymous read of a prefix",
			`{"Version":"2012-10-17","Statement":[{"Sid":"PublicRead","Effect":"Allow",
			  "Principal":{"AWS":["*"]},"Action":["s3:GetObject"],
			  "Resource":["arn:aws:s3:::lab-backups/public/*"]}]}`,
			true, false, false,
		},
		{
			// A named principal is not the public — this is the case that
			// must not raise a warning, or the warning stops meaning
			// anything.
			"named principal only",
			`{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
			  "Principal":{"AWS":["arn:aws:iam:::user/backups"]},"Action":["s3:GetObject"],
			  "Resource":["arn:aws:s3:::lab-backups/*"]}]}`,
			false, false, false,
		},
		{
			// Principal as a bare string rather than an object.
			"bare star principal",
			`{"Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject",
			  "Resource":"arn:aws:s3:::b/*"}]}`,
			true, false, false,
		},
		{
			"anonymous listing is called out separately",
			`{"Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},
			  "Action":["s3:GetObject","s3:ListBucket"],"Resource":["arn:aws:s3:::b","arn:aws:s3:::b/*"]}]}`,
			true, true, false,
		},
		{
			"anonymous write",
			`{"Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},
			  "Action":["s3:PutObject"],"Resource":["arn:aws:s3:::b/drop/*"]}]}`,
			true, false, true,
		},
		{
			// The most public a bucket gets, and the one a literal action
			// comparison would miss entirely.
			"wildcard action",
			`{"Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:*","Resource":"arn:aws:s3:::b/*"}]}`,
			true, true, true,
		},
		{
			"deny to everyone is not a public grant",
			`{"Statement":[{"Effect":"Deny","Principal":"*","Action":"s3:*","Resource":"arn:aws:s3:::b/*"}]}`,
			false, false, false,
		},
		{
			// Unreadable reports not-public and lets the document speak
			// for itself — see AnalyzePolicy.
			"unparseable", `{"Statement": not json`, false, false, false,
		},
	}
	for _, c := range cases {
		got := AnalyzePolicy([]byte(c.doc))
		if got.Public != c.public {
			t.Errorf("%s: Public = %v, want %v", c.name, got.Public, c.public)
		}
		listable, writable := false, false
		for _, g := range got.Grants {
			listable = listable || g.Listable
			writable = writable || g.Writable
		}
		if listable != c.listable {
			t.Errorf("%s: Listable = %v, want %v", c.name, listable, c.listable)
		}
		if writable != c.writable {
			t.Errorf("%s: Writable = %v, want %v", c.name, writable, c.writable)
		}
	}
}

func TestMatchesBucket(t *testing.T) {
	cases := []struct {
		resource string
		bucket   string
		want     bool
	}{
		{"arn:aws:s3:::*", "lab-backups", true},
		{"arn:aws:s3:::lab-backups", "lab-backups", true},
		{"arn:aws:s3:::lab-backups/*", "lab-backups", true},
		{"arn:aws:s3:::lab-backups/notes/*", "lab-backups", true},
		{"arn:aws:s3:::lab-*", "lab-backups", true},
		{"arn:aws:s3:::other", "lab-backups", false},
		// A prefix match must not run past the bucket segment: this ARN
		// is about a different bucket whose name merely starts the same.
		{"arn:aws:s3:::lab-backups-archive", "lab-backups", false},
		// Not an S3 ARN — the KMS policies this store ships with would
		// otherwise look like they granted bucket access.
		{"arn:aws:kms:::key/*", "lab-backups", false},
	}
	for _, c := range cases {
		if got := MatchesBucket(c.resource, c.bucket); got != c.want {
			t.Errorf("MatchesBucket(%q, %q) = %v, want %v", c.resource, c.bucket, got, c.want)
		}
	}
}

// Removing public access must remove exactly the public part. The risk
// worth testing is the opposite one: a console that "fixes" exposure by
// wiping a document somebody wrote by hand.
func TestWithoutPublic(t *testing.T) {
	mixed := `{"Version":"2012-10-17","Statement":[
	  {"Sid":"PublicRead","Effect":"Allow","Principal":{"AWS":["*"]},
	   "Action":["s3:GetObject"],"Resource":["arn:aws:s3:::b/public/*"]},
	  {"Sid":"NamedKey","Effect":"Allow","Principal":{"AWS":["arn:aws:iam:::user/backups"]},
	   "Action":["s3:GetObject","s3:PutObject"],"Resource":["arn:aws:s3:::b/*"],
	   "Condition":{"IpAddress":{"aws:SourceIp":"192.168.80.0/24"}}}]}`

	out, err := WithoutPublic([]byte(mixed))
	if err != nil {
		t.Fatalf("WithoutPublic: %v", err)
	}
	if AnalyzePolicy(out).Public {
		t.Error("still public after removing the public grant")
	}
	// The named statement survives, WITH the condition — a field these
	// structs never decode. Losing it would quietly widen an IP-limited
	// grant to everywhere.
	if !strings.Contains(string(out), "NamedKey") {
		t.Errorf("the named statement was dropped: %s", out)
	}
	if !strings.Contains(string(out), "192.168.80.0/24") {
		t.Errorf("a condition this code doesn't model was dropped: %s", out)
	}

	// A document whose only statement was public leaves nothing to keep,
	// and nil means "delete the policy" rather than "store an empty one".
	onlyPublic := `{"Statement":[{"Effect":"Allow","Principal":"*",
	  "Action":"s3:GetObject","Resource":"arn:aws:s3:::b/*"}]}`
	out, err = WithoutPublic([]byte(onlyPublic))
	if err != nil {
		t.Fatalf("WithoutPublic: %v", err)
	}
	if out != nil {
		t.Errorf("expected nil for a document with nothing left, got %s", out)
	}
}

func TestWithPublicRead(t *testing.T) {
	// Granting twice must not accumulate: what's public has to stay
	// answerable by looking at the document once.
	first, err := WithPublicRead(nil, "b", "public", false)
	if err != nil {
		t.Fatalf("WithPublicRead: %v", err)
	}
	second, err := WithPublicRead(first, "b", "share", false)
	if err != nil {
		t.Fatalf("WithPublicRead again: %v", err)
	}
	exposure := AnalyzePolicy(second)
	if len(exposure.Grants) != 1 {
		t.Fatalf("expected one public grant after re-granting, got %d: %s",
			len(exposure.Grants), second)
	}
	if got := exposure.Grants[0].Resources; len(got) != 1 || got[0] != "arn:aws:s3:::b/share/*" {
		t.Errorf("resources = %v, want the second prefix only", got)
	}
	if exposure.Grants[0].Listable {
		t.Error("a read grant must not make the bucket enumerable")
	}

	// Listing is granted on the BUCKET arn, not the object one — written
	// against "b/*" it would silently do nothing.
	withList, err := WithPublicRead(nil, "b", "public", true)
	if err != nil {
		t.Fatalf("WithPublicRead list: %v", err)
	}
	listed := AnalyzePolicy(withList)
	if !listed.Public {
		t.Fatal("not public")
	}
	found := false
	for _, g := range listed.Grants {
		if g.Listable {
			found = true
			if len(g.Resources) != 1 || g.Resources[0] != "arn:aws:s3:::b" {
				t.Errorf("list resource = %v, want the bare bucket ARN", g.Resources)
			}
		}
	}
	if !found {
		t.Error("asked for listing and got none")
	}
	// A prefixed grant confines the listing to that prefix, or opening one
	// folder would expose every key name in the bucket.
	if !strings.Contains(string(withList), "s3:prefix") {
		t.Errorf("prefixed listing was not confined: %s", withList)
	}

	// A hand-written statement is preserved through a grant.
	existing := `{"Statement":[{"Sid":"Mine","Effect":"Deny","Principal":"*",
	  "Action":"s3:DeleteObject","Resource":"arn:aws:s3:::b/*"}]}`
	merged, err := WithPublicRead([]byte(existing), "b", "", false)
	if err != nil {
		t.Fatalf("WithPublicRead merge: %v", err)
	}
	if !strings.Contains(string(merged), "Mine") {
		t.Errorf("an existing Deny was dropped: %s", merged)
	}
}
