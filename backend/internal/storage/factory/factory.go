// Package factory constructs storage providers from stored records. It
// is the only place mapping a provider "type" to an implementation, so
// adding one is a single entry here plus the implementation.
package factory

import (
	"fmt"

	"vantric/internal/storage"
	"vantric/internal/storage/rustfs"
	"vantric/internal/store"
)

// Types lists supported provider types, in display order.
var Types = []string{"rustfs"}

func Build(p *store.StorageProvider) (storage.Provider, error) {
	switch p.Type {
	case "rustfs":
		return rustfs.New(rustfs.Config{
			BaseURL:            p.BaseURL,
			AccessKey:          p.AccessKey,
			SecretKey:          p.SecretKey,
			Region:             p.Region,
			InsecureSkipVerify: p.InsecureTLS,
		}), nil
	default:
		return nil, fmt.Errorf("factory: unknown storage provider type %q", p.Type)
	}
}
