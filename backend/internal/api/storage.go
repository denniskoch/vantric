package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/storage"
	storagefactory "vantric/internal/storage/factory"
	"vantric/internal/store"
)

// Object storage. Instances are credentials for an S3-compatible store;
// buckets are the resources they contain. Same shape as DNS providers
// and zones — bucket listings span every instance and stamp each bucket
// with the instance it came from.

// bucketNameRe is S3's own rule, which is stricter than a resource name
// here: a bucket name reaches DNS (virtual-host addressing), so no
// uppercase, no underscores, and it can't look like an IP address.
var bucketNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

func bucketNameError(name string) string {
	switch {
	case !bucketNameRe.MatchString(name):
		return "name must be 3–63 characters of lowercase letters, digits, dots and hyphens, starting and ending with one"
	case strings.Contains(name, ".."):
		return "name can't contain two dots in a row"
	case regexp.MustCompile(`^\d+\.\d+\.\d+\.\d+$`).MatchString(name):
		return "name can't look like an IP address"
	}
	return ""
}

func (s *Server) storageRoutes(r chi.Router) {
	r.Get("/storage/provider-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, storagefactory.Types)
	})
	r.Get("/storage/providers", s.listStorageProviders)
	r.Post("/storage/providers", s.createStorageProvider)
	r.Put("/storage/providers/{id}", s.updateStorageProvider)
	r.Delete("/storage/providers/{id}", s.deleteStorageProvider)

	r.Get("/storage/buckets", s.listBuckets)
	r.Post("/storage/buckets", s.createBucket)
	r.Delete("/storage/buckets/{bucket}", s.deleteBucket)
	r.Put("/storage/buckets/{bucket}/quota", s.setBucketQuota)
	r.Get("/storage/buckets/{bucket}/objects", s.listObjects)
	r.Post("/storage/buckets/{bucket}/objects", s.uploadObject)
	r.Get("/storage/buckets/{bucket}/object", s.downloadObject)
	r.Delete("/storage/buckets/{bucket}/object", s.deleteObject)

	r.Get("/storage/buckets/{bucket}/permissions", s.bucketPermissions)
	r.Put("/storage/buckets/{bucket}/public", s.grantBucketPublic)
	r.Delete("/storage/buckets/{bucket}/public", s.revokeBucketPublic)

	r.Get("/storage/users", s.listStorageUsers)
	r.Post("/storage/users", s.createStorageUser)
	r.Put("/storage/users/{key}/secret", s.setStorageUserSecret)
	r.Put("/storage/users/{key}/status", s.setStorageUserStatus)
	r.Put("/storage/users/{key}/policy", s.setStorageUserPolicy)
	r.Delete("/storage/users/{key}", s.deleteStorageUser)
	r.Get("/storage/policies", s.listStoragePolicies)
}

// storageProviderView is the API shape: everything but the secret key,
// plus what the store says about itself from a live read.
type storageProviderView struct {
	store.StorageProvider
	HasSecret bool          `json:"hasSecret"`
	Status    string        `json:"status"` // connected | unreachable | unknown
	Error     string        `json:"error,omitempty"`
	Info      *storage.Info `json:"info,omitempty"`
}

func (s *Server) probeStorageProvider(ctx context.Context, p store.StorageProvider) storageProviderView {
	view := storageProviderView{
		StorageProvider: p,
		HasSecret:       p.SecretKey != "",
		Status:          "unknown",
	}
	provider, ok := s.storageRegistry.Get(p.ID)
	if !ok {
		view.Error = "no provider loaded"
		return view
	}
	info, err := provider.Info(ctx)
	if err != nil {
		// Info needs the admin API; a store that only speaks S3 would
		// fail here while being perfectly usable, so reachability falls
		// back to the one call every S3 store answers.
		if verr := provider.Verify(ctx); verr != nil {
			view.Status = "unreachable"
			view.Error = verr.Error()
			return view
		}
		view.Status = "connected"
		view.Error = "reachable, but this store reports no admin info: " + err.Error()
		return view
	}
	view.Status = "connected"
	view.Info = info
	return view
}

func (s *Server) listStorageProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListStorageProviders(r.Context())
	if err != nil {
		s.fail(w, err, "storage providers")
		return
	}
	views := make([]storageProviderView, len(providers))
	var wg sync.WaitGroup
	for i := range providers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeStorageProvider(r.Context(), providers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type storageProviderRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BaseURL     string `json:"baseUrl"`
	AccessKey   string `json:"accessKey"`
	SecretKey   string `json:"secretKey"`
	Region      string `json:"region"`
	InsecureTLS bool   `json:"insecureTls"`
}

func (s *Server) validateStorageProvider(w http.ResponseWriter, req *storageProviderRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest,
			"name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(storagefactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported storage provider type")
		return false
	}
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	u, err := url.Parse(req.BaseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		s.err(w, http.StatusBadRequest, "the endpoint must be a full http:// or https:// address")
		return false
	}
	if strings.TrimSpace(req.AccessKey) == "" {
		s.err(w, http.StatusBadRequest, "an access key is required")
		return false
	}
	return true
}

func (s *Server) createStorageProvider(w http.ResponseWriter, r *http.Request) {
	var req storageProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateStorageProvider(w, &req) {
		return
	}
	if strings.TrimSpace(req.SecretKey) == "" {
		s.err(w, http.StatusBadRequest, "a secret key is required")
		return
	}
	if existing, err := s.store.GetStorageProviderByName(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a storage instance with this name already exists")
		return
	}
	p := &store.StorageProvider{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Type:        req.Type,
		BaseURL:     req.BaseURL,
		AccessKey:   strings.TrimSpace(req.AccessKey),
		SecretKey:   strings.TrimSpace(req.SecretKey),
		Region:      strings.TrimSpace(req.Region),
		InsecureTLS: req.InsecureTLS,
	}
	provider, err := storagefactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// Credentials are checked before being stored, so a saved instance
	// is a working one — the same rule as every other backend here.
	if err := provider.Verify(r.Context()); err != nil {
		s.log.Warn("storage provider rejected", "name", p.Name, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateStorageProvider(r.Context(), p); err != nil {
		s.fail(w, err, "creating the storage instance")
		return
	}
	s.storageRegistry.Set(p.ID, provider)
	s.json(w, http.StatusCreated, s.probeStorageProvider(r.Context(), *p))
}

func (s *Server) updateStorageProvider(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetStorageProvider(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "storage instance")
		return
	}
	var req storageProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateStorageProvider(w, &req) {
		return
	}
	if req.Name != p.Name {
		if existing, err := s.store.GetStorageProviderByName(r.Context(), req.Name); err == nil && existing != nil {
			s.err(w, http.StatusConflict, "a storage instance with this name already exists")
			return
		}
	}
	p.Name = req.Name
	p.Type = req.Type
	p.BaseURL = req.BaseURL
	p.AccessKey = strings.TrimSpace(req.AccessKey)
	p.Region = strings.TrimSpace(req.Region)
	p.InsecureTLS = req.InsecureTLS
	// Blank KEEPS the stored key — the field is write-only, so it is
	// always empty when the form loads, and treating that as "delete it"
	// would make Save on an untouched form break a working instance.
	if strings.TrimSpace(req.SecretKey) != "" {
		p.SecretKey = strings.TrimSpace(req.SecretKey)
	}
	provider, err := storagefactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := provider.Verify(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateStorageProvider(r.Context(), p); err != nil {
		s.fail(w, err, "updating the storage instance")
		return
	}
	s.storageRegistry.Set(p.ID, provider)
	s.json(w, http.StatusOK, s.probeStorageProvider(r.Context(), *p))
}

func (s *Server) deleteStorageProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteStorageProvider(r.Context(), id); err != nil {
		s.fail(w, err, "removing the storage instance")
		return
	}
	s.storageRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// storageProvider resolves ?provider= to a live provider.
func (s *Server) storageProvider(w http.ResponseWriter, r *http.Request) storage.Provider {
	id := r.URL.Query().Get("provider")
	if id == "" {
		s.err(w, http.StatusBadRequest, "provider query parameter is required")
		return nil
	}
	provider, ok := s.storageRegistry.Get(id)
	if !ok {
		s.err(w, http.StatusNotFound, "storage instance: not found")
		return nil
	}
	return provider
}

// listBuckets spans every configured instance. One that fails is logged
// and skipped rather than blanking the page — the same rule catalog
// listings follow.
func (s *Server) listBuckets(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListStorageProviders(r.Context())
	if err != nil {
		s.fail(w, err, "storage providers")
		return
	}
	if only := r.URL.Query().Get("provider"); only != "" {
		providers = slices.DeleteFunc(providers, func(p store.StorageProvider) bool {
			return p.ID != only
		})
	}
	buckets := []storage.Bucket{}
	for _, p := range providers {
		provider, ok := s.storageRegistry.Get(p.ID)
		if !ok {
			continue
		}
		found, err := provider.Buckets(r.Context())
		if err != nil {
			s.log.Warn("listing buckets failed", "instance", p.Name, "error", err)
			continue
		}
		for i := range found {
			found[i].ProviderID = p.ID
		}
		buckets = append(buckets, found...)
	}
	slices.SortFunc(buckets, func(a, b storage.Bucket) int {
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, buckets)
}

func (s *Server) createBucket(w http.ResponseWriter, r *http.Request) {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	req.Name = strings.TrimSpace(strings.ToLower(req.Name))
	if msg := bucketNameError(req.Name); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	if err := provider.CreateBucket(r.Context(), req.Name); err != nil {
		s.fail(w, err, "creating the bucket")
		return
	}
	// NO QUOTA AT BIRTH. RustFS enforces a quota by consulting its usage
	// scanner, and until that has run on a new bucket every write is
	// refused with "Bucket quota check temporarily unavailable" — so a
	// quota applied at creation hands back a bucket nothing can be
	// written to for as long as the scan takes. Setting one is a separate
	// action on a bucket that already exists.
	s.json(w, http.StatusCreated, map[string]string{"name": req.Name})
}

func (s *Server) deleteBucket(w http.ResponseWriter, r *http.Request) {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return
	}
	if err := provider.DeleteBucket(r.Context(), chi.URLParam(r, "bucket")); err != nil {
		s.fail(w, err, "deleting the bucket")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// setBucketQuota is the separate action the create flow deliberately
// isn't: a quota on a bucket that already has a usage figure takes effect
// immediately, where one applied at birth blocks every write until the
// store's scanner has run.
func (s *Server) setBucketQuota(w http.ResponseWriter, r *http.Request) {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return
	}
	quota, ok := provider.(storage.QuotaProvider)
	if !ok {
		// A capability the store hasn't got is a 409, not a 500: the
		// request was fine, this store just has no quotas.
		s.err(w, http.StatusConflict, "this store doesn't support bucket quotas")
		return
	}
	var req struct {
		// Bytes of 0 removes the quota.
		Bytes int64 `json:"bytes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Bytes < 0 {
		s.err(w, http.StatusBadRequest, "a quota can't be negative; use 0 to remove it")
		return
	}
	if err := quota.SetBucketQuota(r.Context(), chi.URLParam(r, "bucket"), req.Bytes); err != nil {
		s.fail(w, err, "setting the quota")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listObjects(w http.ResponseWriter, r *http.Request) {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	// The delimiter is what makes a flat keyspace browsable. Default to
	// "/" so the page opens as folders; pass an empty one to see every
	// key at once.
	delimiter := "/"
	if d, ok := r.URL.Query()["delimiter"]; ok {
		delimiter = d[0]
	}
	page, err := provider.Objects(r.Context(), chi.URLParam(r, "bucket"),
		r.URL.Query().Get("prefix"), delimiter, r.URL.Query().Get("token"), limit)
	if err != nil {
		s.fail(w, err, "listing objects")
		return
	}
	s.json(w, http.StatusOK, page)
}

// uploadObject streams a browser upload straight through to the store.
// The bytes are leaving the operator's machine, so this one is
// synchronous and the page keeps its progress bar — the rule the ISO
// upload already follows.
func (s *Server) uploadObject(w http.ResponseWriter, r *http.Request) {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return
	}
	bucket := chi.URLParam(r, "bucket")
	key := strings.TrimPrefix(r.URL.Query().Get("key"), "/")
	if key == "" {
		s.err(w, http.StatusBadRequest, "a key is required")
		return
	}
	if r.ContentLength <= 0 {
		// S3 signs a length up front, so a chunked upload of unknown
		// size can't be forwarded — say so rather than failing deep in
		// the driver.
		s.err(w, http.StatusBadRequest, "the upload needs a Content-Length")
		return
	}
	if err := provider.PutObject(r.Context(), bucket, key, r.ContentLength, r.Body); err != nil {
		s.fail(w, err, "uploading the object")
		return
	}
	s.json(w, http.StatusCreated, map[string]any{"key": key, "sizeBytes": r.ContentLength})
}

func (s *Server) downloadObject(w http.ResponseWriter, r *http.Request) {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		s.err(w, http.StatusBadRequest, "a key is required")
		return
	}
	body, size, err := provider.GetObject(r.Context(), chi.URLParam(r, "bucket"), key)
	if err != nil {
		s.fail(w, err, "reading the object")
		return
	}
	defer body.Close()
	name := key
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	_, _ = io.Copy(w, body)
}

func (s *Server) deleteObject(w http.ResponseWriter, r *http.Request) {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		s.err(w, http.StatusBadRequest, "a key is required")
		return
	}
	if err := provider.DeleteObject(r.Context(), chi.URLParam(r, "bucket"), key); err != nil {
		s.fail(w, err, "deleting the object")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- access keys (the store's own IAM) ---
//
// These are credentials on the STORE, not accounts in this console: a
// key a backup script signs with, and the policy that says what it may
// reach. The section owns them for the same reason it owns buckets —
// the store is the source of truth and this reads and writes it.
//
// The secret is write-only in every direction, like every other
// credential here. It is set once by whoever creates the key and the
// store won't give it back, so the console doesn't pretend it can.

// accessKeyError applies the store's own limits, plus one of ours: a key
// with a slash or a space in it could be created and then never
// addressed, since these routes carry it in the path.
func accessKeyError(key string) string {
	switch {
	case len(key) < storage.MinAccessKeyLen:
		return fmt.Sprintf("an access key must be at least %d characters", storage.MinAccessKeyLen)
	case strings.ContainsAny(key, " \t/\\?#%"):
		return "an access key can't contain spaces, slashes or URL punctuation"
	}
	return ""
}

func secretKeyError(secret string) string {
	if len(secret) < storage.MinSecretKeyLen {
		return fmt.Sprintf("a secret key must be at least %d characters", storage.MinSecretKeyLen)
	}
	return ""
}

// storageUsers resolves the instance and asserts the IAM capability,
// answering 409 when the store hasn't got one — the same rule quotas
// follow. The request was fine; this store just has no users.
func (s *Server) storageUsers(w http.ResponseWriter, r *http.Request) storage.UserProvider {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return nil
	}
	users, ok := provider.(storage.UserProvider)
	if !ok {
		s.err(w, http.StatusConflict, "this store doesn't manage its own access keys")
		return nil
	}
	return users
}

func (s *Server) listStorageUsers(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListStorageProviders(r.Context())
	if err != nil {
		s.fail(w, err, "storage providers")
		return
	}
	if only := r.URL.Query().Get("provider"); only != "" {
		providers = slices.DeleteFunc(providers, func(p store.StorageProvider) bool {
			return p.ID != only
		})
	}
	users := []storage.User{}
	for _, p := range providers {
		provider, ok := s.storageRegistry.Get(p.ID)
		if !ok {
			continue
		}
		iam, ok := provider.(storage.UserProvider)
		if !ok {
			continue
		}
		// One store that errors is skipped and logged, not fatal to the
		// page — the same rule catalog listings follow across hypervisors.
		found, err := iam.Users(r.Context())
		if err != nil {
			s.log.Warn("listing access keys failed", "instance", p.Name, "error", err)
			continue
		}
		for i := range found {
			found[i].ProviderID = p.ID
		}
		users = append(users, found...)
	}
	slices.SortFunc(users, func(a, b storage.User) int {
		return strings.Compare(a.AccessKey, b.AccessKey)
	})
	s.json(w, http.StatusOK, users)
}

func (s *Server) listStoragePolicies(w http.ResponseWriter, r *http.Request) {
	iam := s.storageUsers(w, r)
	if iam == nil {
		return
	}
	policies, err := iam.Policies(r.Context())
	if err != nil {
		s.fail(w, err, "listing policies")
		return
	}
	provider := r.URL.Query().Get("provider")
	for i := range policies {
		policies[i].ProviderID = provider
	}
	s.json(w, http.StatusOK, policies)
}

func (s *Server) createStorageUser(w http.ResponseWriter, r *http.Request) {
	iam := s.storageUsers(w, r)
	if iam == nil {
		return
	}
	var req struct {
		AccessKey string `json:"accessKey"`
		SecretKey string `json:"secretKey"`
		Policy    string `json:"policy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	req.AccessKey = strings.TrimSpace(req.AccessKey)
	if msg := accessKeyError(req.AccessKey); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	if msg := secretKeyError(req.SecretKey); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	if err := iam.CreateUser(r.Context(), req.AccessKey, req.SecretKey); err != nil {
		s.fail(w, err, "creating the access key")
		return
	}
	// THE POLICY IS A SECOND CALL, because the store ignores a policy
	// named in the create body — it accepts it, reports success, and
	// leaves the key bound to nothing. Same two-step as creating an
	// authentik account, and for the same reason: the first call makes
	// the thing, the second makes it usable.
	//
	// A failure here leaves a real key with no permissions rather than
	// no key at all, so it reports what happened instead of pretending
	// the whole thing failed — the key exists and the page will show it.
	if req.Policy != "" {
		if err := iam.SetUserPolicy(r.Context(), req.AccessKey, req.Policy); err != nil {
			s.err(w, http.StatusConflict, fmt.Sprintf(
				"the access key was created, but attaching the %q policy failed: %v", req.Policy, err))
			return
		}
	}
	s.json(w, http.StatusCreated, map[string]string{"accessKey": req.AccessKey})
}

func (s *Server) setStorageUserSecret(w http.ResponseWriter, r *http.Request) {
	iam := s.storageUsers(w, r)
	if iam == nil {
		return
	}
	var req struct {
		SecretKey string `json:"secretKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if msg := secretKeyError(req.SecretKey); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	if err := iam.SetUserSecret(r.Context(), chi.URLParam(r, "key"), req.SecretKey); err != nil {
		s.fail(w, err, "replacing the secret key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setStorageUserStatus(w http.ResponseWriter, r *http.Request) {
	iam := s.storageUsers(w, r)
	if iam == nil {
		return
	}
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := iam.SetUserStatus(r.Context(), chi.URLParam(r, "key"), req.Enabled); err != nil {
		s.fail(w, err, "changing the access key's status")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setStorageUserPolicy(w http.ResponseWriter, r *http.Request) {
	iam := s.storageUsers(w, r)
	if iam == nil {
		return
	}
	var req struct {
		// Policy is empty to unbind, which leaves a key that can sign
		// requests and reach nothing.
		Policy string `json:"policy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := iam.SetUserPolicy(r.Context(), chi.URLParam(r, "key"), strings.TrimSpace(req.Policy)); err != nil {
		s.fail(w, err, "attaching the policy")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteStorageUser(w http.ResponseWriter, r *http.Request) {
	iam := s.storageUsers(w, r)
	if iam == nil {
		return
	}
	if err := iam.DeleteUser(r.Context(), chi.URLParam(r, "key")); err != nil {
		s.fail(w, err, "deleting the access key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- bucket permissions ---
//
// Two questions, which S3 answers in two unrelated places. WHO CAN REACH
// THIS BUCKET comes from the policies attached to the store's access
// keys, and answering it means reading all of them and matching resource
// ARNs — there is no endpoint for it, which is why the console does it
// and the store's own UI doesn't. IS IT PUBLIC comes from the bucket
// policy, and is the one setting here that can expose data to the
// internet without anything else in this console noticing.

type bucketKeyAccess struct {
	AccessKey string `json:"accessKey"`
	Enabled   bool   `json:"enabled"`
	Policy    string `json:"policy"`
	// Actions are the ones that policy allows, so the row can say what
	// this key may do rather than only that it's on the list.
	Actions []string `json:"actions"`
}

type bucketPermissionsView struct {
	// Policy is nil when the bucket has none, which is the ordinary state.
	Policy *storage.BucketPolicy `json:"policy"`
	// PolicySupported is false for a store with no bucket policies at
	// all — a different thing from a bucket that hasn't got one, and the
	// UI says so rather than showing a reassuring "Not public".
	PolicySupported bool              `json:"policySupported"`
	Keys            []bucketKeyAccess `json:"keys"`
	// KeysKnown is false where the store has no IAM to ask, so an empty
	// list doesn't read as "nothing can reach this".
	KeysKnown bool `json:"keysKnown"`
}

func (s *Server) bucketPermissions(w http.ResponseWriter, r *http.Request) {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return
	}
	bucket := chi.URLParam(r, "bucket")
	view := bucketPermissionsView{Keys: []bucketKeyAccess{}}

	if policies, ok := provider.(storage.PolicyProvider); ok {
		view.PolicySupported = true
		policy, err := policies.BucketPolicy(r.Context(), bucket)
		if err != nil {
			s.fail(w, err, "reading the bucket policy")
			return
		}
		view.Policy = policy
	}

	if iam, ok := provider.(storage.UserProvider); ok {
		users, err := iam.Users(r.Context())
		if err != nil {
			s.fail(w, err, "listing access keys")
			return
		}
		named, err := iam.Policies(r.Context())
		if err != nil {
			s.fail(w, err, "listing policies")
			return
		}
		view.KeysKnown = true
		byName := make(map[string]storage.Policy, len(named))
		for _, p := range named {
			byName[p.Name] = p
		}
		for _, u := range users {
			// A key with no policy reaches nothing, so it isn't listed
			// here — it appears on the Access keys page as "No access",
			// which is where that fact belongs.
			p, ok := byName[u.Policy]
			if !ok {
				continue
			}
			if !slices.ContainsFunc(p.Resources, func(arn string) bool {
				return storage.MatchesBucket(arn, bucket)
			}) {
				continue
			}
			view.Keys = append(view.Keys, bucketKeyAccess{
				AccessKey: u.AccessKey,
				Enabled:   u.Enabled,
				Policy:    u.Policy,
				Actions:   p.Actions,
			})
		}
	}
	s.json(w, http.StatusOK, view)
}

// storagePolicies resolves the instance and asserts bucket-policy
// support, 409 where the store hasn't got it — the same rule as quotas.
func (s *Server) storagePolicies(w http.ResponseWriter, r *http.Request) storage.PolicyProvider {
	provider := s.storageProvider(w, r)
	if provider == nil {
		return nil
	}
	policies, ok := provider.(storage.PolicyProvider)
	if !ok {
		s.err(w, http.StatusConflict, "this store doesn't support bucket policies")
		return nil
	}
	return policies
}

func (s *Server) grantBucketPublic(w http.ResponseWriter, r *http.Request) {
	policies := s.storagePolicies(w, r)
	if policies == nil {
		return
	}
	var req struct {
		// Prefix confines the grant to one folder; empty opens the whole
		// bucket.
		Prefix string `json:"prefix"`
		// AllowList additionally lets anyone enumerate what's there.
		AllowList bool `json:"allowList"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if strings.Contains(req.Prefix, "*") {
		// The prefix becomes an ARN, where a stray "*" would widen the
		// grant rather than fail — the one typo here that silently opens
		// more than was asked for.
		s.err(w, http.StatusBadRequest, "a prefix is a folder path, not a pattern — leave out the *")
		return
	}
	bucket := chi.URLParam(r, "bucket")
	current, err := policies.BucketPolicy(r.Context(), bucket)
	if err != nil {
		s.fail(w, err, "reading the bucket policy")
		return
	}
	var document json.RawMessage
	if current != nil {
		document = current.Document
	}
	next, err := storage.WithPublicRead(document, bucket, req.Prefix, req.AllowList)
	if err != nil {
		s.err(w, http.StatusConflict,
			"this bucket's existing policy couldn't be read, so it won't be rewritten: "+err.Error())
		return
	}
	if err := policies.SetBucketPolicy(r.Context(), bucket, next); err != nil {
		s.fail(w, err, "opening the bucket to anonymous reads")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) revokeBucketPublic(w http.ResponseWriter, r *http.Request) {
	policies := s.storagePolicies(w, r)
	if policies == nil {
		return
	}
	bucket := chi.URLParam(r, "bucket")
	current, err := policies.BucketPolicy(r.Context(), bucket)
	if err != nil {
		s.fail(w, err, "reading the bucket policy")
		return
	}
	if current == nil {
		// Nothing to close. Not an error — the caller asked for a bucket
		// that isn't public and that's what they have.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	next, err := storage.WithoutPublic(current.Document)
	if err != nil {
		s.err(w, http.StatusConflict,
			"this bucket's policy couldn't be read, so it won't be rewritten: "+err.Error())
		return
	}
	// Nothing left to keep means removing the document rather than
	// storing an empty one.
	if len(next) == 0 {
		if err := policies.DeleteBucketPolicy(r.Context(), bucket); err != nil {
			s.fail(w, err, "removing the bucket policy")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := policies.SetBucketPolicy(r.Context(), bucket, next); err != nil {
		s.fail(w, err, "closing anonymous access")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
