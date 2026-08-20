package registry_test

import (
	"sync"
	"testing"

	"vantric/internal/registry"
)

type backend struct{ name string }

func TestRegistry(t *testing.T) {
	r := registry.New[*backend]()

	if _, ok := r.Get("nope"); ok {
		t.Error("an empty registry answered Get")
	}
	if _, ok := r.Any(); ok {
		t.Error("an empty registry answered Any")
	}

	one := &backend{"one"}
	r.Set("a", one)
	if got, ok := r.Get("a"); !ok || got != one {
		t.Error("Get didn't return what Set stored")
	}
	// A lab with exactly one of something addresses it without an id.
	if got, ok := r.Any(); !ok || got != one {
		t.Error("Any didn't return the only backend")
	}

	// With two, Any must refuse rather than pick — otherwise a page's
	// answer depends on Go's map ordering.
	r.Set("b", &backend{"two"})
	if _, ok := r.Any(); ok {
		t.Error("Any picked one of two")
	}

	r.Remove("b")
	if _, ok := r.Get("b"); ok {
		t.Error("Remove didn't")
	}
	if _, ok := r.Any(); !ok {
		t.Error("Any didn't recover once one was left")
	}
	r.Remove("missing") // must not panic
}

// The zero value works, which is the point of initialising the map in
// Set rather than only in New. A registry left nil by a struct literal
// somebody edited is a panic on the first request with a green suite
// behind it — this session has already seen that exact failure once.
func TestZeroValueIsUsable(t *testing.T) {
	var r registry.Of[string]
	if _, ok := r.Get("a"); ok {
		t.Error("a zero registry answered Get")
	}
	r.Remove("a")
	r.Set("a", "value")
	if got, ok := r.Get("a"); !ok || got != "value" {
		t.Error("a zero registry couldn't be written to")
	}
}

// The registries are read on every request and written when a backend is
// added or its credentials change.
func TestConcurrentUse(t *testing.T) {
	r := registry.New[int]()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(3)
		go func(i int) { defer wg.Done(); r.Set("k", i) }(i)
		go func() { defer wg.Done(); r.Get("k") }()
		go func() { defer wg.Done(); r.Any() }()
	}
	wg.Wait()
}
