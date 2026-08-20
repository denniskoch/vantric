package proxmox

import (
	"testing"

	"vantric/internal/hypervisor"
)

// A node and a storage name arrive from a request body and went into the
// URL untouched. The token behind them is typically root@pam!… , so what
// is at stake is every endpoint that token can reach.
func TestAPIPathEscapesWhatItInterpolates(t *testing.T) {
	cases := []struct {
		name string
		got  string
		want string
	}{
		{
			"an ordinary call is unchanged",
			apiPath("/nodes/%s/storage/%s/download-url", "pve1", "local-lvm"),
			"/nodes/pve1/storage/local-lvm/download-url",
		},
		{
			"a node that climbs out of its segment",
			apiPath("/nodes/%s/status", "x/../../access/users"),
			"/nodes/x%2F..%2F..%2Faccess%2Fusers/status",
		},
		{
			"a storage that grafts on a query",
			apiPath("/nodes/%s/storage/%s/upload", "pve1", "local?content=iso"),
			"/nodes/pve1/storage/local%3Fcontent=iso/upload",
		},
		{
			// Numbers can't carry a delimiter, and must not be mangled.
			"a vmid stays a number",
			apiPath("/nodes/%s/qemu/%d/config", "pve1", 101),
			"/nodes/pve1/qemu/101/config",
		},
		{
			// A volume id genuinely contains a slash, and Proxmox wants it
			// escaped — it always was, at this one call site. The rule is
			// escape ONCE: this is what a second pass would produce.
			"a volume id is escaped exactly once",
			apiPath("/nodes/%s/storage/%s/content/%s", "pve1", "local", "local:iso/debian.iso"),
			"/nodes/pve1/storage/local/content/local:iso%2Fdebian.iso",
		},
		{
			// A named string type. A `string` type assertion would skip
			// this silently, which is the failure this replaces.
			"a named string type is still escaped",
			apiPath("/nodes/%s/x", hypervisor.MetricTimeframe("a/b")),
			"/nodes/a%2Fb/x",
		},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s:\n got %q\nwant %q", c.name, c.got, c.want)
		}
	}
}
