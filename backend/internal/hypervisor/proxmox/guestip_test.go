package proxmox

import "testing"

// Every case here is a real guest in the lab this was written for. The
// old rule — first interface that isn't lo — got the right answer on
// some of them by luck, which is exactly why it needed replacing: a
// stored address that is really the guest's own container bridge looks
// perfectly fine in a list and fails at Connect.
func TestPickGuestIP(t *testing.T) {
	cases := map[string]struct {
		interfaces []guestInterface
		want       string
	}{
		"docker host, NIC listed first": {
			interfaces: []guestInterface{
				{Name: "lo", IPv4: []string{"127.0.0.1"}},
				{Name: "ens18", IPv4: []string{"192.168.80.110"}},
				{Name: "docker0", IPv4: []string{"172.17.0.1"}},
				{Name: "br-6b7685505ca5", IPv4: []string{"172.18.0.1"}},
				{Name: "vethc6e49b8"},
			},
			want: "192.168.80.110",
		},
		"docker host, bridges listed first": {
			interfaces: []guestInterface{
				{Name: "lo", IPv4: []string{"127.0.0.1"}},
				{Name: "docker0", IPv4: []string{"172.17.0.1"}},
				{Name: "br-4795f6b9033a", IPv4: []string{"172.18.0.1"}},
				{Name: "ens18", IPv4: []string{"192.168.80.158"}},
			},
			want: "192.168.80.158",
		},
		"tailscale is not the LAN address": {
			interfaces: []guestInterface{
				{Name: "lo", IPv4: []string{"127.0.0.1"}},
				{Name: "tailscale0", IPv4: []string{"100.105.80.6"}},
				{Name: "enp6s18", IPv4: []string{"192.168.80.6"}},
			},
			want: "192.168.80.6",
		},
		"a tunnel beats nothing": {
			interfaces: []guestInterface{
				{Name: "lo", IPv4: []string{"127.0.0.1"}},
				{Name: "tailscale0", IPv4: []string{"100.105.80.6"}},
				{Name: "docker0", IPv4: []string{"172.17.0.1"}},
			},
			want: "100.105.80.6",
		},
		"a bridge beats nothing, since something is better than blank": {
			interfaces: []guestInterface{
				{Name: "lo", IPv4: []string{"127.0.0.1"}},
				{Name: "docker0", IPv4: []string{"172.17.0.1"}},
			},
			want: "172.17.0.1",
		},
		"DHCP failed, so the self-assigned address is not an answer": {
			interfaces: []guestInterface{
				{Name: "lo", IPv4: []string{"127.0.0.1"}},
				{Name: "ens18", IPv4: []string{"169.254.12.9"}},
			},
			want: "",
		},
		"no agent, no interfaces": {interfaces: nil, want: ""},
	}
	for name, c := range cases {
		if got := pickGuestIP(c.interfaces); got != c.want {
			t.Errorf("%s: got %q, want %q", name, got, c.want)
		}
	}
}
