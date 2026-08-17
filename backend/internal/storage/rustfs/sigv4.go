package rustfs

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
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

// canonicalQuery sorts and re-encodes the query string. url.Values.Encode
// already sorts by key and escapes the way SigV4 wants, so the only
// thing to add is that a valueless parameter still needs its "=".
func canonicalQuery(req *http.Request) string {
	q := req.URL.Query()
	if len(q) == 0 {
		return ""
	}
	return q.Encode()
}
