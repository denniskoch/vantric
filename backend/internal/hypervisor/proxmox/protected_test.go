package proxmox

import (
	"encoding/json"
	"testing"
)

// Proxmox reports `protected` as 1, not true, and only once some
// archive actually is protected — so a lab that has never set one never
// meets this. When it does, decoding into a plain bool fails the WHOLE
// response and every archive on that hypervisor disappears from the
// console while sitting safely on the disk. That is what this pins.
func TestProtectedDecodesFromEitherShape(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want bool
	}{
		{`{"protected":1}`, true},
		{`{"protected":0}`, false},
		{`{"protected":true}`, true},
		{`{"protected":false}`, false},
		{`{}`, false}, // omitted is how Proxmox says "not protected"
	} {
		var out struct {
			Protected flexBool `json:"protected"`
		}
		if err := json.Unmarshal([]byte(tc.raw), &out); err != nil {
			t.Errorf("%s: %v", tc.raw, err)
			continue
		}
		if bool(out.Protected) != tc.want {
			t.Errorf("%s decoded to %v, want %v", tc.raw, bool(out.Protected), tc.want)
		}
	}
}

// And the same trap one field over: ctime and size arrive as integers
// from an NFS datastore and as quoted strings from LVM. This one hid
// every orphaned disk on those pools.
func TestSizesDecodeFromEitherShape(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want int64
	}{
		{`{"ctime":1787567164}`, 1787567164},
		{`{"ctime":"1787567164"}`, 1787567164},
		{`{"ctime":""}`, 0},
		{`{}`, 0},
	} {
		var out struct {
			CTime flexInt64 `json:"ctime"`
		}
		if err := json.Unmarshal([]byte(tc.raw), &out); err != nil {
			t.Errorf("%s: %v", tc.raw, err)
			continue
		}
		if int64(out.CTime) != tc.want {
			t.Errorf("%s decoded to %d, want %d", tc.raw, int64(out.CTime), tc.want)
		}
	}
}
