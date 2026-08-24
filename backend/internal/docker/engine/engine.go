// Package engine implements docker.Provider against the Docker Engine
// API over HTTP(S).
//
// ONE DRIVER FOR THREE FRONT DOORS, because they are all the same API:
// capstan (bearer token, pinned self-signed certificate), a plain
// docker-socket-proxy on a private network (no token), and Docker's own
// TLS listener. What differs is the credential and how the certificate
// is trusted, and both of those live on the record.
//
// THE API IS VERSIONED AND THE PATH IS NOT. Docker serves both /version
// and /v1.43/version, and an unversioned request gets the daemon's
// newest. This asks unversioned: pinning a version here would mean
// choosing one that every host in a lab happens to support, and the
// fields this reads have been stable since 1.24.
package engine

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"vantric/internal/docker"
	"vantric/internal/tlspin"
)

type Config struct {
	BaseURL string
	// Token is optional: a socket proxy on a private network has none.
	Token string
	// Fingerprint pins the host's certificate. Preferred over
	// InsecureTLS, which is only consulted when this is empty.
	Fingerprint string
	InsecureTLS bool
}

type Driver struct {
	base   string
	token  string
	client *http.Client
}

func New(cfg Config) (*Driver, error) {
	transport := &http.Transport{}
	switch {
	case cfg.Fingerprint != "":
		pinned, err := tlspin.Config(cfg.Fingerprint)
		if err != nil {
			return nil, err
		}
		transport.TLSClientConfig = pinned
	case cfg.InsecureTLS:
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // the operator asked
	}
	return &Driver{
		base:   strings.TrimRight(cfg.BaseURL, "/"),
		token:  cfg.Token,
		client: &http.Client{Timeout: docker.Timeout, Transport: transport},
	}, nil
}

func (d *Driver) Name() string { return "engine" }

func (d *Driver) do(ctx context.Context, method, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, d.base+path, nil)
	if err != nil {
		return err
	}
	if d.token != "" {
		req.Header.Set("Authorization", "Bearer "+d.token)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		// The pin failing is wrapped in a url.Error by the transport,
		// and it is the one connection error worth telling apart from
		// "the host is down" — see tlspin.ErrMismatch.
		if errors.Is(err, tlspin.ErrMismatch) {
			return fmt.Errorf("%w — the host at %s is presenting a different certificate", tlspin.ErrMismatch, d.base)
		}
		return fmt.Errorf("docker: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNotFound:
		return docker.ErrNotFound
	case http.StatusUnauthorized:
		return errors.New("docker: the host refused the token")
	case http.StatusForbidden:
		// The front door draws the line, and it draws it in two places:
		// an endpoint it will never serve, and one it would serve if
		// writes were enabled. Only the second is worth offering to fix.
		if strings.Contains(refusal(resp), "permanently") {
			return docker.ErrForbidden
		}
		return docker.ErrWriteDisabled
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("docker: %s %s: %s", method, path, refusal(resp))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// refusal reads the message Docker puts in an error body, which is the
// whole value of the response — "No such container" beats "404".
func refusal(resp *http.Response) string {
	var body struct {
		Message string `json:"message"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if json.Unmarshal(raw, &body) == nil && body.Message != "" {
		return body.Message
	}
	if trimmed := strings.TrimSpace(string(raw)); trimmed != "" {
		return trimmed
	}
	return resp.Status
}

func (d *Driver) Check(ctx context.Context) (*docker.Info, error) {
	var version struct {
		Version    string `json:"Version"`
		APIVersion string `json:"ApiVersion"`
	}
	if err := d.do(ctx, http.MethodGet, "/version", &version); err != nil {
		return nil, err
	}
	var info struct {
		Name              string `json:"Name"`
		OperatingSystem   string `json:"OperatingSystem"`
		KernelVersion     string `json:"KernelVersion"`
		Architecture      string `json:"Architecture"`
		NCPU              int    `json:"NCPU"`
		MemTotal          int64  `json:"MemTotal"`
		Containers        int    `json:"Containers"`
		ContainersRunning int    `json:"ContainersRunning"`
		Images            int    `json:"Images"`
	}
	if err := d.do(ctx, http.MethodGet, "/info", &info); err != nil {
		return nil, err
	}
	return &docker.Info{
		Name: info.Name, OS: info.OperatingSystem, Kernel: info.KernelVersion,
		Arch: info.Architecture, CPUs: info.NCPU, MemoryB: info.MemTotal,
		Containers: info.Containers, Running: info.ContainersRunning,
		Images: info.Images, Version: version.Version, APIVersion: version.APIVersion,
		Writable: d.writable(ctx),
	}, nil
}

// writable asks the host whether it takes changes, by making one that
// cannot do anything: unpausing a container id that does not exist.
//
// A HARMLESS PROBE IS THE ONLY HONEST WAY TO ASK. Whether writes are on
// is a property of how the far end was started, and nothing advertises
// it — so the choice is between guessing and asking. This asks with the
// gentlest write there is: a 404 means the host would have tried,
// a 403 means it refused the endpoint outright.
func (d *Driver) writable(ctx context.Context) bool {
	err := d.do(ctx, http.MethodPost, "/containers/vantric-probe-does-not-exist/unpause", nil)
	return !errors.Is(err, docker.ErrWriteDisabled) && !errors.Is(err, docker.ErrForbidden)
}

// composeProject and composeService are the labels Docker Compose
// stamps on everything it creates. They are the ONLY record that a set
// of containers is one stack — the daemon has no such concept.
const (
	composeProject = "com.docker.compose.project"
	composeService = "com.docker.compose.service"
)

func (d *Driver) Containers(ctx context.Context) ([]docker.Container, error) {
	var list []struct {
		ID      string            `json:"Id"`
		Names   []string          `json:"Names"`
		Image   string            `json:"Image"`
		ImageID string            `json:"ImageID"`
		Command string            `json:"Command"`
		Created int64             `json:"Created"`
		State   string            `json:"State"`
		Status  string            `json:"Status"`
		Labels  map[string]string `json:"Labels"`
		Ports   []struct {
			IP          string `json:"IP"`
			PrivatePort int    `json:"PrivatePort"`
			PublicPort  int    `json:"PublicPort"`
			Type        string `json:"Type"`
		} `json:"Ports"`
	}
	// all=true, because a container that exited is the one you came to
	// look at. A list of only what is running answers the question you
	// did not have.
	if err := d.do(ctx, http.MethodGet, "/containers/json?all=true", &list); err != nil {
		return nil, err
	}
	out := make([]docker.Container, 0, len(list))
	for _, c := range list {
		container := docker.Container{
			ID: c.ID, Name: containerName(c.Names), Image: c.Image, ImageID: c.ImageID,
			Command: c.Command, CreatedAt: c.Created, State: c.State, Status: c.Status,
			Health:  healthFrom(c.Status),
			Stack:   c.Labels[composeProject],
			Service: c.Labels[composeService],
			Ports:   []docker.Port{},
		}
		for _, p := range c.Ports {
			// Unpublished ports are the image's business. And Docker
			// lists a published one twice, once per address family —
			// the v6 entry is the same port and would double the column.
			if p.PublicPort == 0 || strings.Contains(p.IP, ":") {
				continue
			}
			container.Ports = append(container.Ports, docker.Port{
				IP: p.IP, Public: p.PublicPort, Private: p.PrivatePort, Type: p.Type,
			})
		}
		out = append(out, container)
	}
	return out, nil
}

// containerName drops Docker's leading slash, and takes the first of
// several: a container can carry more than one name through legacy
// links, and the first is the one it was created with.
func containerName(names []string) string {
	if len(names) == 0 {
		return ""
	}
	return strings.TrimPrefix(names[0], "/")
}

// healthFrom reads the health out of Docker's status sentence.
//
// IT IS ONLY IN THE PROSE. The list endpoint composes "Up 2 weeks
// (healthy)" and carries no health field of its own; the structured
// value lives on the per-container detail, which would be one call per
// row. So this reads the parenthesis — and returns EMPTY for a
// container with no healthcheck, which is not the same as unhealthy.
func healthFrom(status string) string {
	for _, state := range []string{"healthy", "unhealthy", "starting"} {
		if strings.Contains(status, "("+state+")") {
			return state
		}
	}
	return ""
}

func (d *Driver) Images(ctx context.Context) ([]docker.Image, error) {
	var list []struct {
		ID         string   `json:"Id"`
		RepoTags   []string `json:"RepoTags"`
		Size       int64    `json:"Size"`
		Created    int64    `json:"Created"`
		Containers int      `json:"Containers"`
	}
	if err := d.do(ctx, http.MethodGet, "/images/json", &list); err != nil {
		return nil, err
	}
	out := make([]docker.Image, 0, len(list))
	for _, i := range list {
		tags := []string{}
		for _, t := range i.RepoTags {
			// Docker's word for an untagged image, which is a blank
			// dressed as a value.
			if t != "<none>:<none>" {
				tags = append(tags, t)
			}
		}
		inUse := i.Containers
		if inUse < 0 {
			// -1 is "not counted", which the daemon returns unless
			// asked to count. Zero would claim it is safe to delete.
			inUse = 0
		}
		out = append(out, docker.Image{
			ID: i.ID, Tags: tags, SizeBytes: i.Size, CreatedAt: i.Created, InUse: inUse,
		})
	}
	return out, nil
}

func (d *Driver) Volumes(ctx context.Context) ([]docker.Volume, error) {
	var body struct {
		Volumes []struct {
			Name       string            `json:"Name"`
			Driver     string            `json:"Driver"`
			Mountpoint string            `json:"Mountpoint"`
			CreatedAt  string            `json:"CreatedAt"`
			Labels     map[string]string `json:"Labels"`
		} `json:"Volumes"`
	}
	if err := d.do(ctx, http.MethodGet, "/volumes", &body); err != nil {
		return nil, err
	}
	out := make([]docker.Volume, 0, len(body.Volumes))
	for _, v := range body.Volumes {
		out = append(out, docker.Volume{
			Name: v.Name, Driver: v.Driver, Mountpoint: v.Mountpoint,
			CreatedAt: v.CreatedAt, Stack: v.Labels[composeProject],
		})
	}
	return out, nil
}

func (d *Driver) Networks(ctx context.Context) ([]docker.Network, error) {
	var list []struct {
		ID       string            `json:"Id"`
		Name     string            `json:"Name"`
		Driver   string            `json:"Driver"`
		Scope    string            `json:"Scope"`
		Internal bool              `json:"Internal"`
		Labels   map[string]string `json:"Labels"`
	}
	if err := d.do(ctx, http.MethodGet, "/networks", &list); err != nil {
		return nil, err
	}
	out := make([]docker.Network, 0, len(list))
	for _, n := range list {
		out = append(out, docker.Network{
			ID: n.ID, Name: n.Name, Driver: n.Driver, Scope: n.Scope,
			Internal: n.Internal, Stack: n.Labels[composeProject],
		})
	}
	return out, nil
}

// Logs returns the tail of a container's output.
//
// NOT JSON, AND MULTIPLEXED. A container without a TTY has its stdout
// and stderr interleaved in an 8-byte-framed stream rather than sent as
// plain text, so the frames are stripped here — otherwise every line
// arrives with a few bytes of binary in front of it.
func (d *Driver) Logs(ctx context.Context, id string, lines int) (string, error) {
	if lines <= 0 {
		lines = 200
	}
	query := url.Values{
		"stdout": []string{"1"}, "stderr": []string{"1"},
		"tail": []string{strconv.Itoa(lines)}, "timestamps": []string{"1"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		d.base+"/containers/"+url.PathEscape(id)+"/logs?"+query.Encode(), nil)
	if err != nil {
		return "", err
	}
	if d.token != "" {
		req.Header.Set("Authorization", "Bearer "+d.token)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("docker: logs for %s: %w", id, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", docker.ErrNotFound
	}
	if resp.StatusCode >= 300 {
		return "", errors.New("docker: " + refusal(resp))
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return "", err
	}
	return demultiplex(raw), nil
}

// demultiplex strips Docker's stream framing: an 8-byte header of
// {stream, 0, 0, 0, len32} before each chunk. A TTY container sends
// none, so a payload that doesn't look framed is returned as it is.
func demultiplex(raw []byte) string {
	var out strings.Builder
	for len(raw) >= 8 {
		if raw[0] > 2 || raw[1] != 0 || raw[2] != 0 || raw[3] != 0 {
			return string(raw) // not framed — a TTY container
		}
		size := int(raw[4])<<24 | int(raw[5])<<16 | int(raw[6])<<8 | int(raw[7])
		if size < 0 || 8+size > len(raw) {
			return out.String() + string(raw[8:])
		}
		out.Write(raw[8 : 8+size])
		raw = raw[8+size:]
	}
	return out.String()
}

// actions are the lifecycle changes worth offering. Deliberately not
// create, exec or build: a front door that allows those is root on the
// host, and this console has no business asking for it.
var actions = map[string]bool{
	"start": true, "stop": true, "restart": true,
	"kill": true, "pause": true, "unpause": true,
}

func (d *Driver) Act(ctx context.Context, id, action string) error {
	if !actions[action] {
		return fmt.Errorf("docker: %q is not an action this console makes", action)
	}
	return d.do(ctx, http.MethodPost,
		"/containers/"+url.PathEscape(id)+"/"+action, nil)
}
