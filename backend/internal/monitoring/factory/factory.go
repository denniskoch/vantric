// Package factory constructs monitoring providers from stored records.
// The only place mapping a service "type" to an implementation.
package factory

import (
	"fmt"

	"vantric/internal/monitoring"
	"vantric/internal/monitoring/zabbix"
	"vantric/internal/store"
)

// Types lists supported services, in display order.
var Types = []string{"zabbix"}

func Build(p *store.MonitoringProvider) (monitoring.Provider, error) {
	switch p.Type {
	case "zabbix":
		return zabbix.New(zabbix.Config{
			BaseURL:     p.BaseURL,
			Token:       p.Token,
			InsecureTLS: p.InsecureTLS,
		}), nil
	default:
		return nil, fmt.Errorf("factory: unknown monitoring service type %q", p.Type)
	}
}
