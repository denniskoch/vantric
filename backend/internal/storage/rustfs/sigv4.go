package rustfs

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// AWS Signature Version 4, by hand.
//
// Written here rather than pulled in with aws-sdk-go-v2 or madmin-go for
// the reason OIDC is plain net/http in this codebase: what's actually
// needed is one signing function, and the SDKs bring a credential-chain
// and retry framework this app has no use for. The whole contract is
// below, and it is the same contract for the S3 calls and the admin
// ones — the admin API is signed as service "s3" too.
const (
	algorithm  = "AWS4-HMAC-SHA256"
	service    = "s3"
	timeFormat = "20060102T150405Z"
	dateFormat = "20060102"
)

// emptyPayload is the SHA-256 of no bytes, which S3 requires as
// x-amz-content-sha256 on a request with no body.
const emptyPayload = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

// sign adds the Authorization header. payloadHash is the hex SHA-256 of
// the body — or UNSIGNED-PAYLOAD for a stream too large to hash twice,
// which S3 permits over TLS and RustFS accepts either way.
func sign(req *http.Request, accessKey, secretKey, region, payloadHash string) {
	now := time.Now().UTC()
	amzDate := now.Format(timeFormat)
	dateStamp := now.Format(dateFormat)

	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	if req.Host != "" {
		req.Header.Set("Host", req.Host)
	}

	// The signed headers must be sorted, lowercased, and exactly the set
	// named in SignedHeaders — a mismatch is a signature error that
	// looks like a credential error, so this keeps the set minimal and
	// explicit rather than signing whatever happens to be present.
	signed := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	sort.Strings(signed)
	var canonicalHeaders strings.Builder
	for _, h := range signed {
		value := req.Header.Get(h)
		if h == "host" {
			value = req.URL.Host
		}
		canonicalHeaders.WriteString(h + ":" + strings.TrimSpace(value) + "\n")
	}
	signedHeaders := strings.Join(signed, ";")

	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI(req.URL.EscapedPath()),
		canonicalQuery(req),
		canonicalHeaders.String(),
		signedHeaders,
		payloadHash,
	}, "\n")

	scope := dateStamp + "/" + region + "/" + service + "/aws4_request"
	hashed := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := strings.Join([]string{
		algorithm, amzDate, scope, hex.EncodeToString(hashed[:]),
	}, "\n")

	key := hmacSHA256([]byte("AWS4"+secretKey), dateStamp)
	key = hmacSHA256(key, region)
	key = hmacSHA256(key, service)
	key = hmacSHA256(key, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(key, stringToSign))

	req.Header.Set("Authorization", algorithm+
		" Credential="+accessKey+"/"+scope+
		", SignedHeaders="+signedHeaders+
		", Signature="+signature)
}

// canonicalURI is the path, never empty. An empty path signs as "/",
// which is what a request to the service root is.
func canonicalURI(path string) string {
	if path == "" {
		return "/"
	}
	return path
}

// canonicalQuery sorts and re-encodes the query string.
//
// url.Values.Encode is NOT this encoding, which is the sort of thing
// that goes unnoticed for a long time: it writes a space as "+" where
// SigV4 canonicalises it as "%20". Nothing here carried a value with a
// space until policy names did, and the failure it would have produced
// is a signature mismatch — which reads as a rejected credential rather
// than as an escaping bug, and would have been blamed on the store.
//
// encodeQuery below is used to BUILD the URL as well, so what goes on
// the wire and what gets signed come from one function rather than two
// that agree by coincidence.
func canonicalQuery(req *http.Request) string {
	return encodeQuery(req.URL.Query())
}

// encodeQuery renders values sorted by key, RFC 3986 throughout.
func encodeQuery(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out strings.Builder
	for _, k := range keys {
		for _, v := range values[k] {
			if out.Len() > 0 {
				out.WriteByte('&')
			}
			// A valueless parameter still needs its "=", which is what
			// the trailing empty string produces.
			out.WriteString(awsEscape(k) + "=" + awsEscape(v))
		}
	}
	return out.String()
}

// awsEscape percent-encodes everything outside RFC 3986's unreserved set,
// in uppercase hex. Notably not "+" for a space.
func awsEscape(s string) string {
	var out strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9',
			c == '-', c == '_', c == '.', c == '~':
			out.WriteByte(c)
		default:
			out.WriteString("%" + strings.ToUpper(hex.EncodeToString([]byte{c})))
		}
	}
	return out.String()
}
