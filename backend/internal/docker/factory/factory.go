// Package factory maps a stored Docker host record onto a live driver.
//
// ONE TYPE, unlike every other factory here, and that is the point of
// the Engine API decision: capstan, a socket proxy and Docker's own TLS
// listener are not three backends, they are three ways of reaching the
// same one.
package factory

import (
	"vantric/internal/docker"
	"vantric/internal/docker/engine"
	"vantric/internal/store"
)

func Build(host *store.DockerHost) (docker.Provider, error) {
	return engine.New(engine.Config{
		BaseURL:     host.BaseURL,
		Token:       host.Token,
		Fingerprint: host.Fingerprint,
		InsecureTLS: host.InsecureTLS,
	})
}
