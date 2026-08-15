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
