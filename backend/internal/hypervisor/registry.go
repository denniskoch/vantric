package hypervisor

import "sync"

// Registry holds one live Driver per registered server, keyed by server
// ID. It is updated at runtime as servers are added/edited/removed.
type Registry struct {
	mu      sync.RWMutex
	drivers map[string]Driver
}

func NewRegistry() *Registry {
	return &Registry{drivers: map[string]Driver{}}
}

func (r *Registry) Get(serverID string) (Driver, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.drivers[serverID]
	return d, ok
}

func (r *Registry) Set(serverID string, d Driver) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.drivers[serverID] = d
}

func (r *Registry) Remove(serverID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.drivers, serverID)
}
