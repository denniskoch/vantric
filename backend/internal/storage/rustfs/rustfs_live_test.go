package rustfs

import (
	"bytes"
	"context"
	"io"
	"os"
	"testing"
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
