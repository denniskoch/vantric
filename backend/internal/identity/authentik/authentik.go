// Package authentik implements identity.Provider against authentik's
// REST API (/api/v3) using an API token.
package authentik

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"lab-cloud-manager/internal/identity"
)

type Config struct {
	// BaseURL is the authentik root, e.g. https://auth.example.com.
	BaseURL string
	Token   string
	// InsecureTLS allows a self-signed certificate, which an
	// internally-hosted instance often has.
	InsecureTLS bool
}

type Provider struct {
	cfg    Config
	client *http.Client
}

func New(cfg Config) *Provider {
	transport := &http.Transport{}
	if cfg.InsecureTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &Provider{
		cfg:    cfg,
		client: &http.Client{Timeout: 20 * time.Second, Transport: transport},
	}
}

func (p *Provider) Type() string { return "authentik" }

func (p *Provider) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	url := strings.TrimRight(p.cfg.BaseURL, "/") + "/api/v3" + path
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.cfg.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("authentik: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode >= 400 {
		return fmt.Errorf("authentik: %s %s: %s", method, path, errorMessage(resp.StatusCode, raw))
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("authentik: decoding %s: %w", path, err)
		}
	}
	return nil
}

// errorMessage pulls the useful line out of an error body. authentik
// reports either {"detail": "..."} or field-keyed validation errors,
// and the raw JSON is unreadable in a toast.
func errorMessage(status int, raw []byte) string {
	var detail struct {
		Detail string `json:"detail"`
	}
	if json.Unmarshal(raw, &detail) == nil && detail.Detail != "" {
		return detail.Detail
	}
	var fields map[string][]string
	if json.Unmarshal(raw, &fields) == nil && len(fields) > 0 {
		parts := make([]string, 0, len(fields))
		for field, msgs := range fields {
			parts = append(parts, field+": "+strings.Join(msgs, " "))
		}
		return strings.Join(parts, "; ")
	}
	if len(raw) > 200 {
		raw = raw[:200]
	}
	if len(raw) == 0 {
		return http.StatusText(status)
	}
	return string(raw)
}

// page is authentik's list envelope.
type page[T any] struct {
	Pagination struct {
		Next       int `json:"next"`
		TotalPages int `json:"total_pages"`
		Count      int `json:"count"`
	} `json:"pagination"`
	Results []T `json:"results"`
}

// listAll follows pagination. The cap keeps a runaway directory from
// turning one page view into hundreds of requests.
func listAll[T any](ctx context.Context, p *Provider, path string) ([]T, error) {
	const maxPages = 20
	items := []T{}
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	for n := 1; n <= maxPages; n++ {
		var res page[T]
		if err := p.do(ctx, http.MethodGet, fmt.Sprintf("%s%spage=%d&page_size=100", path, sep, n), nil, &res); err != nil {
			return nil, err
		}
		items = append(items, res.Results...)
		if n >= res.Pagination.TotalPages {
			break
		}
	}
	return items, nil
}

func (p *Provider) Verify(ctx context.Context) error {
	// /admin/version/ needs an admin token, which is what every other
	// call here needs too — so this fails fast on an under-scoped one.
	var version struct {
		Current string `json:"version_current"`
	}
	if err := p.do(ctx, http.MethodGet, "/admin/version/", nil, &version); err != nil {
		return err
	}
	if version.Current == "" {
		return fmt.Errorf("authentik: no version reported; is this an authentik URL?")
	}
	return nil
}

func (p *Provider) Info(ctx context.Context) (*identity.Info, error) {
	var version struct {
		Current  string `json:"version_current"`
		Latest   string `json:"version_latest"`
		Outdated bool   `json:"outdated"`
	}
	if err := p.do(ctx, http.MethodGet, "/admin/version/", nil, &version); err != nil {
		return nil, err
	}
	info := &identity.Info{
		Version:       version.Current,
		LatestVersion: version.Latest,
		Outdated:      version.Outdated,
	}
	// One page each: the envelope's count is the total, so there's no
	// need to walk the directory just to size it.
	info.Users = p.count(ctx, "/core/users/")
	info.Groups = p.count(ctx, "/core/groups/")
	info.Applications = p.count(ctx, "/core/applications/")
	return info, nil
}

func (p *Provider) count(ctx context.Context, path string) int {
	var res page[json.RawMessage]
	if err := p.do(ctx, http.MethodGet, path+"?page_size=1", nil, &res); err != nil {
		return 0
	}
	return res.Pagination.Count
}

type akUser struct {
	PK        int    `json:"pk"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	IsActive  bool   `json:"is_active"`
	IsSuper   bool   `json:"is_superuser"`
	Type      string `json:"type"`
	LastLogin string `json:"last_login"`
	GroupsObj []struct {
		Name      string `json:"name"`
		IsSuper   bool   `json:"is_superuser"`
	} `json:"groups_obj"`
}

// parseTime reads authentik's ISO-8601 timestamps; a null or empty one
// means "never", which is 0 here.
func parseTime(value string) int64 {
	if value == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return 0
	}
	return t.Unix()
}

func (p *Provider) Users(ctx context.Context) ([]identity.User, error) {
	found, err := listAll[akUser](ctx, p, "/core/users/")
	if err != nil {
		return nil, err
	}
	users := make([]identity.User, 0, len(found))
	for _, u := range found {
		user := identity.User{
			ID:        strconv.Itoa(u.PK),
			Username:  u.Username,
			Name:      u.Name,
			Email:     u.Email,
			Active:    u.IsActive,
			Superuser: u.IsSuper,
			Kind:      u.Type,
			LastLogin: parseTime(u.LastLogin),
			Groups:    []string{},
		}
		// Administrator rights usually arrive through a group rather
		// than being set on the account.
		for _, g := range u.GroupsObj {
			user.Groups = append(user.Groups, g.Name)
			if g.IsSuper {
				user.Superuser = true
			}
		}
		users = append(users, user)
	}
	return users, nil
}

func (p *Provider) Groups(ctx context.Context) ([]identity.Group, error) {
	type akGroup struct {
		PK         string `json:"pk"`
		Name       string `json:"name"`
		IsSuper    bool   `json:"is_superuser"`
		ParentName string `json:"parent_name"`
		Users      []int  `json:"users"`
	}
	// include_users pulls every member object into the payload; the
	// membership list of ids is all this needs.
	found, err := listAll[akGroup](ctx, p, "/core/groups/?include_users=false")
	if err != nil {
		return nil, err
	}
	groups := make([]identity.Group, 0, len(found))
	for _, g := range found {
		groups = append(groups, identity.Group{
			ID:        g.PK,
			Name:      g.Name,
			Superuser: g.IsSuper,
			Members:   len(g.Users),
			Parent:    g.ParentName,
		})
	}
	return groups, nil
}

func (p *Provider) Applications(ctx context.Context) ([]identity.Application, error) {
	type akApp struct {
		PK          string `json:"pk"`
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		LaunchURL   string `json:"launch_url"`
		Description string `json:"meta_description"`
		ProviderObj struct {
			Name        string `json:"name"`
			VerboseName string `json:"verbose_name"`
		} `json:"provider_obj"`
	}
	found, err := listAll[akApp](ctx, p, "/core/applications/")
	if err != nil {
		return nil, err
	}
	apps := make([]identity.Application, 0, len(found))
	for _, a := range found {
		apps = append(apps, identity.Application{
			ID:           a.PK,
			Name:         a.Name,
			Slug:         a.Slug,
			LaunchURL:    a.LaunchURL,
			Provider:     a.ProviderObj.Name,
			ProviderType: a.ProviderObj.VerboseName,
			Description:  a.Description,
		})
	}
	return apps, nil
}

func (p *Provider) Events(ctx context.Context, limit int) ([]identity.Event, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	type akEvent struct {
		PK     string `json:"pk"`
		Action string `json:"action"`
		User   struct {
			Username string `json:"username"`
			Email    string `json:"email"`
		} `json:"user"`
		App      string         `json:"app"`
		ClientIP string         `json:"client_ip"`
		Created  string         `json:"created"`
		Context  map[string]any `json:"context"`
	}
	var res page[akEvent]
	path := fmt.Sprintf("/events/events/?ordering=-created&page=1&page_size=%d", limit)
	if err := p.do(ctx, http.MethodGet, path, nil, &res); err != nil {
		return nil, err
	}
	events := make([]identity.Event, 0, len(res.Results))
	for _, e := range res.Results {
		events = append(events, identity.Event{
			ID:       e.PK,
			Action:   e.Action,
			User:     e.User.Username,
			App:      e.App,
			ClientIP: e.ClientIP,
			Created:  parseTime(e.Created),
			Detail:   eventDetail(e.Context),
		})
	}
	return events, nil
}

// eventDetail picks the one field from an event's context worth
// showing in a list. The shape varies by action, so this reads the
// handful that actually carry a summary and gives up quietly.
func eventDetail(context map[string]any) string {
	for _, key := range []string{"message", "reason", "http_request"} {
		switch value := context[key].(type) {
		case string:
			return value
		case map[string]any:
			if path, ok := value["path"].(string); ok {
				return path
			}
		}
	}
	return ""
}

func (p *Provider) SetUserActive(ctx context.Context, userID string, active bool) error {
	body := map[string]any{"is_active": active}
	return p.do(ctx, http.MethodPatch, "/core/users/"+userID+"/", body, nil)
}

func (p *Provider) SetUserPassword(ctx context.Context, userID, password string) error {
	body := map[string]any{"password": password}
	return p.do(ctx, http.MethodPost, "/core/users/"+userID+"/set_password/", body, nil)
}

func (p *Provider) AddUserToGroup(ctx context.Context, groupID, userID string) error {
	pk, err := strconv.Atoi(userID)
	if err != nil {
		return fmt.Errorf("authentik: %q is not a user id", userID)
	}
	return p.do(ctx, http.MethodPost, "/core/groups/"+groupID+"/add_user/", map[string]int{"pk": pk}, nil)
}

func (p *Provider) RemoveUserFromGroup(ctx context.Context, groupID, userID string) error {
	pk, err := strconv.Atoi(userID)
	if err != nil {
		return fmt.Errorf("authentik: %q is not a user id", userID)
	}
	return p.do(ctx, http.MethodPost, "/core/groups/"+groupID+"/remove_user/", map[string]int{"pk": pk}, nil)
}
