// Package rustfs implements storage.Provider against RustFS — an
// S3-compatible object store that also answers MinIO's admin API v3.
//
// Two APIs, one credential. Buckets and objects are plain S3; capacity,
// per-bucket usage and quotas come from /minio/admin/v3/*, which RustFS
// serves under both that prefix and /rustfs/admin/v3/*. MinIO's prefix
// is used here because it is the one a MinIO-compatible store is most
// likely to have.
//
// What is NOT implemented, deliberately: users and access keys. Those
// admin endpoints take MinIO's ENCRYPTED payload envelope — add-user
// answers "failed to decrypt MinIO admin payload" to a plain JSON body,
// and list-users returns ciphertext — so they need MinIO's sio/DARE
// format implemented before they can be spoken to at all. Everything a
// bucket page needs is plaintext; that is a separate piece of work and
// its absence costs nothing here.
package rustfs

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"vantric/internal/storage"
)

type Config struct {
	// BaseURL is the S3 endpoint, e.g. http://192.168.80.219:9000.
	BaseURL   string
	AccessKey string
	SecretKey string
	// Region is what the signature is scoped to. Object stores outside a
	// cloud have no region, but SigV4 requires one, so this defaults to
	// us-east-1 the way every S3 client does.
	Region             string
	InsecureSkipVerify bool
}

type Driver struct {
	cfg    Config
	client *http.Client
}

func New(cfg Config) *Driver {
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	transport := &http.Transport{}
	if cfg.InsecureSkipVerify {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &Driver{cfg: cfg, client: &http.Client{Timeout: 30 * time.Second, Transport: transport}}
}

func (d *Driver) Type() string { return "rustfs" }

// do signs and sends. body must be a []byte or nil: signing needs the
// payload hash up front, so anything streamed goes through doStream.
func (d *Driver) do(ctx context.Context, method, path string, query url.Values, body []byte) (*http.Response, error) {
	u := d.cfg.BaseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var reader io.Reader
	if body != nil {
		reader = strings.NewReader(string(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, err
	}
	hash := emptyPayload
	if body != nil {
		sum := sha256.Sum256(body)
		hash = hex.EncodeToString(sum[:])
		req.ContentLength = int64(len(body))
	}
	sign(req, d.cfg.AccessKey, d.cfg.SecretKey, d.cfg.Region, hash)
	return d.client.Do(req)
}

// s3Error is the XML shape every S3-compatible store returns on failure.
type s3Error struct {
	Code    string `xml:"Code"`
	Message string `xml:"Message"`
}

// check turns a response into an error, reading the body for the reason.
// The status alone is close to useless here: a 403 is a wrong key, a
// clock skew, or a signature bug, and only the body distinguishes them.
func check(resp *http.Response, action string) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return storage.ErrNotFound
	}
	var e s3Error
	if err := xml.Unmarshal(raw, &e); err == nil && e.Code != "" {
		switch e.Code {
		case "SignatureDoesNotMatch":
			return fmt.Errorf("the secret key was rejected (signature mismatch)")
		case "InvalidAccessKeyId":
			return fmt.Errorf("no such access key on this store")
		case "AccessDenied":
			return fmt.Errorf("this access key isn't allowed to %s", action)
		case "BucketNotEmpty":
			return fmt.Errorf("the bucket still has objects in it")
		case "BucketAlreadyOwnedByYou", "BucketAlreadyExists":
			return fmt.Errorf("a bucket with this name already exists")
		}
		return fmt.Errorf("%s: %s", e.Code, e.Message)
	}
	return fmt.Errorf("%s failed with status %d", action, resp.StatusCode)
}

func (d *Driver) Verify(ctx context.Context) error {
	resp, err := d.do(ctx, http.MethodGet, "/", nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return check(resp, "list buckets")
}

// --- buckets ---

type listAllMyBuckets struct {
	Buckets []struct {
		Name         string `xml:"Name"`
		CreationDate string `xml:"CreationDate"`
	} `xml:"Buckets>Bucket"`
}

func (d *Driver) Buckets(ctx context.Context) ([]storage.Bucket, error) {
	resp, err := d.do(ctx, http.MethodGet, "/", nil, nil)
	if err != nil {
		return nil, err
	}
	if err := check(resp, "list buckets"); err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out listAllMyBuckets
	if err := xml.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	buckets := make([]storage.Bucket, 0, len(out.Buckets))
	for _, b := range out.Buckets {
		bucket := storage.Bucket{Name: b.Name}
		if t, err := time.Parse(time.RFC3339, b.CreationDate); err == nil {
			bucket.CreatedAt = t.Unix()
		}
		buckets = append(buckets, bucket)
	}
	// Usage is a separate, scanner-driven read. A failure there must not
	// lose the bucket list — the names are the page, the sizes are a
	// column — so it's best-effort and Scanned stays false.
	d.fillUsage(ctx, buckets)
	return buckets, nil
}

type dataUsage struct {
	BucketsCount int64            `json:"buckets_count"`
	BucketSizes  map[string]int64 `json:"bucket_sizes"`
	BucketsUsage map[string]struct {
		Size         int64 `json:"size"`
		ObjectsCount int64 `json:"objects_count"`
	} `json:"buckets_usage"`
	ObjectsTotalCount int64 `json:"objects_total_count"`
	ObjectsTotalSize  int64 `json:"objects_total_size"`
	TotalCapacity     int64 `json:"total_capacity"`
	TotalUsedCapacity int64 `json:"total_used_capacity"`
	TotalFreeCapacity int64 `json:"total_free_capacity"`
	// SnapshotComplete is the store telling us whether its own scan has
	// finished. Without it a brand-new bucket's zero is indistinguishable
	// from an empty one's.
	SnapshotComplete bool `json:"usage_snapshot_complete"`
}

func (d *Driver) dataUsage(ctx context.Context) (*dataUsage, error) {
	resp, err := d.do(ctx, http.MethodGet, "/minio/admin/v3/datausageinfo", nil, nil)
	if err != nil {
		return nil, err
	}
	if err := check(resp, "read usage"); err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out dataUsage
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (d *Driver) fillUsage(ctx context.Context, buckets []storage.Bucket) {
	usage, err := d.dataUsage(ctx)
	if err != nil {
		return
	}
	for i := range buckets {
		name := buckets[i].Name
		if u, ok := usage.BucketsUsage[name]; ok {
			buckets[i].SizeBytes = u.Size
			buckets[i].Objects = u.ObjectsCount
			buckets[i].Scanned = true
			continue
		}
		if size, ok := usage.BucketSizes[name]; ok {
			buckets[i].SizeBytes = size
			buckets[i].Scanned = true
		}
	}
}

func (d *Driver) CreateBucket(ctx context.Context, name string) error {
	resp, err := d.do(ctx, http.MethodPut, "/"+name, nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return check(resp, "create a bucket")
}

func (d *Driver) DeleteBucket(ctx context.Context, name string) error {
	resp, err := d.do(ctx, http.MethodDelete, "/"+name, nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return check(resp, "delete a bucket")
}

// SetBucketQuota implements storage.QuotaProvider. 0 removes the quota.
func (d *Driver) SetBucketQuota(ctx context.Context, bucket string, bytes int64) error {
	body := []byte(fmt.Sprintf(`{"quota":%d,"quotatype":"hard"}`, bytes))
	resp, err := d.do(ctx, http.MethodPut, "/minio/admin/v3/set-bucket-quota",
		url.Values{"bucket": {bucket}}, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return check(resp, "set a quota")
}

// --- objects ---

type listBucketResult struct {
	Contents []struct {
		Key          string `xml:"Key"`
		Size         int64  `xml:"Size"`
		LastModified string `xml:"LastModified"`
		ETag         string `xml:"ETag"`
		StorageClass string `xml:"StorageClass"`
	} `xml:"Contents"`
	CommonPrefixes []struct {
		Prefix string `xml:"Prefix"`
	} `xml:"CommonPrefixes"`
	NextContinuationToken string `xml:"NextContinuationToken"`
	IsTruncated           bool   `xml:"IsTruncated"`
}

func (d *Driver) Objects(ctx context.Context, bucket, prefix, delimiter, token string, limit int) (*storage.ObjectPage, error) {
	if limit <= 0 {
		limit = 100
	}
	q := url.Values{"list-type": {"2"}, "max-keys": {strconv.Itoa(limit)}}
	if prefix != "" {
		q.Set("prefix", prefix)
	}
	if delimiter != "" {
		q.Set("delimiter", delimiter)
	}
	if token != "" {
		q.Set("continuation-token", token)
	}
	resp, err := d.do(ctx, http.MethodGet, "/"+bucket, q, nil)
	if err != nil {
		return nil, err
	}
	if err := check(resp, "list objects"); err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out listBucketResult
	if err := xml.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	page := &storage.ObjectPage{
		Objects:   []storage.Object{},
		Prefixes:  []string{},
		NextToken: out.NextContinuationToken,
		Truncated: out.IsTruncated,
	}
	for _, o := range out.Contents {
		obj := storage.Object{
			Key:          o.Key,
			SizeBytes:    o.Size,
			ETag:         strings.Trim(o.ETag, `"`),
			StorageClass: o.StorageClass,
		}
		if t, err := time.Parse(time.RFC3339, o.LastModified); err == nil {
			obj.ModifiedAt = t.Unix()
		}
		page.Objects = append(page.Objects, obj)
	}
	for _, p := range out.CommonPrefixes {
		page.Prefixes = append(page.Prefixes, p.Prefix)
	}
	return page, nil
}

// PutObject streams the body up under a signature over UNSIGNED-PAYLOAD.
//
// The alternative is hashing the whole object before sending it, which
// for a multi-GB upload means reading it twice and holding it somewhere
// in between. S3 allows the unsigned form precisely for this, and the
// request is still authenticated — only the body is outside the
// signature.
func (d *Driver) PutObject(ctx context.Context, bucket, key string, size int64, body io.Reader) error {
	u := d.cfg.BaseURL + "/" + bucket + "/" + escapeKey(key)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, body)
	if err != nil {
		return err
	}
	req.ContentLength = size
	sign(req, d.cfg.AccessKey, d.cfg.SecretKey, d.cfg.Region, "UNSIGNED-PAYLOAD")
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return check(resp, "upload an object")
}

func (d *Driver) GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, int64, error) {
	resp, err := d.do(ctx, http.MethodGet, "/"+bucket+"/"+escapeKey(key), nil, nil)
	if err != nil {
		return nil, 0, err
	}
	if err := check(resp, "read an object"); err != nil {
		return nil, 0, err
	}
	return resp.Body, resp.ContentLength, nil
}

func (d *Driver) DeleteObject(ctx context.Context, bucket, key string) error {
	resp, err := d.do(ctx, http.MethodDelete, "/"+bucket+"/"+escapeKey(key), nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return check(resp, "delete an object")
}

// escapeKey percent-encodes an object key for the URL path while leaving
// "/" alone — a key's slashes are part of its name and are what makes a
// flat keyspace look like folders.
func escapeKey(key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}

// --- the store itself ---

type adminInfo struct {
	Info struct {
		Mode         string `json:"mode"`
		DeploymentID string `json:"deploymentID"`
		Buckets      struct {
			Count int64 `json:"count"`
		} `json:"buckets"`
		Objects struct {
			Count int64 `json:"count"`
		} `json:"objects"`
		Usage struct {
			Size int64 `json:"size"`
		} `json:"usage"`
		Backend struct {
			BackendType  string `json:"backendType"`
			OnlineDisks  int    `json:"onlineDisks"`
			OfflineDisks int    `json:"offlineDisks"`
		} `json:"backend"`
		Servers []struct {
			State   string `json:"state"`
			Uptime  int64  `json:"uptime"`
			Version string `json:"version"`
		} `json:"servers"`
	} `json:"info"`
}

func (d *Driver) Info(ctx context.Context) (*storage.Info, error) {
	resp, err := d.do(ctx, http.MethodGet, "/minio/admin/v3/info", nil, nil)
	if err != nil {
		return nil, err
	}
	if err := check(resp, "read store info"); err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out adminInfo
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	info := &storage.Info{
		Online:       out.Info.Mode == "online",
		Backend:      out.Info.Backend.BackendType,
		DeploymentID: out.Info.DeploymentID,
		OnlineDisks:  out.Info.Backend.OnlineDisks,
		OfflineDisks: out.Info.Backend.OfflineDisks,
		Buckets:      out.Info.Buckets.Count,
		Objects:      out.Info.Objects.Count,
		UsedBytes:    out.Info.Usage.Size,
	}
	if len(out.Info.Servers) > 0 {
		info.Version = out.Info.Servers[0].Version
		info.UptimeSecs = out.Info.Servers[0].Uptime
	}
	// Capacity lives in the usage report rather than info, and a failure
	// to read it leaves the three byte counts zero rather than losing
	// everything above.
	if usage, err := d.dataUsage(ctx); err == nil {
		info.TotalBytes = usage.TotalCapacity
		info.FreeBytes = usage.TotalFreeCapacity
		if usage.TotalUsedCapacity > 0 {
			info.UsedBytes = usage.TotalUsedCapacity
		}
	}
	return info, nil
}
