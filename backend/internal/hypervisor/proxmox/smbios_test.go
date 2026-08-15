package proxmox

import "testing"

// The SMBIOS UUID is what the guest calls itself to anything running
// inside it, so an empty one here is a correlation that silently never
// happens rather than an error anybody sees. Proxmox spells it as one
// field of a comma-separated list whose OTHER fields may be base64 —
// which is the trap: `base64=1` says nothing about the uuid, and the
// uuid is not always first.
func TestSMBIOSUUID(t *testing.T) {
	const want = "8b3a5f2e-1c4d-4a9b-9f11-2f0d3e4a5b6c"
	for name, cfg := range map[string]string{
		"alone":        "uuid=" + want,
		"after base64": "base64=1,uuid=" + want + ",manufacturer=UHJveG1veA==",
		"last":         "family=bGFi,uuid=" + want,
	} {
		if got := smbiosUUID(cfg); got != want {
			t.Errorf("%s: got %q, want %q", name, got, want)
		}
	}
	for name, cfg := range map[string]string{
		"unset":      "",
		"no uuid":    "base64=1,manufacturer=UHJveG1veA==",
		"not a uuid": "uuidx=nope",
	} {
		if got := smbiosUUID(cfg); got != "" {
			t.Errorf("%s: got %q, want empty", name, got)
		}
	}
}

// The serial is the field FleetDM and anything else built on osquery
// keys a host by, and unlike the uuid it IS base64-encoded whenever
// Proxmox writes base64=1 — so reading it raw would report a device
// identifier that is really "TEFCLTAwMQ==".
func TestSMBIOSSerial(t *testing.T) {
	cases := map[string]string{
		// base64=1 present: the value is encoded.
		"base64=1,uuid=8b3a5f2e-1c4d-4a9b-9f11-2f0d3e4a5b6c,serial=TEFCLTAwMQ==": "LAB-001",
		// no base64 flag: the value is literal.
		"uuid=8b3a5f2e-1c4d-4a9b-9f11-2f0d3e4a5b6c,serial=LAB-001": "LAB-001",
		// what almost every VM actually has.
		"uuid=8b3a5f2e-1c4d-4a9b-9f11-2f0d3e4a5b6c": "",
		"": "",
	}
	for cfg, want := range cases {
		if got := smbiosSerial(cfg); got != want {
			t.Errorf("smbios1 %q -> serial %q, want %q", cfg, got, want)
		}
	}
	// The uuid must not be decoded even when the flag is set.
	const withFlag = "base64=1,uuid=8b3a5f2e-1c4d-4a9b-9f11-2f0d3e4a5b6c,serial=TEFCLTAwMQ=="
	if got := smbiosUUID(withFlag); got != "8b3a5f2e-1c4d-4a9b-9f11-2f0d3e4a5b6c" {
		t.Errorf("uuid was mangled by the base64 flag: %q", got)
	}
}
