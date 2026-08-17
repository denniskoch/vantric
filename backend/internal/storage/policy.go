package storage

import (
	"encoding/json"
	"strings"
)

// Reading IAM policy documents.
//
// This lives on the boundary rather than in a driver because the format
// is S3's, not any one store's — every S3-compatible store speaks the
// same document, so a second driver gets this for free and, more to the
// point, gets the SAME ANSWER. "Is this bucket public" deciding
// differently per backend would be worse than not asking.

// policyDocument is the parts of a policy this needs. Action, Resource
// and Principal are each "a string or a list of strings" in this format,
// so they arrive as RawMessage: a typed decode fails WHOLE on the
// single-string form, and a policy that fails to parse would be reported
// as a bucket with no policy — the exact inverse of the truth, on the
// one question where being wrong is expensive.
type policyDocument struct {
	Statement []statement `json:"Statement"`
}

type statement struct {
	Sid       string          `json:"Sid"`
	Effect    string          `json:"Effect"`
	Principal json.RawMessage `json:"Principal"`
	Action    json.RawMessage `json:"Action"`
	Resource  json.RawMessage `json:"Resource"`
}

// AnalyzePolicy reports what a bucket policy opens to anonymous callers.
//
// A document that can't be parsed reports NOT public, and that is a
// deliberate choice rather than a shrug: the UI pairs this with the
// document itself, so an unreadable policy is visible as one, where
// claiming "public" about a document nobody could read would be a
// warning that never goes away.
func AnalyzePolicy(document json.RawMessage) Exposure {
	out := Exposure{Grants: []Grant{}}
	if len(document) == 0 {
		return out
	}
	var doc policyDocument
	if err := json.Unmarshal(document, &doc); err != nil {
		return out
	}
	for _, st := range doc.Statement {
		if !strings.EqualFold(st.Effect, "Allow") || !anonymous(st.Principal) {
			continue
		}
		actions := stringOrList(st.Action)
		grant := Grant{
			Sid:       st.Sid,
			Actions:   actions,
			Resources: stringOrList(st.Resource),
		}
		// Deliberately not a switch: one action can be both. "s3:*"
		// matches every case here, and a switch would set the first flag
		// and stop — reporting the most public policy there is as
		// readable-but-not-writable.
		for _, action := range actions {
			if matchAction(action, "s3:ListBucket") {
				grant.Listable = true
			}
			if matchAction(action, "s3:PutObject") || matchAction(action, "s3:DeleteObject") {
				grant.Writable = true
			}
		}
		out.Public = true
		out.Grants = append(out.Grants, grant)
	}
	return out
}

// anonymous reports whether a statement's principal is everyone.
//
// The field has three shapes in the wild — "*", {"AWS": "*"} and
// {"AWS": ["*", …]} — and a store rewrites between them freely, so all
// three are checked rather than the one a particular store happened to
// return the day this was written.
func anonymous(principal json.RawMessage) bool {
	if len(principal) == 0 {
		return false
	}
	var direct string
	if json.Unmarshal(principal, &direct) == nil {
		return direct == "*"
	}
	var wrapped map[string]json.RawMessage
	if json.Unmarshal(principal, &wrapped) != nil {
		return false
	}
	for _, value := range wrapped {
		for _, who := range stringOrList(value) {
			if who == "*" {
				return true
			}
		}
	}
	return false
}

// matchAction handles the wildcards IAM allows in an action, so that
// "s3:*" and "s3:Get*" are recognised rather than compared literally —
// a policy granting s3:* to everyone is the most public a bucket gets
// and must not read as "no matching action".
func matchAction(pattern, action string) bool {
	if pattern == "*" {
		return true
	}
	if !strings.Contains(pattern, "*") {
		return strings.EqualFold(pattern, action)
	}
	prefix, _, _ := strings.Cut(pattern, "*")
	return strings.HasPrefix(strings.ToLower(action), strings.ToLower(prefix))
}

// MatchesBucket reports whether a resource ARN covers the named bucket.
// Used to answer "which access keys can reach this bucket" from the
// policies attached to them.
func MatchesBucket(resource, bucket string) bool {
	const prefix = "arn:aws:s3:::"
	target, ok := strings.CutPrefix(resource, prefix)
	if !ok {
		// Not an S3 ARN at all — a policy naming KMS keys says nothing
		// about a bucket.
		return false
	}
	// The bucket part is everything before the first "/", which separates
	// the bucket from the object path.
	name, _, _ := strings.Cut(target, "/")
	if name == "*" || name == "" {
		return true
	}
	if strings.HasSuffix(name, "*") {
		return strings.HasPrefix(bucket, strings.TrimSuffix(name, "*"))
	}
	return name == bucket
}

// stringOrList decodes IAM's "either one or many" shape.
func stringOrList(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var one string
	if json.Unmarshal(raw, &one) == nil {
		return []string{one}
	}
	var many []string
	if json.Unmarshal(raw, &many) == nil {
		return many
	}
	return nil
}

// --- editing the anonymous half of a policy ---
//
// These deliberately don't offer "edit the document". A bucket policy
// can express far more than this console should ask anybody to compose
// in a text box, and that composition is the deep, rare configuration
// that stays in the tool. What the console owns is the one question it
// can answer better than anything else: is this open to the world, and
// make it stop.
//
// Statements this console didn't write are carried through VERBATIM, as
// raw JSON — decoding and re-encoding them would quietly drop any field
// these structs don't know about, which for a permissions document is
// not a rounding error.

// rawDocument keeps every statement as it was written.
type rawDocument struct {
	Version   string            `json:"Version"`
	Statement []json.RawMessage `json:"Statement"`
	// ID is Aws's optional document identifier, kept if present.
	ID string `json:"Id,omitempty"`
}

// WithoutPublic strips every anonymous Allow. It returns nil when
// nothing is left to keep, which means "remove the policy entirely"
// rather than "write an empty one" — a policy with no statements is a
// document the store has no reason to hold.
func WithoutPublic(document json.RawMessage) (json.RawMessage, error) {
	if len(document) == 0 {
		return nil, nil
	}
	var doc rawDocument
	if err := json.Unmarshal(document, &doc); err != nil {
		return nil, err
	}
	kept := make([]json.RawMessage, 0, len(doc.Statement))
	for _, raw := range doc.Statement {
		var st statement
		// A statement that won't parse is KEPT. It can't be shown to be
		// public, and silently deleting part of a permissions document
		// because this code couldn't read it is the worse failure.
		if err := json.Unmarshal(raw, &st); err != nil {
			kept = append(kept, raw)
			continue
		}
		if strings.EqualFold(st.Effect, "Allow") && anonymous(st.Principal) {
			continue
		}
		kept = append(kept, raw)
	}
	if len(kept) == 0 {
		return nil, nil
	}
	doc.Statement = kept
	if doc.Version == "" {
		doc.Version = policyVersion
	}
	return json.Marshal(doc)
}

// policyVersion is IAM's, and is a date rather than a version number —
// the only value any of these stores accepts.
const policyVersion = "2012-10-17"

// WithPublicRead returns the document with anonymous read of one prefix.
//
// It REPLACES any existing anonymous grant rather than adding to it, the
// same rule the database section's grants follow: if opening a second
// path also had to mean remembering the first, "what is public" would
// stop being answerable by looking. Everything with a named principal is
// left alone.
//
// prefix is a key prefix within the bucket, or empty for the whole
// bucket. allowList additionally lets anyone ENUMERATE the bucket, which
// is a separate and much larger decision than serving a known URL — so
// it's a separate flag rather than something bundled in.
func WithPublicRead(document json.RawMessage, bucket, prefix string, allowList bool) (json.RawMessage, error) {
	base, err := WithoutPublic(document)
	if err != nil {
		return nil, err
	}
	doc := rawDocument{Version: policyVersion}
	if len(base) > 0 {
		if err := json.Unmarshal(base, &doc); err != nil {
			return nil, err
		}
	}

	prefix = strings.TrimPrefix(strings.TrimSpace(prefix), "/")
	objects := "arn:aws:s3:::" + bucket + "/*"
	if prefix != "" {
		objects = "arn:aws:s3:::" + bucket + "/" + strings.TrimSuffix(prefix, "/") + "/*"
	}

	read := map[string]any{
		"Sid":       "VantricPublicRead",
		"Effect":    "Allow",
		"Principal": map[string]any{"AWS": []string{"*"}},
		"Action":    []string{"s3:GetObject"},
		"Resource":  []string{objects},
	}
	raw, err := json.Marshal(read)
	if err != nil {
		return nil, err
	}
	doc.Statement = append(doc.Statement, raw)

	if allowList {
		// ListBucket is granted on the BUCKET ARN, not the object one —
		// they are different resources, and a listing rule written
		// against "bucket/*" silently does nothing. Where a prefix is in
		// play the listing is confined to it by a condition, or opening
		// one folder would expose every key name in the bucket.
		list := map[string]any{
			"Sid":       "VantricPublicList",
			"Effect":    "Allow",
			"Principal": map[string]any{"AWS": []string{"*"}},
			"Action":    []string{"s3:ListBucket"},
			"Resource":  []string{"arn:aws:s3:::" + bucket},
		}
		if prefix != "" {
			list["Condition"] = map[string]any{
				"StringLike": map[string]any{
					"s3:prefix": []string{strings.TrimSuffix(prefix, "/") + "/*"},
				},
			}
		}
		rawList, err := json.Marshal(list)
		if err != nil {
			return nil, err
		}
		doc.Statement = append(doc.Statement, rawList)
	}
	return json.Marshal(doc)
}
