package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Whose console this says it is.
//
// A STORED SETTING, NOT A BUILD ARGUMENT. It was three Vite variables
// baked into the bundle, on the reasoning that a logo is an asset the
// bundler has to see and whoever builds the image is whoever sets the
// name. That stopped being true the moment there was a published image:
// pulling `ghcr.io/…/vantric:edge` and rebranding it meant building your
// own copy, which is the opposite of what publishing one is for.
//
// READABLE BEFORE SIGN-IN, deliberately, because the sign-in page wears
// it — a console that showed its owner's name only after you were
// already inside would be branding the wrong half. What that leaks is a
// name, to somebody who has already reached the page, and the browser
// tab said it anyway.
//
// THE LOGO IS A FILE beside the database, like the installers and the
// shortcut icons, for the same reasons: backup is `cp`, and there is no
// blob column to export anything from.

const (
	brandNameKey   = "brand.name"
	brandSuffixKey = "brand.suffix"
	brandLogoKey   = "brand.logo"

	brandDir = "brand"
	// A wordmark, not a hero image.
	maxBrandLogoBytes = 1 << 20
)

// brandLogoTypes are the formats worth accepting, and what they are
// served as — never the uploader's word about bytes handed to a
// browser.
var brandLogoTypes = map[string]string{
	".svg":  "image/svg+xml",
	".png":  "image/png",
	".webp": "image/webp",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
}

type branding struct {
	// Name is the word before the section name. Empty means Vantric,
	// resolved here rather than in the browser so every surface agrees.
	Name string `json:"name"`
	// Suffix is the lighter word after it, GCP's "Google Cloud".
	Suffix string `json:"suffix"`
	// HasLogo says whether to draw the wordmark instead of the name.
	// The bytes come from a separate endpoint an <img> can point at.
	HasLogo bool `json:"hasLogo"`
	// Version changes when the logo does, so a cached image is
	// replaced rather than kept — the URL is otherwise constant.
	Version string `json:"version"`
}

// defaultBrand is what a fork gets, and what this console is called
// when nobody has said otherwise.
const defaultBrandName = "Vantric"
const defaultBrandSuffix = "Cloud"

func (s *Server) brandingFor(r *http.Request) branding {
	ctx := r.Context()
	name, _ := s.store.GetSetting(ctx, brandNameKey)
	suffix, err := s.store.GetSetting(ctx, brandSuffixKey)
	logo, _ := s.store.GetSetting(ctx, brandLogoKey)
	out := branding{Name: name, Suffix: suffix, HasLogo: logo != ""}
	if out.Name == "" {
		out.Name = defaultBrandName
	}
	// An UNSET suffix is the default; an explicitly EMPTY one is a
	// choice — somebody who wants the name alone. GetSetting can tell
	// them apart and the zero value cannot.
	if err != nil {
		out.Suffix = defaultBrandSuffix
	}
	if logo != "" {
		if info, err := os.Stat(s.brandLogoPath(logo)); err == nil {
			out.Version = info.ModTime().UTC().Format("20060102150405")
		}
	}
	return out
}

func (s *Server) brandLogoPath(name string) string {
	return filepath.Join(s.dataDir, brandDir, name)
}

func (s *Server) getBranding(w http.ResponseWriter, r *http.Request) {
	s.json(w, http.StatusOK, s.brandingFor(r))
}

func (s *Server) setBranding(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name   string `json:"name"`
		Suffix string `json:"suffix"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a name and a suffix")
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = defaultBrandName
	}
	if err := s.store.SetSetting(r.Context(), brandNameKey, name); err != nil {
		s.fail(w, err, "saving the name")
		return
	}
	// Stored even when empty, because empty is an answer here.
	if err := s.store.SetSetting(r.Context(), brandSuffixKey, strings.TrimSpace(in.Suffix)); err != nil {
		s.fail(w, err, "saving the suffix")
		return
	}
	s.json(w, http.StatusOK, s.brandingFor(r))
}

func (s *Server) brandLogo(w http.ResponseWriter, r *http.Request) {
	name, err := s.store.GetSetting(r.Context(), brandLogoKey)
	if err != nil || name == "" {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(s.brandLogoPath(name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", brandLogoTypes[strings.ToLower(filepath.Ext(name))])
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// AN SVG IS A DOCUMENT that could carry script. It never runs inside
	// the <img> that draws it, but the URL is also a URL somebody can
	// open — so the response says it may load nothing and run nothing.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, name, info.ModTime(), file)
}

func (s *Server) uploadBrandLogo(w http.ResponseWriter, r *http.Request) {
	ext := strings.ToLower(filepath.Ext(r.URL.Query().Get("filename")))
	if _, ok := brandLogoTypes[ext]; !ok {
		s.err(w, http.StatusBadRequest, "a logo can be an SVG, PNG, WebP or JPEG")
		return
	}
	if r.ContentLength > maxBrandLogoBytes {
		s.err(w, http.StatusRequestEntityTooLarge, "logos are limited to 1 MB")
		return
	}
	dir := filepath.Join(s.dataDir, brandDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.fail(w, err, "storing the logo")
		return
	}
	// THE NAME IS OURS, never the uploader's — nothing traversable
	// reaches the path, and a second upload replaces the first.
	name := "logo" + ext
	temp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		s.fail(w, err, "storing the logo")
		return
	}
	defer os.Remove(temp.Name())

	_, err = io.Copy(temp, io.LimitReader(r.Body, maxBrandLogoBytes))
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		s.fail(w, err, "storing the logo")
		return
	}
	if err := os.Rename(temp.Name(), s.brandLogoPath(name)); err != nil {
		s.fail(w, err, "storing the logo")
		return
	}
	// A logo uploaded in a different format leaves the old file behind,
	// since only one name is recorded.
	if previous, _ := s.store.GetSetting(r.Context(), brandLogoKey); previous != "" && previous != name {
		_ = os.Remove(s.brandLogoPath(previous))
	}
	if err := s.store.SetSetting(r.Context(), brandLogoKey, name); err != nil {
		s.fail(w, err, "saving the logo")
		return
	}
	s.json(w, http.StatusOK, s.brandingFor(r))
}

func (s *Server) deleteBrandLogo(w http.ResponseWriter, r *http.Request) {
	name, _ := s.store.GetSetting(r.Context(), brandLogoKey)
	if err := s.store.SetSetting(r.Context(), brandLogoKey, ""); err != nil {
		s.fail(w, err, "removing the logo")
		return
	}
	if name != "" {
		_ = os.Remove(s.brandLogoPath(name))
	}
	s.json(w, http.StatusOK, s.brandingFor(r))
}
