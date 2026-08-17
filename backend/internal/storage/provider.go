// Package storage defines the abstraction over S3-compatible object
// stores (RustFS first). It mirrors internal/dns and internal/hypervisor:
// nothing outside internal/storage/* may import a provider's specifics.
//
// The split here is between the S3 API, which every one of these speaks,
// and the ADMIN API, which each spells differently. Buckets and objects
// come from the first; capacity, per-bucket usage and quotas from the
// second. A provider that offers no admin API can still list and create
// buckets — see the zero values on Info.
package storage

import (
	"context"
	"errors"
	"io"
	"sync"
)

// ErrNotFound is returned when a bucket or object no longer exists.
var ErrNotFound = errors.New("storage: not found")

// Bucket is a container of objects.
type Bucket struct {
	// ProviderID is filled in by the API layer, not the provider.
	ProviderID string `json:"providerId"`
	Name       string `json:"name"`
	// CreatedAt is unix seconds; 0 when the provider doesn't report it.
	CreatedAt int64 `json:"createdAt"`
	// Objects and SizeBytes come from the store's own USAGE SCANNER, not
	// from counting. They lag — a bucket written to a moment ago still
	// reports zero — so Scanned says whether the numbers mean anything
	// yet rather than letting a stale 0 read as fact.
	Objects   int64 `json:"objects"`
	SizeBytes int64 `json:"sizeBytes"`
	Scanned   bool  `json:"scanned"`
	// QuotaBytes is 0 for no quota.
	QuotaBytes int64 `json:"quotaBytes"`
}

// Object is one stored object.
type Object struct {
	Key       string `json:"key"`
	SizeBytes int64  `json:"sizeBytes"`
	// ModifiedAt is unix seconds.
	ModifiedAt int64  `json:"modifiedAt"`
	ETag       string `json:"etag"`
	// StorageClass is empty where the provider has only one.
	StorageClass string `json:"storageClass"`
}

// ObjectPage is one page of a listing. Object stores paginate by
// continuation token rather than offset, so the cursor travels with the
// results instead of being computed by the caller.
type ObjectPage struct {
	Objects []Object `json:"objects"`
	// Prefixes are the "folders" a delimiter collapsed.
	Prefixes []string `json:"prefixes"`
	// NextToken is empty on the last page.
	NextToken string `json:"nextToken"`
	Truncated bool   `json:"truncated"`
}

// Info is what the store says about itself — the substrate under the
// buckets, the way NodeStatus is the substrate under the guests.
//
// Every field is optional: a provider with no admin API leaves them
// zero, and the UI says "not reported" rather than printing a confident
// 0. That is the same rule the node detail page follows.
type Info struct {
	// ProviderID is filled in by the API layer.
	ProviderID string `json:"providerId"`
	// Online is the one field a provider must be able to answer, since
	// it is the answer to "did we reach it".
	Online  bool   `json:"online"`
	Version string `json:"version"`
	// Backend is how the bytes are stored, e.g. "Erasure" or "FS".
	Backend      string `json:"backend"`
	DeploymentID string `json:"deploymentId"`
	OnlineDisks  int    `json:"onlineDisks"`
	OfflineDisks int    `json:"offlineDisks"`
	UptimeSecs   int64  `json:"uptimeSeconds"`

	TotalBytes int64 `json:"totalBytes"`
	UsedBytes  int64 `json:"usedBytes"`
	FreeBytes  int64 `json:"freeBytes"`
	Buckets    int64 `json:"buckets"`
	Objects    int64 `json:"objects"`
}

// Provider is the object-store contract. Implementations must be safe
// for concurrent use.
type Provider interface {
	// Type identifies the provider, e.g. "rustfs".
	Type() string
	// Verify checks the credentials without changing anything.
	Verify(ctx context.Context) error
	// Info describes the store. Fields it can't answer stay zero.
	Info(ctx context.Context) (*Info, error)
	Buckets(ctx context.Context) ([]Bucket, error)
	CreateBucket(ctx context.Context, name string) error
	// DeleteBucket removes an EMPTY bucket. Emptying it first is the
	// caller's decision to make twice, not a side effect of this.
	DeleteBucket(ctx context.Context, name string) error
	// Objects lists one page. prefix and delimiter are the S3 pair that
	// makes a flat keyspace browsable as folders; token continues a
	// previous page.
	Objects(ctx context.Context, bucket, prefix, delimiter, token string, limit int) (*ObjectPage, error)
	// PutObject stores an object. size must be exact — S3 signing needs
	// a length up front, so a stream of unknown length can't be signed.
	PutObject(ctx context.Context, bucket, key string, size int64, body io.Reader) error
	// GetObject opens an object for reading; the caller closes it.
	GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, int64, error)
	DeleteObject(ctx context.Context, bucket, key string) error
}

// QuotaProvider is an optional capability for stores that cap a bucket's
// size. Checked with a type assertion, like hypervisor.BackupDriver — a
// store without quotas stays simple, and the UI hides the field rather
// than offering one that does nothing.
type QuotaProvider interface {
	SetBucketQuota(ctx context.Context, bucket string, bytes int64) error
}

// User is a credential the STORE holds, not an account in this console:
// an access key, its secret, and the policy that says what it may
// reach. It's what a backup script or a container registry signs its
// requests with, and it lives in the store's own IAM — this console
// creates and revokes them, it does not keep a copy.
//
// The secret is deliberately absent from this struct in both
// directions. It is set once, by whoever creates the key, and no store
// worth using will read it back.
type User struct {
	// ProviderID is filled in by the API layer, not the provider.
	ProviderID string `json:"providerId"`
	AccessKey  string `json:"accessKey"`
	Enabled    bool   `json:"enabled"`
	// Policy is the name of the policy bound to this key, empty for
	// none — which is a key that can sign requests and do nothing.
	Policy string `json:"policy"`
	// UpdatedAt is unix seconds; 0 when the store doesn't report it.
	UpdatedAt int64 `json:"updatedAt"`
}

// Policy is a NAMED permission document the store already holds.
//
// This is the one place the three-level model used for database
// permissions would be wrong. There, two engines spelled the same three
// intentions differently and the console had to pick words; here the
// store publishes its own named list, including ones that don't map onto
// read/write/full at all (diagnostics, consoleAdmin). Inventing a
// mapping would hide those and lie about the rest, so the names travel
// as they are.
type Policy struct {
	// ProviderID is filled in by the API layer.
	ProviderID string `json:"providerId"`
	Name       string `json:"name"`
	// Actions is every action the document allows, flattened and
	// deduplicated. It's here so the UI can say what a policy does
	// without rendering IAM JSON at somebody — and specifically so it
	// can warn about the ones that grant reads but not listing, which
	// is what the stock "readonly" does.
	Actions []string `json:"actions"`
}

// How short a credential may be. These are the LOOSEST limits any of
// these stores accepts, so the API layer can refuse an impossible key
// before the round trip without encoding one implementation's rule: a
// shorter secret comes back from RustFS as a 500 saying "invalid secret
// key length", which is a poor way to learn a form's requirements. A
// store that wants more is free to refuse what passes here — its error
// is then about that store rather than about the shape of the request.
//
// The numbers deliberately do NOT follow AWS, which mints 20-character
// access keys and 40-character secrets. Those are what AWS generates,
// not what an S3 API requires, and a lab key called "backups" is a
// reasonable thing to want.
const (
	MinAccessKeyLen = 3
	MinSecretKeyLen = 8
)

// UserProvider is the optional capability for stores with their own IAM.
// Same type-assertion rule as QuotaProvider: a store without users
// contributes none, and the section's pages answer 409 rather than
// pretending.
type UserProvider interface {
	Users(ctx context.Context) ([]User, error)
	// CreateUser refuses an access key that already exists. The
	// underlying call is usually an upsert, and a "create" that quietly
	// replaces a working credential's secret is the worst kind of
	// success.
	CreateUser(ctx context.Context, accessKey, secretKey string) error
	// SetUserSecret replaces the secret and MUST leave the key's status
	// alone — reissuing a credential is not a decision to re-enable one
	// that was switched off.
	SetUserSecret(ctx context.Context, accessKey, secretKey string) error
	SetUserStatus(ctx context.Context, accessKey string, enabled bool) error
	// SetUserPolicy binds one policy, replacing whatever was there.
	// Empty unbinds, leaving the key with no permissions at all.
	SetUserPolicy(ctx context.Context, accessKey, policy string) error
	DeleteUser(ctx context.Context, accessKey string) error
	// Policies lists what SetUserPolicy will accept.
	Policies(ctx context.Context) ([]Policy, error)
}

// Registry holds one live Provider per configured instance, keyed by its
// record ID, and is updated as instances are added or edited.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
}

func NewRegistry() *Registry {
	return &Registry{providers: map[string]Provider{}}
}

func (r *Registry) Get(id string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

func (r *Registry) Set(id string, p Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[id] = p
}

func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.providers, id)
}
