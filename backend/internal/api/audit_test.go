package api

import "testing"

// The payload column has been redacted from the start; the error column
// held whatever an upstream said, quoted verbatim into an error and
// stored. This is that rule applied to the other column — narrow on
// purpose, because an audit trail whose errors have been mangled into
// uselessness is worse than the risk it was guarding against.
func TestRedactSecrets(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{
			"a hypervisor echoing a parameter back",
			`proxmox: POST /nodes/pve1/lxc: 400 Bad Request: parameter verification failed - password=hunter2`,
			`proxmox: POST /nodes/pve1/lxc: 400 Bad Request: parameter verification failed - password=[redacted]`,
		},
		{
			"a quoted JSON field",
			`unifi: login failed (401): {"username":"admin","password":"hunter2"}`,
			`unifi: login failed (401): {"username":"admin","password":"[redacted]"}`,
		},
		{
			"a URL carrying credentials",
			`reaching postgres://admin:hunter2@db.lab:5432/app: connection refused`,
			`reaching postgres://admin:[redacted]@db.lab:5432/app: connection refused`,
		},
		{
			"the MySQL DSN form, which has no scheme",
			`dial admin:hunter2@tcp(db.lab:3306)/app: refused`,
			`dial admin:[redacted]@tcp(db.lab:3306)/app: refused`,
		},
		{
			"an auth header quoted back",
			`fleet: 401 with Authorization: Bearer eyJhbGciOi.J9x-Y_z`,
			`fleet: 401 with Authorization: Bearer [redacted]`,
		},
		{
			"token and secret in a query string",
			`GET /callback?code=abc&client_secret=shh&state=xyz failed`,
			`GET /callback?code=abc&client_secret=[redacted]&state=xyz failed`,
		},

		// The other half of the job: everything below must survive
		// intact, or the column stops being worth reading.
		{
			"prose that merely contains the word key",
			`NoSuchKey: The specified key does not exist`,
			`NoSuchKey: The specified key does not exist`,
		},
		{
			"a connection failure, which is the common case",
			`failed to connect to ` + "`user=admin database=app`" + `: dial tcp 10.0.0.5:5432: connect: connection refused`,
			`failed to connect to ` + "`user=admin database=app`" + `: dial tcp 10.0.0.5:5432: connect: connection refused`,
		},
		{
			"settings that only sound alarming",
			`postgres: sslmode=disable application_name=vantric: no such host`,
			`postgres: sslmode=disable application_name=vantric: no such host`,
		},
		{
			"the fields the payload rule already exempts",
			`iam: publicKey=ssh-ed25519AAAAC3 tokenId=lcm rejected`,
			`iam: publicKey=ssh-ed25519AAAAC3 tokenId=lcm rejected`,
		},
		{
			"a plain hypervisor error",
			`proxmox: GET /nodes/pve1/qemu/101/config: 500 Internal Server Error: no such VM`,
			`proxmox: GET /nodes/pve1/qemu/101/config: 500 Internal Server Error: no such VM`,
		},
		{"empty stays empty", "", ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := redactSecrets(c.in); got != c.want {
				t.Errorf("\n in   %s\n got  %s\n want %s", c.in, got, c.want)
			}
		})
	}
}
