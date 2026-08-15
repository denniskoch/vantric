package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"

	"lab-cloud-manager/internal/store"
)

// Agent installers: files this console holds so a machine being set up
// can fetch one with a single command.
//
// This is the one place the app is a source of truth rather than a view
// onto somebody else's, and it earns that by being the thing neither
// side offers: Fleet builds installers but won't host them for you, and
// a fresh VM has no session to authenticate a download with.
//
// THE FILES ARE FILES IN A DIRECTORY, beside the database, for the same
// reason the database is: backup is `cp`, inspection is `ls`, and
// nothing has to be exported from a blob column to be useful. The
// listing is a directory read, so there is no second registry to drift
// from what's on disk.
//
// THE DOWNLOAD IS TOKEN-GATED AND OUTSIDE THE SESSION. A fleetd package
// carries the enrollment secret, so leaving it world-readable would let
// anyone who can reach this console enrol a host. A token in the URL is
// what a one-line wget can carry, and it can be rotated here the moment
// it leaks.

const (
	installerDir = "installers"
	// Big enough for an .msi or a .pkg with a bundled osquery; small
	// enough that a mistyped upload can't fill the disk.
	maxInstallerBytes = 512 << 20
	// The key the download token is stored under.
	installerTokenKey = "installer.token"
)

// installerExtensions are the package formats an agent ships as.
var installerExtensions = []string{".deb", ".rpm", ".pkg", ".msi", ".exe", ".sh", ".ps1", ".tar.gz"}

type installer struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	// UploadedAt is unix seconds, from the file itself.
	UploadedAt int64 `json:"uploadedAt"`
	// Platform is what the extension implies, for grouping in the UI.
	Platform string `json:"platform"`
}

type installersResponse struct {
	Installers []installer `json:"installers"`
	// BaseURL is the origin a machine should fetch from — the server's
	// own idea of its public address, not the browser's, since behind a
	// tunnel those disagree and only the server's is reachable.
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token"`
}

func (s *Server) installerRoutes(r chi.Router) {
	r.Get("/installers", s.listInstallers)
	r.Post("/installers", s.uploadInstaller)
	r.Delete("/installers/{name}", s.deleteInstaller)
	r.Post("/installers/token/rotate", s.rotateInstallerToken)
	r.Get("/installers/{name}/checksum", s.installerChecksum)
}

func (s *Server) installerPath(name string) string {
	return filepath.Join(s.dataDir, installerDir, name)
}

// platformOf reads the package format for what it says about where the
// file is meant to run.
func platformOf(name string) string {
	switch {
	case strings.HasSuffix(name, ".deb"):
		return "Debian/Ubuntu"
	case strings.HasSuffix(name, ".rpm"):
		return "RHEL/Fedora"
	case strings.HasSuffix(name, ".pkg"):
		return "macOS"
	case strings.HasSuffix(name, ".msi"), strings.HasSuffix(name, ".exe"):
		return "Windows"
	case strings.HasSuffix(name, ".ps1"):
		return "Windows (script)"
	case strings.HasSuffix(name, ".sh"):
		return "Linux (script)"
	default:
		return "Archive"
	}
}

func (s *Server) listInstallers(w http.ResponseWriter, r *http.Request) {
	token, err := s.installerToken(r.Context())
	if err != nil {
		s.fail(w, err, "installer token")
		return
	}
	out := installersResponse{
		Installers: []installer{},
		BaseURL:    s.siteOrigin(r),
		Token:      token,
	}
	entries, err := os.ReadDir(filepath.Join(s.dataDir, installerDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		s.fail(w, err, "installers")
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out.Installers = append(out.Installers, installer{
			Name:       entry.Name(),
			Size:       info.Size(),
			UploadedAt: info.ModTime().Unix(),
			Platform:   platformOf(strings.ToLower(entry.Name())),
		})
	}
	sort.Slice(out.Installers, func(i, j int) bool {
		return out.Installers[i].Name < out.Installers[j].Name
	})
	s.json(w, http.StatusOK, out)
}

// uploadInstaller streams the request body to disk. The body is the
// file itself, not multipart, so nothing is buffered on the way
// through — the same shape the ISO upload uses.
func (s *Server) uploadInstaller(w http.ResponseWriter, r *http.Request) {
	name, ok := safeFilename(r.URL.Query().Get("filename"), installerExtensions)
	if !ok {
		s.err(w, http.StatusBadRequest,
			"filename must be a plain name ending in "+strings.Join(installerExtensions, ", "))
		return
	}
	if r.ContentLength > maxInstallerBytes {
		s.err(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("installers are limited to %d MB", maxInstallerBytes>>20))
		return
	}
	dir := filepath.Join(s.dataDir, installerDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.fail(w, err, "storing the installer")
		return
	}
	// Written beside the target and renamed, so an interrupted upload
	// can't leave a truncated file that looks installable.
	temp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		s.fail(w, err, "storing the installer")
		return
	}
	defer os.Remove(temp.Name())

	written, err := io.Copy(temp, io.LimitReader(r.Body, maxInstallerBytes))
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		s.fail(w, err, "storing the installer")
		return
	}
	if err := os.Rename(temp.Name(), s.installerPath(name)); err != nil {
		s.fail(w, err, "storing the installer")
		return
	}
	s.log.Info("installer stored", "name", name, "bytes", written)
	s.json(w, http.StatusCreated, installer{
		Name: name, Size: written, Platform: platformOf(strings.ToLower(name)),
	})
}

func (s *Server) deleteInstaller(w http.ResponseWriter, r *http.Request) {
	name, ok := safeFilename(chi.URLParam(r, "name"), installerExtensions)
	if !ok {
		s.err(w, http.StatusBadRequest, "not an installer name")
		return
	}
	if err := os.Remove(s.installerPath(name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		s.fail(w, err, "deleting the installer")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// serveInstaller is the machine-facing half, and the only route in this
// app outside the session: the point is a box with no browser and no
// account fetching a file with one command.
func (s *Server) serveInstaller(w http.ResponseWriter, r *http.Request) {
	name, ok := safeFilename(chi.URLParam(r, "name"), installerExtensions)
	if !ok {
		http.NotFound(w, r)
		return
	}
	token, err := s.installerToken(r.Context())
	if err != nil {
		http.Error(w, "installer downloads unavailable", http.StatusInternalServerError)
		return
	}
	// Header or query: curl and wget take either, and PowerShell is
	// happier with a plain URL.
	supplied := r.URL.Query().Get("token")
	if supplied == "" {
		supplied = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	if subtle.ConstantTimeCompare([]byte(supplied), []byte(token)) != 1 {
		// 404 rather than 403: an unauthenticated caller learns nothing
		// about which files exist.
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(s.installerPath(name))
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
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	http.ServeContent(w, r, name, info.ModTime(), file)
	s.log.Info("installer downloaded", "name", name, "from", r.RemoteAddr)
}

// installerToken returns the download token, minting one on first use
// the way the console's SSH key is minted.
func (s *Server) installerToken(ctx context.Context) (string, error) {
	token, err := s.store.GetSetting(ctx, installerTokenKey)
	if err == nil && token != "" {
		return token, nil
	}
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return "", err
	}
	return s.newInstallerToken(ctx)
}

func (s *Server) newInstallerToken(ctx context.Context) (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	if err := s.store.SetSetting(ctx, installerTokenKey, token); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Server) rotateInstallerToken(w http.ResponseWriter, r *http.Request) {
	token, err := s.newInstallerToken(r.Context())
	if err != nil {
		s.fail(w, err, "rotating the token")
		return
	}
	who := ""
	if user := userFrom(r.Context()); user != nil {
		who = user.Email
	}
	s.log.Warn("installer download token rotated", "by", who)
	s.json(w, http.StatusOK, map[string]string{"token": token})
}

// checksum is offered separately from the listing so the list stays a
// directory read: hashing every file on every poll would be work
// nobody asked for.
func (s *Server) installerChecksum(w http.ResponseWriter, r *http.Request) {
	name, ok := safeFilename(chi.URLParam(r, "name"), installerExtensions)
	if !ok {
		s.err(w, http.StatusBadRequest, "not an installer name")
		return
	}
	file, err := os.Open(s.installerPath(name))
	if err != nil {
		s.fail(w, err, "installer")
		return
	}
	defer file.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, file); err != nil {
		s.fail(w, err, "reading the installer")
		return
	}
	s.json(w, http.StatusOK, map[string]string{
		"name":   name,
		"sha256": hex.EncodeToString(sum.Sum(nil)),
	})
}
