package rustfs

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"slices"
	"testing"

	"vantric/internal/storage"
)

// A live round trip against a real store, skipped unless told where one
// is. It exists because the signing in sigv4.go cannot be checked any
// other way: a canonical-request bug produces a valid-looking signature
// that the server rejects as a credential error, and no unit test on the
// signing function alone would notice.
//
//	VANTRIC_TEST_S3_URL=http://host:9000 \
//	VANTRIC_TEST_S3_KEY=... VANTRIC_TEST_S3_SECRET=... \
//	go test ./internal/storage/rustfs -run Live -v
func TestLiveRoundTrip(t *testing.T) {
	url, key, secret := os.Getenv("VANTRIC_TEST_S3_URL"),
		os.Getenv("VANTRIC_TEST_S3_KEY"), os.Getenv("VANTRIC_TEST_S3_SECRET")
	if url == "" || key == "" || secret == "" {
		t.Skip("set VANTRIC_TEST_S3_URL/KEY/SECRET to run this against a real store")
	}
	d := New(Config{BaseURL: url, AccessKey: key, SecretKey: secret})
	ctx := context.Background()

	if err := d.Verify(ctx); err != nil {
		t.Fatalf("Verify: %v", err)
	}

	info, err := d.Info(ctx)
	if err != nil {
		t.Fatalf("Info: %v", err)
	}
	if !info.Online {
		t.Error("store reports itself offline")
	}
	t.Logf("store: version=%q backend=%q disks=%d/%d capacity=%d",
		info.Version, info.Backend, info.OnlineDisks,
		info.OnlineDisks+info.OfflineDisks, info.TotalBytes)

	const bucket = "vantric-selftest"
	const key1 = "nested/path/hello.txt"
	body := []byte("hello from the vantric driver")

	if err := d.CreateBucket(ctx, bucket); err != nil {
		t.Fatalf("CreateBucket: %v", err)
	}
	// Tidy up even if an assertion below fails, or the next run trips
	// over a bucket that already exists.
	defer func() {
		_ = d.DeleteObject(ctx, bucket, key1)
		if err := d.DeleteBucket(ctx, bucket); err != nil {
			t.Errorf("cleanup DeleteBucket: %v", err)
		}
	}()

	if err := d.PutObject(ctx, bucket, key1, int64(len(body)), bytes.NewReader(body)); err != nil {
		t.Fatalf("PutObject: %v", err)
	}

	// The delimiter should collapse "nested/" to a prefix rather than
	// listing the key, which is what makes the UI browsable as folders.
	page, err := d.Objects(ctx, bucket, "", "/", "", 100)
	if err != nil {
		t.Fatalf("Objects: %v", err)
	}
	if len(page.Prefixes) != 1 || page.Prefixes[0] != "nested/" {
		t.Errorf("prefixes = %v, want [nested/]", page.Prefixes)
	}
	if len(page.Objects) != 0 {
		t.Errorf("objects at the root = %v, want none", page.Objects)
	}

	// Without a delimiter the full key shows.
	page, err = d.Objects(ctx, bucket, "", "", "", 100)
	if err != nil {
		t.Fatalf("Objects flat: %v", err)
	}
	if len(page.Objects) != 1 || page.Objects[0].Key != key1 {
		t.Fatalf("flat listing = %+v, want one %s", page.Objects, key1)
	}
	if page.Objects[0].SizeBytes != int64(len(body)) {
		t.Errorf("size = %d, want %d", page.Objects[0].SizeBytes, len(body))
	}

	reader, size, err := d.GetObject(ctx, bucket, key1)
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	got, _ := io.ReadAll(reader)
	reader.Close()
	if !bytes.Equal(got, body) {
		t.Errorf("read back %q, want %q", got, body)
	}
	if size != int64(len(body)) {
		t.Errorf("content length = %d, want %d", size, len(body))
	}

	// The quota capability is optional; exercise it where it exists.
	if q, ok := any(d).(interface {
		SetBucketQuota(context.Context, string, int64) error
	}); ok {
		if err := q.SetBucketQuota(ctx, bucket, 1<<30); err != nil {
			t.Errorf("SetBucketQuota: %v", err)
		}
	}

	// A bucket with an object in it must NOT delete — the driver should
	// surface the store's refusal rather than swallowing it.
	if err := d.DeleteBucket(ctx, bucket); err == nil {
		t.Error("deleting a non-empty bucket succeeded; expected a refusal")
	}
}

// The IAM half, same skip rule. This is where the prefix discovery gets
// pinned: run it against a driver pointed at /minio/admin/v3 and every
// call here fails on an encrypted payload, which is the bug that made
// users look unimplementable.
func TestLiveIAM(t *testing.T) {
	url, key, secret := os.Getenv("VANTRIC_TEST_S3_URL"),
		os.Getenv("VANTRIC_TEST_S3_KEY"), os.Getenv("VANTRIC_TEST_S3_SECRET")
	if url == "" || key == "" || secret == "" {
		t.Skip("set VANTRIC_TEST_S3_URL/KEY/SECRET to run this against a real store")
	}
	d := New(Config{BaseURL: url, AccessKey: key, SecretKey: secret})
	ctx := context.Background()

	policies, err := d.Policies(ctx)
	if err != nil {
		t.Fatalf("Policies: %v", err)
	}
	byName := map[string][]string{}
	for _, p := range policies {
		byName[p.Name] = p.Actions
	}
	if _, ok := byName["readonly"]; !ok {
		t.Fatalf("no stock readonly policy; got %v", byName)
	}
	// The trap worth pinning: the stock readonly grants GetObject and NOT
	// ListBucket, so a key with it can fetch a name it already knows and
	// cannot browse. The UI says so, and this is where that claim is
	// checked against the store rather than against the docs.
	if !slices.Contains(byName["readonly"], "s3:GetObject") {
		t.Errorf("readonly actions = %v, expected s3:GetObject", byName["readonly"])
	}
	if slices.Contains(byName["readonly"], "s3:ListBucket") {
		t.Log("NOTE: this store's readonly now includes s3:ListBucket — the UI's warning is stale")
	}

	const ak = "vantric-selftest-key"
	const sk = "vantric-selftest-secret"

	if err := d.CreateUser(ctx, ak, sk); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	defer func() {
		if err := d.DeleteUser(ctx, ak); err != nil {
			t.Errorf("cleanup DeleteUser: %v", err)
		}
	}()

	// Creating the same key again must be refused rather than silently
	// replacing the secret of something already in use.
	if err := d.CreateUser(ctx, ak, "another-secret"); err == nil {
		t.Error("creating a duplicate access key succeeded; expected a refusal")
	}

	find := func(t *testing.T) storage.User {
		t.Helper()
		users, err := d.Users(ctx)
		if err != nil {
			t.Fatalf("Users: %v", err)
		}
		for _, u := range users {
			if u.AccessKey == ak {
				return u
			}
		}
		t.Fatalf("%s missing from %d users", ak, len(users))
		return storage.User{}
	}

	if u := find(t); !u.Enabled || u.Policy != "" {
		t.Errorf("new key = %+v, want enabled with no policy", u)
	}

	if err := d.SetUserPolicy(ctx, ak, "readonly"); err != nil {
		t.Fatalf("SetUserPolicy: %v", err)
	}
	if u := find(t); u.Policy != "readonly" {
		t.Errorf("policy = %q, want readonly", u.Policy)
	}

	if err := d.SetUserStatus(ctx, ak, false); err != nil {
		t.Fatalf("SetUserStatus: %v", err)
	}
	if u := find(t); u.Enabled {
		t.Error("key still enabled after being switched off")
	}

	// THE ONE THAT MATTERS: replacing the secret must not re-enable a key
	// that was switched off. add-user applies whatever status its body
	// carries, so a hardcoded "enabled" here would quietly un-revoke a
	// credential from a form that only claimed to change its secret.
	if err := d.SetUserSecret(ctx, ak, "rotated-selftest-secret"); err != nil {
		t.Fatalf("SetUserSecret: %v", err)
	}
	u := find(t)
	if u.Enabled {
		t.Error("replacing the secret re-enabled a disabled key")
	}
	if u.Policy != "readonly" {
		t.Errorf("policy = %q after replacing the secret, want readonly kept", u.Policy)
	}

	// Unbinding leaves a key that can sign and reach nothing.
	if err := d.SetUserPolicy(ctx, ak, ""); err != nil {
		t.Fatalf("SetUserPolicy unbind: %v", err)
	}
	if u := find(t); u.Policy != "" {
		t.Errorf("policy = %q after unbinding, want none", u.Policy)
	}
	// And unbinding again is not an error — there's nothing to detach.
	if err := d.SetUserPolicy(ctx, ak, ""); err != nil {
		t.Errorf("SetUserPolicy unbind twice: %v", err)
	}

	// A missing key is ErrNotFound, not a generic failure — the API layer
	// turns that into a 404.
	if err := d.SetUserStatus(ctx, "vantric-no-such-key", true); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("status on a missing key = %v, want ErrNotFound", err)
	}
}
