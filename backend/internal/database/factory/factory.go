// Package factory constructs database drivers from stored records. It
// is the only place mapping an engine "type" to an implementation, so
// adding one is a single entry here plus the implementation.
package factory

import (
	"fmt"

	"lab-cloud-manager/internal/database"
	"lab-cloud-manager/internal/database/mysql"
	"lab-cloud-manager/internal/database/postgres"
	"lab-cloud-manager/internal/store"
)

// Types lists supported engines, in display order.
var Types = []string{"postgres", "mysql"}

func Build(s *store.DatabaseServer) (database.Driver, error) {
	switch s.Type {
	case "postgres":
		return postgres.New(postgres.Config{
			Host:     s.Host,
			Port:     s.Port,
			Username: s.Username,
			Password: s.Password,
			Database: s.Database,
			SSLMode:  s.SSLMode,
		})
	case "mysql":
		return mysql.New(mysql.Config{
			Host:     s.Host,
			Port:     s.Port,
			Username: s.Username,
			Password: s.Password,
			Database: s.Database,
			SSLMode:  s.SSLMode,
		})
	default:
		return nil, fmt.Errorf("factory: unknown database engine %q", s.Type)
	}
}
