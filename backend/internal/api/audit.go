package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"lab-cloud-manager/internal/store"
)

// Audit: every change, and who made it.
//
// This is MIDDLEWARE rather than a call in each handler, and that's the
// whole point — a per-handler call is a thing the next endpoint forgets,
// and an audit log with holes in it is worse than none, because it
// invites the conclusion that nothing happened.
//
// It records mutations only. A console that logged every GET would bury
// the one line that matters under a poll loop reading the instance list
// every three seconds.

const (
	// Enough for a create-instance payload with cloud-init; anything
	// larger is a file upload, whose body is not the interesting part.
	maxPayloadBytes = 32 << 10
	// A lab's interesting window is weeks. Longer than this and the
	// backup gets unwieldy for data nobody reads.
	auditRetention = 90 * 24 * time.Hour
)

// auditWriter remembers what was sent back, since the outcome is half
// the record: who tried, and whether it worked.
type auditWriter struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (w *auditWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *auditWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	// Only kept to recover an error message; a successful body is the
	// resource itself and already logged as the payload that made it.
	if w.status >= 400 && w.body.Len() < 2048 {
		w.body.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

// auditing records mutating requests. Reads pass through untouched.
func (s *Server) auditing(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		default:
			next.ServeHTTP(w, r)
			return
		}

		// The body has to be read here and put back, because the
		// handler still needs it.
		var payload string
		if r.Body != nil {
			raw, err := io.ReadAll(io.LimitReader(r.Body, maxPayloadBytes))
			if err == nil {
				r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(raw), r.Body))
				payload = redactPayload(raw)
			}
		}

		started := time.Now()
		recorder := &auditWriter{ResponseWriter: w}
		next.ServeHTTP(recorder, r)

		entry := &store.AuditEntry{
			ID:         uuid.NewString(),
			At:         started.Unix(),
			Method:     r.Method,
			Path:       r.URL.Path,
			Status:     recorder.status,
			DurationMS: time.Since(started).Milliseconds(),
			RemoteAddr: clientAddr(r),
			Payload:    payload,
		}
		if user := userFrom(r.Context()); user != nil {
			entry.ActorID, entry.ActorEmail = user.ID, user.Email
		}
		// The chi route pattern, not the concrete path: "delete an
		// instance" is the action, "delete web-1" is the resource.
		if route := chi.RouteContext(r.Context()); route != nil {
			entry.Action = describeAction(r.Method, route.RoutePattern())
		}
		entry.Resource = resourceOf(r)
		if recorder.status >= 400 {
			entry.Error = errorFrom(recorder.body.Bytes())
		}
		if err := s.store.AppendAudit(r.Context(), entry); err != nil {
			s.log.Warn("audit: recording failed", "path", r.URL.Path, "error", err)
		}
	})
}

// describeAction turns a method and a route pattern into a verb a
// person reads: POST /instances/{instance}/stop -> "instances.stop".
func describeAction(method, pattern string) string {
	pattern = strings.TrimPrefix(pattern, "/api/v1")
	parts := []string{}
	for _, p := range strings.Split(pattern, "/") {
		if p == "" || strings.HasPrefix(p, "{") || p == "*" {
			continue
		}
		parts = append(parts, p)
	}
	action := strings.Join(parts, ".")
	if action == "" {
		action = strings.ToLower(method)
	}
	switch method {
	case http.MethodPost:
		return action + ".create"
	case http.MethodPut, http.MethodPatch:
		return action + ".update"
	case http.MethodDelete:
		return action + ".delete"
	}
	return action
}

// resourceOf is what was acted on: the URL parameters chi matched,
// which is where the names and ids live.
func resourceOf(r *http.Request) string {
	route := chi.RouteContext(r.Context())
	if route == nil {
		return ""
	}
	parts := []string{}
	for i, key := range route.URLParams.Keys {
		if i < len(route.URLParams.Values) && route.URLParams.Values[i] != "" && key != "*" {
			parts = append(parts, route.URLParams.Values[i])
		}
	}
	// A create has no id in the path; the name is in the body, and the
	// payload column carries it.
	return strings.Join(parts, "/")
}

func clientAddr(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	host, _, found := strings.Cut(r.RemoteAddr, ":")
	if !found {
		return r.RemoteAddr
	}
	return host
}

func errorFrom(body []byte) string {
	var apiErr struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &apiErr) == nil && apiErr.Error != "" {
		return apiErr.Error
	}
	return strings.TrimSpace(string(body))
}

// --- redaction -------------------------------------------------------

// secretish matches the field names worth never writing down. It errs
// towards redacting: a payload that hides one harmless field is a much
// smaller problem than an audit log holding a Proxmox token.
var secretish = []string{"password", "secret", "token", "key", "credential", "passphrase"}

// publicish are the exceptions — fields whose name contains one of the
// above but which are not secrets. A public key is published on
// purpose; hiding it makes the log less useful for no gain.
var publicish = []string{"publickey", "sshpublickey", "hasttoken", "hastoken", "haspassword", "keyid", "tokenid"}

// redactPayload rewrites a JSON body with secret-looking values
// replaced. Anything that isn't JSON is dropped entirely rather than
// stored blind — a form post or a raw upload has no field names to
// judge, and guessing is how a secret ends up in a log.
func redactPayload(raw []byte) string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return ""
	}
	var body any
	if err := json.Unmarshal(trimmed, &body); err != nil {
		return ""
	}
	cleaned, err := json.Marshal(redact(body))
	if err != nil {
		return ""
	}
	return string(cleaned)
}

func redact(value any) any {
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, inner := range v {
			if isSecret(key) {
				out[key] = "[redacted]"
				continue
			}
			out[key] = redact(inner)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, inner := range v {
			out[i] = redact(inner)
		}
		return out
	default:
		return value
	}
}

func isSecret(name string) bool {
	lower := strings.ToLower(name)
	for _, ok := range publicish {
		if lower == ok {
			return false
		}
	}
	for _, bad := range secretish {
		if strings.Contains(lower, bad) {
			return true
		}
	}
	return false
}

// --- API -------------------------------------------------------------

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := s.store.ListAudit(r.Context(),
		r.URL.Query().Get("actor"), r.URL.Query().Get("resource"), limit)
	if err != nil {
		s.fail(w, err, "activity")
		return
	}
	s.json(w, http.StatusOK, entries)
}

// recordSignIn logs authentication, which the middleware can't see:
// /auth/login runs outside the session, and its body is a password.
func (s *Server) recordSignIn(r *http.Request, user *store.User, email string, err error) {
	entry := &store.AuditEntry{
		ID: uuid.NewString(), At: time.Now().Unix(),
		Method: http.MethodPost, Path: "/api/v1/auth/login",
		Action: "auth.signIn", Resource: email,
		Status: http.StatusOK, RemoteAddr: clientAddr(r),
	}
	if user != nil {
		entry.ActorID, entry.ActorEmail = user.ID, user.Email
	} else {
		entry.ActorEmail = email
	}
	if err != nil {
		entry.Status, entry.Error = http.StatusUnauthorized, err.Error()
	}
	if writeErr := s.store.AppendAudit(r.Context(), entry); writeErr != nil {
		s.log.Warn("audit: recording sign-in failed", "error", writeErr)
	}
}
