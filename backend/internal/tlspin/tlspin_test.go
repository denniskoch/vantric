package tlspin

import "testing"

// The fingerprint capstan printed and openssl agrees with, in the three
// shapes somebody might paste it. A pin that rejects a correct value
// because of punctuation is a pin that gets switched off.
func TestNormalizeAcceptsHowPeoplePasteIt(t *testing.T) {
	want := "A4:91:86:8E:13:0D:AC:3D:9F:90:07:D4:8C:B0:C7:DB:C8:63:27:48:24:86:79:73:78:4E:A1:2D:D3:4C:75:06"
	for _, given := range []string{
		want,
		"a491868e130dac3d9f9007d48cb0c7dbc8632748248679737 84ea12dd34c7506",
		"  a4:91:86:8e:13:0d:ac:3d:9f:90:07:d4:8c:b0:c7:db:c8:63:27:48:24:86:79:73:78:4e:a1:2d:d3:4c:75:06  ",
		"SHA256:a491868e130dac3d9f9007d48cb0c7dbc863274824867973784ea12dd34c7506",
	} {
		if got := Normalize(given); got != want {
			t.Errorf("Normalize(%q) = %q", given, got)
		}
	}
	// And anything that isn't 32 bytes of hex is not a fingerprint,
	// however much it looks like one.
	for _, bad := range []string{"", "deadbeef", "not a fingerprint", "a4:91:86"} {
		if got := Normalize(bad); got != "" {
			t.Errorf("Normalize(%q) = %q, want empty", bad, got)
		}
	}
}

func TestConfigRefusesAPinItCannotUse(t *testing.T) {
	if _, err := Config("nonsense"); err == nil {
		t.Error("a config was built from an unusable pin")
	}
}
