package proxmox

import (
	"fmt"
	"net/url"
	"reflect"
)

// Every request path in this driver carries values this console did not
// choose. A node name, a storage name, a volume id and a VM id arrive
// from a request body or from the hypervisor itself, and each one was
// interpolated with fmt.Sprintf and no escaping. Two — a volume id and a
// task id — were wrapped in url.PathEscape, which is the tell that the
// concern was understood and then applied one call site at a time.
//
// What that costs: the stored token is typically root@pam!… with wide
// privileges, so the ceiling is "every endpoint that token can reach",
// not "the endpoints this driver meant to call". Go's HTTP client does
// not remove dot segments, so a node named "x/../../access/users" is
// sent exactly as written — and grafting query parameters onto a call by
// appending a "?" needs no path normalisation at all.
//
// apiPath escapes every interpolated value as a PATH SEGMENT. It works
// off the reflected kind rather than a `string` type assertion, because
// several of these are named string types (hypervisor.MetricTimeframe)
// and an assertion would skip them silently — which is the failure mode
// this replaces, not one to reproduce. Numbers pass through untouched:
// they cannot carry a delimiter.
//
// A value going into a QUERY needs url.QueryEscape instead — PathEscape
// deliberately leaves & and = alone — so those few are built by
// appending to an apiPath result rather than by a %s inside one. Escape
// a value once: passing an already-escaped string through here yields
// %252F where %2F was meant.
func apiPath(format string, args ...any) string {
	escaped := make([]any, len(args))
	for i, arg := range args {
		if v := reflect.ValueOf(arg); v.Kind() == reflect.String {
			escaped[i] = url.PathEscape(v.String())
			continue
		}
		escaped[i] = arg
	}
	return fmt.Sprintf(format, escaped...)
}
