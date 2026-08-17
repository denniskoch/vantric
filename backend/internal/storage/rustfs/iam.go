package rustfs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"vantric/internal/storage"
)

// admin is the one prefix this driver speaks. See the package comment:
// the MinIO-compatible prefix serves these same IAM endpoints behind an
// encrypted payload envelope, and mixing the two would mean two payload
// formats for one API.
const admin = "/rustfs/admin/v3"

// Compile-time proof this driver still satisfies the capability
// interfaces. A type assertion elsewhere would just stop matching if a
// method's signature drifted, with nothing failing to build — which is
// exactly how a mock quietly stopped being a ContainerDriver once.
var (
	_ storage.Provider      = (*Driver)(nil)
	_ storage.QuotaProvider = (*Driver)(nil)
	_ storage.UserProvider  = (*Driver)(nil)
)

// missingUser recognises "there is no such access key", which this store
// says FOUR different ways depending on which endpoint noticed:
//
//	user-info       404 NoSuchResource  user 'x' does not exist
//	set-user-status 500 InternalError   failed to set user status: user 'x' does not exist
//	remove-user     500 InternalError   failed to query temporary user state: user 'x' does not exist
//	set-policy      400 InvalidArgument user not found
//
// Only the first is a status code anything can act on, so the rest are
// read from the message. Matching a string is not a nice way to classify
// an error, and it's the honest one here — the alternative is a console
// that answers 500 when you disable a key somebody deleted in the other
// tab, which reads as this app breaking rather than as the key being
// gone.
//
// The match deliberately requires the word "user": the same endpoints
// say "policy does not exist" for a bad policy name, and reporting that
// as a missing access key would send somebody looking for the wrong
// thing.
func missingUser(message string) bool {
	m := strings.ToLower(message)
	if !strings.Contains(m, "user") {
		return false
	}
	return strings.Contains(m, "does not exist") || strings.Contains(m, "not found")
}

// userRecord is what list-users and user-info both return. policyName is
// singular even though the store has an attach/detach API that sounds
// plural: one binding is what it reports, so one binding is what this
// models.
type userRecord struct {
	Status     string `json:"status"`
	PolicyName string `json:"policyName"`
	UpdatedAt  string `json:"updatedAt"`
}

func (u userRecord) user(accessKey string) storage.User {
	out := storage.User{
		AccessKey: accessKey,
		Enabled:   u.Status == "enabled",
		Policy:    u.PolicyName,
	}
	if t, err := time.Parse(time.RFC3339, u.UpdatedAt); err == nil {
		out.UpdatedAt = t.Unix()
	}
	return out
}

// adminJSON sends an admin call and decodes a JSON reply into out, which
// may be nil for the calls that answer with an empty body.
func (d *Driver) adminJSON(ctx context.Context, method, path string, query url.Values, body []byte, action string, out any) error {
	resp, err := d.do(ctx, method, admin+path, query, body)
	if err != nil {
		return err
	}
	if err := check(resp, action); err != nil {
		return err
	}
	defer resp.Body.Close()
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (d *Driver) Users(ctx context.Context) ([]storage.User, error) {
	// One call carries status AND policy for every key, so there is no
	// per-user fan-out here — unlike quotas, which the store only
	// answers one bucket at a time.
	var raw map[string]userRecord
	if err := d.adminJSON(ctx, http.MethodGet, "/list-users", nil, nil, "list access keys", &raw); err != nil {
		return nil, err
	}
	users := make([]storage.User, 0, len(raw))
	for key, rec := range raw {
		users = append(users, rec.user(key))
	}
	sort.Slice(users, func(i, j int) bool { return users[i].AccessKey < users[j].AccessKey })
	return users, nil
}

// userInfo reads one key, distinguishing "no such key" from a failure.
func (d *Driver) userInfo(ctx context.Context, accessKey string) (*userRecord, error) {
	var rec userRecord
	err := d.adminJSON(ctx, http.MethodGet, "/user-info",
		url.Values{"accessKey": {accessKey}}, nil, "read an access key", &rec)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (d *Driver) CreateUser(ctx context.Context, accessKey, secretKey string) error {
	// add-user is an UPSERT: issued against a key that exists it replaces
	// the secret and leaves the policy, which means an unchecked "create"
	// would silently break whatever is already signing with that key. The
	// store offers no conditional create, so this is a read-then-write and
	// races in theory; refusing what we can see beats not looking.
	if _, err := d.userInfo(ctx, accessKey); err == nil {
		return fmt.Errorf("an access key named %q already exists on this store", accessKey)
	} else if !errors.Is(err, storage.ErrNotFound) {
		return err
	}
	return d.putUser(ctx, accessKey, secretKey, true)
}

func (d *Driver) SetUserSecret(ctx context.Context, accessKey, secretKey string) error {
	// The status has to be carried across explicitly. add-user takes it in
	// the body and applies whatever it's given, so reissuing a secret with
	// a hardcoded "enabled" would switch a disabled key back on — a
	// revoked credential quietly working again, from a form that only
	// claimed to change the password.
	rec, err := d.userInfo(ctx, accessKey)
	if err != nil {
		return err
	}
	return d.putUser(ctx, accessKey, secretKey, rec.Status == "enabled")
}

func (d *Driver) putUser(ctx context.Context, accessKey, secretKey string, enabled bool) error {
	status := "disabled"
	if enabled {
		status = "enabled"
	}
	body, err := json.Marshal(map[string]string{"secretKey": secretKey, "status": status})
	if err != nil {
		return err
	}
	return d.adminJSON(ctx, http.MethodPut, "/add-user",
		url.Values{"accessKey": {accessKey}}, body, "create an access key", nil)
}

func (d *Driver) SetUserStatus(ctx context.Context, accessKey string, enabled bool) error {
	status := "disabled"
	if enabled {
		status = "enabled"
	}
	return d.adminJSON(ctx, http.MethodPut, "/set-user-status",
		url.Values{"accessKey": {accessKey}, "status": {status}}, nil, "change an access key's status", nil)
}

func (d *Driver) SetUserPolicy(ctx context.Context, accessKey, policy string) error {
	if policy != "" {
		return d.adminJSON(ctx, http.MethodPut, "/set-user-or-group-policy",
			url.Values{
				"policyName":  {policy},
				"userOrGroup": {accessKey},
				"isGroup":     {"false"},
			}, nil, "attach a policy", nil)
	}
	// Unbinding is a detach, and detach names the policy to remove rather
	// than taking "none" — so the current one has to be read first. A key
	// with nothing bound is already where we want it.
	rec, err := d.userInfo(ctx, accessKey)
	if err != nil {
		return err
	}
	if rec.PolicyName == "" {
		return nil
	}
	body, err := json.Marshal(map[string]any{"policies": []string{rec.PolicyName}, "user": accessKey})
	if err != nil {
		return err
	}
	return d.adminJSON(ctx, http.MethodPost, "/idp/builtin/policy/detach", nil, body, "detach a policy", nil)
}

func (d *Driver) DeleteUser(ctx context.Context, accessKey string) error {
	return d.adminJSON(ctx, http.MethodDelete, "/remove-user",
		url.Values{"accessKey": {accessKey}}, nil, "delete an access key", nil)
}

// policyDoc is an IAM policy document. Action and Resource are each
// either a string or an array of them in this format, which is why they
// arrive as RawMessage rather than []string — a typed decode fails WHOLE
// on the single-string form, losing every policy in the response.
type policyDoc struct {
	Statement []struct {
		Effect string          `json:"Effect"`
		Action json.RawMessage `json:"Action"`
	} `json:"Statement"`
}

func (d *Driver) Policies(ctx context.Context) ([]storage.Policy, error) {
	var raw map[string]policyDoc
	if err := d.adminJSON(ctx, http.MethodGet, "/list-canned-policies", nil, nil, "list policies", &raw); err != nil {
		return nil, err
	}
	policies := make([]storage.Policy, 0, len(raw))
	for name, doc := range raw {
		policies = append(policies, storage.Policy{Name: name, Actions: allowedActions(doc)})
	}
	sort.Slice(policies, func(i, j int) bool { return policies[i].Name < policies[j].Name })
	return policies, nil
}

// allowedActions flattens the Allow statements' actions, deduplicated
// and sorted. Deny statements are skipped: this is for describing what a
// policy grants, and listing a denied action as one of them would read
// as the opposite of the truth.
func allowedActions(doc policyDoc) []string {
	seen := map[string]bool{}
	for _, st := range doc.Statement {
		if !strings.EqualFold(st.Effect, "Allow") {
			continue
		}
		for _, action := range stringOrList(st.Action) {
			seen[action] = true
		}
	}
	actions := make([]string, 0, len(seen))
	for action := range seen {
		actions = append(actions, action)
	}
	sort.Strings(actions)
	return actions
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
