package hypervisor

import "vantric/internal/registry"

// Registry holds one live Driver per registered hypervisor, keyed by
// hypervisor ID. It is updated at runtime as hypervisors are added,
// edited or removed.
//
// The three methods live in internal/registry: they were the same
// three in all seven of these.
type Registry = registry.Of[Driver]

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return registry.New[Driver]() }
