// Package docker defines the abstraction over Docker hosts. It mirrors
// internal/hypervisor, internal/dns, internal/database and the rest:
// nothing outside internal/docker/* may import a transport's specifics.
//
// WHAT IT TALKS TO IS THE DOCKER ENGINE API, NOT A PRODUCT. That is the
// whole design. The socket itself is root on the host, so it has to be
// fronted by something — and the three candidates (an authenticating
// proxy like capstan, a plain docker-socket-proxy on a private
// network, or Docker's own TLS listener) all speak the SAME API. So
// there is one driver, and which of them is on the other end is a
// property of the RECORD — a URL, an optional bearer token, an optional
// pinned certificate — rather than a different implementation.
//
// WHAT THIS SECTION IS FOR, given Compute already lists guests: the
// join nothing else can make. A Docker host is a guest this console
// already knows, so a container list can say which VM it is running
// inside, on which hypervisor, and whether any backup job covers it.
// Docker knows the containers, Proxmox knows the guest, and neither
// knows the other.
package docker

import (
	"context"
	"errors"
	"time"

	"vantric/internal/registry"
)

var ErrNotFound = errors.New("docker: not found")

// ErrWriteDisabled is the host refusing a change it is configured not
// to make.
//
// A RUNTIME ANSWER, NOT A CAPABILITY INTERFACE. Everywhere else in this
// console an optional power is a type assertion, because the DRIVER
// either has it or doesn't. Here the driver always can and the far end
// decides: the same binary in front of two hosts will accept a restart
// on one and refuse it on the other, depending on how each was
// started. So the capability is discovered by being told, and this is
// how it is told — "this host doesn't allow that" rather than "that
// failed".
var ErrWriteDisabled = errors.New("docker: this host does not allow changes")

// ErrForbidden is an endpoint the far end will never serve, whatever
// its settings — creating a container, exec, build. Distinct from
// ErrWriteDisabled because no configuration change fixes it, and a UI
// that offered to "enable writes" would be lying.
var ErrForbidden = errors.New("docker: that endpoint is permanently disabled on this host")

// Info is what a host says about itself, for the check that runs before
// a record is stored.
type Info struct {
	// Name is the host's own hostname, which is the thing to match
	// against the guest list.
	Name       string `json:"name"`
	OS         string `json:"os"`
	Kernel     string `json:"kernel"`
	Arch       string `json:"arch"`
	CPUs       int    `json:"cpus"`
	MemoryB    int64  `json:"memoryBytes"`
	Containers int    `json:"containers"`
	Running    int    `json:"running"`
	Images     int    `json:"images"`
	Version    string `json:"version"`
	APIVersion string `json:"apiVersion"`
	// Writable is whether this host accepts changes, discovered rather
	// than configured — see ErrWriteDisabled.
	Writable bool `json:"writable"`
}

// Container is one container as this console shows it.
type Container struct {
	// HostID is filled in by the API layer, not the driver.
	HostID string `json:"hostId"`
	ID     string `json:"id"`
	// Name without Docker's leading slash, which is an artefact of the
	// API rather than part of the name.
	Name    string `json:"name"`
	Image   string `json:"image"`
	ImageID string `json:"imageId"`
	Command string `json:"command"`
	// CreatedAt is unix seconds.
	CreatedAt int64 `json:"createdAt"`
	// State is Docker's own word: running, exited, paused, restarting,
	// created, dead. Passed through rather than mapped — unlike an
	// instance's status, which is normalised to GCP's vocabulary
	// because several hypervisors have to agree on it. Only Docker
	// speaks this one.
	State string `json:"state"`
	// Status is the human sentence Docker composes: "Up 2 weeks
	// (healthy)". Kept because it carries the uptime, which no other
	// field on the list endpoint does.
	Status string `json:"status"`
	// Health is healthy, unhealthy or starting, and EMPTY WHERE THERE
	// IS NO HEALTHCHECK — which is not the same as unhealthy and must
	// not render as a red dot. Four of this lab's six containers
	// declare one.
	Health string `json:"health,omitempty"`
	Ports  []Port `json:"ports"`
	// Stack and Service come from the compose labels, which is the only
	// place the grouping exists — Docker itself has no idea these six
	// containers are three projects.
	Stack   string `json:"stack,omitempty"`
	Service string `json:"service,omitempty"`
}

// Port is one published port. Only the published ones are worth
// carrying: a container's internal ports are an implementation detail
// of the image, and the question here is what you can reach.
type Port struct {
	IP      string `json:"ip,omitempty"`
	Public  int    `json:"public"`
	Private int    `json:"private"`
	Type    string `json:"type"`
}

type Image struct {
	HostID string `json:"hostId"`
	ID     string `json:"id"`
	// Tags is empty for a dangling image, which is a finding rather
	// than a blank — those are what `docker image prune` reclaims.
	Tags      []string `json:"tags"`
	SizeBytes int64    `json:"sizeBytes"`
	CreatedAt int64    `json:"createdAt"`
	// InUse counts containers built from it, so an image safe to remove
	// is visible as one.
	InUse int `json:"inUse"`
}

type Volume struct {
	HostID     string `json:"hostId"`
	Name       string `json:"name"`
	Driver     string `json:"driver"`
	Mountpoint string `json:"mountpoint"`
	CreatedAt  string `json:"createdAt"`
	Stack      string `json:"stack,omitempty"`
}

type Network struct {
	HostID   string `json:"hostId"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Scope    string `json:"scope"`
	Internal bool   `json:"internal"`
	Stack    string `json:"stack,omitempty"`
}

// Provider is one Docker host.
type Provider interface {
	Name() string
	Check(ctx context.Context) (*Info, error)
	Containers(ctx context.Context) ([]Container, error)
	Images(ctx context.Context) ([]Image, error)
	Volumes(ctx context.Context) ([]Volume, error)
	Networks(ctx context.Context) ([]Network, error)
	// Logs returns the tail of a container's output. On demand only,
	// never polled: it is somebody else's ring buffer and can be
	// megabytes.
	Logs(ctx context.Context, id string, lines int) (string, error)
	// Act runs a lifecycle action — start, stop, restart, kill, pause,
	// unpause. Answers ErrWriteDisabled where the host refuses changes.
	Act(ctx context.Context, id, action string) error
}

type Registry = registry.Of[Provider]

func NewRegistry() *Registry { return registry.New[Provider]() }

// Timeout is what a Docker host gets to answer in. Generous by this
// console's standards because a log tail on a chatty container is not
// a small response.
const Timeout = 30 * time.Second
