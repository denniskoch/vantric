package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/store"
)

// Shortcuts: tiles pointing at the systems this console doesn't reach.
//
// EVERY OTHER SECTION IS A VIEW ONTO A TOOL'S API. This one is a view
// onto the gaps between them — a NAS's own UI, a SaaS account with no
// integration here yet, the vendor portal you need twice a year. The
// single pane of glass is not finished and won't be; pretending
// otherwise just means those links live in somebody's bookmarks bar
// where the console can't help.
//
// PERSONAL, and self-service for that reason. These are somebody's own
// arrangement of their own working day, so a viewer arranges theirs as
// freely as an owner does — the RBAC middleware exempts the whole
// subtree, and every store call is scoped by the caller's account.
//
// THE ICON IS A FILE, beside the database like the installers, named
// after the shortcut's own id so there is no second registry to drift:
// the row says which extension, the directory holds the bytes, and
// deleting the row deletes the file.

const (
	shortcutIconDir = "shortcut-icons"
	// An icon is a favicon, not an asset. Anything larger is a mistake
	// worth refusing rather than storing.
	maxShortcutIconBytes = 1 << 20
	// A grid is a thing you can see at once. Past this it's a list, and
	// a list wants search rather than tiles.
	maxShortcuts = 200
)

// shortcutIconTypes maps the extensions worth accepting to what they
// are served as. Serving a stored Content-Type would mean trusting the
// uploader's word about bytes we hand back to a browser.
var shortcutIconTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
}

// shortcutSchemes are the schemes a tile may point at.
//
// AN ALLOWLIST, because the value ends up in an href: `javascript:`
// and `data:` are both links as far as the browser is concerned, and a
// blocklist is one spelling away from missing one. http and https are
// what a console or a SaaS page is; the rest are the desktop handlers
// this app already emits elsewhere.
var shortcutSchemes = []string{"http", "https", "rdp", "vnc", "ssh", "sftp", "smb"}

type shortcutInput struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

func (s *Server) shortcutRoutes(r chi.Router) {
	r.Get("/shortcuts", s.listShortcuts)
	r.Post("/shortcuts", s.createShortcut)
	// Static before wildcard, so this is not read as an id.
	r.Put("/shortcuts/order", s.reorderShortcuts)
	r.Put("/shortcuts/{id}", s.updateShortcut)
	r.Delete("/shortcuts/{id}", s.deleteShortcut)
	r.Get("/shortcuts/{id}/icon", s.shortcutIcon)
	r.Post("/shortcuts/{id}/icon", s.uploadShortcutIcon)
	r.Delete("/shortcuts/{id}/icon", s.deleteShortcutIcon)
}

func (s *Server) shortcutIconPath(icon string) string {
	return filepath.Join(s.dataDir, shortcutIconDir, icon)
}

// validShortcut checks what a form can get wrong, and normalises the
// URL so a tile typed as "nas.lan" still opens.
func validShortcut(in *shortcutInput) (string, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	raw := strings.TrimSpace(in.URL)
	if in.Name == "" {
		return "", errors.New("a shortcut needs a name")
	}
	if raw == "" {
		return "", errors.New("a shortcut needs a link")
	}
	// A bare host is what people type. Assume https rather than
	// refusing, and leave anything with a scheme alone.
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return "", errors.New("that doesn't look like a link")
	}
	scheme := strings.ToLower(parsed.Scheme)
	for _, ok := range shortcutSchemes {
		if scheme == ok {
			return raw, nil
		}
	}
	return "", errors.New("links can be " + strings.Join(shortcutSchemes, ", "))
}

func (s *Server) listShortcuts(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	items, err := s.store.Shortcuts(r.Context(), me.ID)
	if err != nil {
		s.fail(w, err, "your shortcuts")
		return
	}
	s.json(w, http.StatusOK, items)
}

func (s *Server) createShortcut(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	var in shortcutInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a shortcut")
		return
	}
	link, err := validShortcut(&in)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	existing, err := s.store.Shortcuts(r.Context(), me.ID)
	if err != nil {
		s.fail(w, err, "your shortcuts")
		return
	}
	if len(existing) >= maxShortcuts {
		s.err(w, http.StatusBadRequest, "that's as many shortcuts as one grid holds")
		return
	}
	item := &store.Shortcut{
		ID: uuid.NewString(), Name: in.Name, URL: link, Description: in.Description,
	}
	if err := s.store.CreateShortcut(r.Context(), me.ID, item); err != nil {
		s.fail(w, err, "saving the shortcut")
		return
	}
	s.json(w, http.StatusCreated, item)
}

func (s *Server) updateShortcut(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	var in shortcutInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a shortcut")
		return
	}
	link, err := validShortcut(&in)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	item := &store.Shortcut{
		ID: chi.URLParam(r, "id"), Name: in.Name, URL: link, Description: in.Description,
	}
	if err := s.store.UpdateShortcut(r.Context(), me.ID, item); err != nil {
		s.fail(w, err, "saving the shortcut")
		return
	}
	updated, err := s.store.Shortcut(r.Context(), me.ID, item.ID)
	if err != nil {
		s.fail(w, err, "the shortcut")
		return
	}
	s.json(w, http.StatusOK, updated)
}

func (s *Server) deleteShortcut(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	id := chi.URLParam(r, "id")
	// Read first, so the icon can go with it. A file left behind would
	// be the one thing on disk with nothing pointing at it.
	item, err := s.store.Shortcut(r.Context(), me.ID, id)
	if err != nil {
		s.fail(w, err, "the shortcut")
		return
	}
	if err := s.store.DeleteShortcut(r.Context(), me.ID, id); err != nil {
		s.fail(w, err, "removing the shortcut")
		return
	}
	if item.Icon != "" {
		if err := os.Remove(s.shortcutIconPath(item.Icon)); err != nil && !os.IsNotExist(err) {
			// The row is gone, which is what was asked for. A stranded
			// file is worth a line in the log and nothing more.
			s.log.Warn("shortcut icon left behind", "icon", item.Icon, "err", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reorderShortcuts(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	var ids []string
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		s.err(w, http.StatusBadRequest, "expected a JSON array of shortcut ids")
		return
	}
	if len(ids) > maxShortcuts {
		s.err(w, http.StatusBadRequest, "that's more shortcuts than one grid holds")
		return
	}
	if err := s.store.SetShortcutOrder(r.Context(), me.ID, ids); err != nil {
		s.fail(w, err, "saving the order")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) shortcutIcon(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	item, err := s.store.Shortcut(r.Context(), me.ID, chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "the shortcut")
		return
	}
	if item.Icon == "" {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(s.shortcutIconPath(item.Icon))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", shortcutIconTypes[strings.ToLower(filepath.Ext(item.Icon))])
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// AN SVG IS A DOCUMENT, and one served from this origin could carry
	// script. It never runs inside the <img> the tile uses, but the URL
	// is also just a URL somebody can open — so the response says it may
	// load nothing and run nothing, whatever it turns out to contain.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	// The name never changes while the bytes do, so this must not be
	// cached: replacing an icon has to show up on the next paint.
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, item.Icon, item.UpdatedAt, file)
}

func (s *Server) uploadShortcutIcon(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	id := chi.URLParam(r, "id")
	item, err := s.store.Shortcut(r.Context(), me.ID, id)
	if err != nil {
		s.fail(w, err, "the shortcut")
		return
	}
	ext := strings.ToLower(filepath.Ext(r.URL.Query().Get("filename")))
	if _, ok := shortcutIconTypes[ext]; !ok {
		s.err(w, http.StatusBadRequest, "an icon can be a PNG, JPEG, GIF, WebP, SVG or ICO")
		return
	}
	if r.ContentLength > maxShortcutIconBytes {
		s.err(w, http.StatusRequestEntityTooLarge, "icons are limited to 1 MB")
		return
	}
	dir := filepath.Join(s.dataDir, shortcutIconDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.fail(w, err, "storing the icon")
		return
	}
	// THE NAME IS THE SHORTCUT'S ID, never the uploader's filename —
	// which means nothing traversable reaches the path, and a second
	// upload replaces the first instead of accumulating.
	name := id + ext
	temp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		s.fail(w, err, "storing the icon")
		return
	}
	defer os.Remove(temp.Name())

	_, err = io.Copy(temp, io.LimitReader(r.Body, maxShortcutIconBytes))
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		s.fail(w, err, "storing the icon")
		return
	}
	if err := os.Rename(temp.Name(), s.shortcutIconPath(name)); err != nil {
		s.fail(w, err, "storing the icon")
		return
	}
	// An icon uploaded in a different format leaves the old file behind,
	// since only one name can be recorded.
	if item.Icon != "" && item.Icon != name {
		_ = os.Remove(s.shortcutIconPath(item.Icon))
	}
	if err := s.store.SetShortcutIcon(r.Context(), me.ID, id, name); err != nil {
		s.fail(w, err, "saving the icon")
		return
	}
	updated, err := s.store.Shortcut(r.Context(), me.ID, id)
	if err != nil {
		s.fail(w, err, "the shortcut")
		return
	}
	s.json(w, http.StatusOK, updated)
}

func (s *Server) deleteShortcutIcon(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	id := chi.URLParam(r, "id")
	item, err := s.store.Shortcut(r.Context(), me.ID, id)
	if err != nil {
		s.fail(w, err, "the shortcut")
		return
	}
	if err := s.store.SetShortcutIcon(r.Context(), me.ID, id, ""); err != nil {
		s.fail(w, err, "removing the icon")
		return
	}
	if item.Icon != "" {
		_ = os.Remove(s.shortcutIconPath(item.Icon))
	}
	w.WriteHeader(http.StatusNoContent)
}
