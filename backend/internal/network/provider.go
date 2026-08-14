// Package network defines the abstraction over network controllers
// (UniFi first). It mirrors internal/hypervisor, internal/dns,
// internal/database and internal/identity: nothing outside
// internal/network/* may import a controller's specifics.
//
// The controller owns the network. This console reads it — what
// subnets exist, what holds an address, what hardware is up — and
// correlates it with what the hypervisor and DNS say, which is the one
// view no single tool can produce.
package network

import (
	"context"
	"errors"
	"sync"
)

var ErrNotFound = errors.New("network: not found")

// Info is what the controller reports about itself.
type Info struct {
	Version  string `json:"version"`
	Sites    int    `json:"sites"`
	Networks int    `json:"networks"`
	Clients  int    `json:"clients"`
	Devices  int    `json:"devices"`
}

// Site is one managed site on a controller. A controller commonly
// holds several — home, a relative's house, a workshop — and they
// share nothing but the login, so every listing spans them all and
// stamps each row with the site it came from.
type Site struct {
	// ID is what the API calls the site (an opaque short name).
	ID string `json:"id"`
	// Name is the human one you set in the controller.
	Name string `json:"name"`
}

// Network is a configured network — in UniFi terms a VLAN with its
// subnet and DHCP range.
type Network struct {
	// Site is filled in by the driver, not the caller.
	Site string `json:"site"`
	ID   string `json:"id"`
	Name string `json:"name"`
	// VLAN is 0 for an untagged/default network.
	VLAN int `json:"vlan"`
	// Subnet is CIDR as the controller states it.
	Subnet  string `json:"subnet"`
	Purpose string `json:"purpose"`
	// Category groups the controller's purposes the way its own UI
	// does: lan, wan, vpn or other.
	Category string `json:"category"`
	Enabled bool   `json:"enabled"`
	// DHCP range; empty when the controller doesn't serve DHCP here,
	// which is itself worth showing.
	DHCPEnabled bool   `json:"dhcpEnabled"`
	DHCPStart   string `json:"dhcpStart"`
	DHCPStop    string `json:"dhcpStop"`
	DomainName  string `json:"domainName"`
}

// WiFi is a wireless network (SSID) the controller broadcasts.
type WiFi struct {
	// Site is filled in by the driver, not the caller.
	Site    string `json:"site"`
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	// Security is the human form: WPA2, WPA3, Open, Enterprise.
	Security string `json:"security"`
	Guest    bool   `json:"guest"`
	Hidden   bool   `json:"hidden"`
	// Network is the wired network this SSID puts clients on.
	Network string `json:"network"`
	// Bands are the radios carrying it: 2.4 GHz, 5 GHz, 6 GHz.
	Bands   []string `json:"bands"`
	Clients int      `json:"clients"`
}

// Client is something holding an address on the network.
type Client struct {
	// Site is filled in by the driver, not the caller.
	Site string `json:"site"`
	ID   string `json:"id"`
	Name string `json:"name"`
	// Hostname is what the device called itself over DHCP.
	Hostname string `json:"hostname"`
	MAC      string `json:"mac"`
	IP       string `json:"ip"`
	Network  string `json:"network"`
	VLAN     int    `json:"vlan"`
	Wired    bool   `json:"wired"`
	Online   bool   `json:"online"`
	// FixedIP marks a reservation rather than a lease.
	FixedIP bool `json:"fixedIp"`
	// Uplink is the device it connects through, and Port the switch
	// port when wired.
	Uplink string `json:"uplink"`
	Port   int    `json:"port"`
	// LastSeen is unix seconds; 0 when the controller never saw it.
	LastSeen int64  `json:"lastSeen"`
	Vendor   string `json:"vendor"`
}

// Device is controller-managed hardware: gateway, switch, access point.
type Device struct {
	// Site is filled in by the driver, not the caller.
	Site    string `json:"site"`
	ID      string `json:"id"`
	Name    string `json:"name"`
	Model   string `json:"model"`
	Kind    string `json:"kind"` // gateway | switch | ap | other
	MAC     string `json:"mac"`
	IP      string `json:"ip"`
	Version string `json:"version"`
	State   string `json:"state"` // online | offline | …
	Adopted bool   `json:"adopted"`
	// UptimeSeconds is 0 when the device is down.
	UptimeSeconds int64 `json:"uptimeSeconds"`
	Clients       int   `json:"clients"`
}

// Provider is the contract every controller implements.
// Implementations must be safe for concurrent use.
type Provider interface {
	Type() string
	// Verify checks the credentials work without changing anything.
	Verify(ctx context.Context) error
	Info(ctx context.Context) (*Info, error)
	Sites(ctx context.Context) ([]Site, error)
	// The listings span every site unless one is named; each row
	// carries the site it came from.
	Networks(ctx context.Context, site string) ([]Network, error)
	WiFi(ctx context.Context, site string) ([]WiFi, error)
	Clients(ctx context.Context, site string) ([]Client, error)
	Devices(ctx context.Context, site string) ([]Device, error)
}

// Registry holds one live Provider per configured record.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
}

func NewRegistry() *Registry {
	return &Registry{providers: map[string]Provider{}}
}

func (r *Registry) Get(id string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

func (r *Registry) Set(id string, p Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[id] = p
}

func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.providers, id)
}
