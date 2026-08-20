// Package registry holds the live backends this console is talking to.
//
// Seven sections follow the same split — an interface, records in the
// database, a factory that turns one into the other, and a registry of
// what is currently built. The parts that are genuinely different, what
// a UniFi site is or how two SQL engines spell ownership, are worth
// their own code. This part was not: seven types with the same three
// methods, differing in the value type and whether the field was called
// drivers or providers.
//
// The interfaces stay separate, which is the half of that split worth
// keeping — a dns.Provider and a hypervisor.Driver should not be forced
// into one shape to save a mutex. Each package keeps its own name and
// its own doc comment through a type alias, so nothing outside changes.
package registry

import "sync"

// Of is a set of live backends keyed by the id of the record they were
// built from.
//
// The zero value is usable. That is deliberate rather than tidy: the
// alternative is a constructor everyone must remember, and a field left
// nil by a struct literal somebody edited is a panic on the first
// request with a green test suite behind it. Set creates the map when
// it needs one.
type Of[T any] struct {
	mu    sync.RWMutex
	items map[string]T
}

// New returns an empty registry. Equivalent to the zero value; it reads
// better at a call site.
func New[T any]() *Of[T] {
	return &Of[T]{items: map[string]T{}}
}

// Get returns the live backend for a record id.
func (r *Of[T]) Get(id string) (T, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.items[id]
	return item, ok
}

// Set replaces the live backend for a record id.
func (r *Of[T]) Set(id string, item T) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.items == nil {
		r.items = map[string]T{}
	}
	r.items[id] = item
}

// Remove drops one, after its record is deleted or its credentials stop
// working.
func (r *Of[T]) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.items, id)
}

// Any returns the single configured backend, and false if there is
// anything other than exactly one.
//
// A lab has one identity service and one inventory service, so making
// every endpoint pass an id it cannot get wrong is noise. Exactly one is
// the whole condition: with none there is nothing to answer with, and
// with several, picking one at random would make a page's answer depend
// on Go's map ordering.
func (r *Of[T]) Any() (T, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.items) != 1 {
		var zero T
		return zero, false
	}
	for _, item := range r.items {
		return item, true
	}
	var zero T
	return zero, false
}
