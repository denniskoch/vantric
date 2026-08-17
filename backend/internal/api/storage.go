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
	r.Get("/storage/buckets/{bucket}/objects", s.listObjects)
	r.Post("/storage/buckets/{bucket}/objects", s.uploadObject)
	r.Get("/storage/buckets/{bucket}/object", s.downloadObject)
	r.Delete("/storage/buckets/{bucket}/object", s.deleteObject)
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
