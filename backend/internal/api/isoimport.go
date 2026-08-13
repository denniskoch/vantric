package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"

	"lab-cloud-manager/internal/hypervisor"
)

// ISO import: a server-side download from a URL, or a browser upload
// streamed through to the hypervisor.

var checksumAlgorithms = []string{"md5", "sha1", "sha224", "sha256", "sha384", "sha512"}

// safeFilename rejects path tricks and enforces an image extension.
func safeFilename(name string) (string, bool) {
	name = path.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == "/" || strings.Contains(name, "/") {
		return "", false
	}
	lower := strings.ToLower(name)
	if !strings.HasSuffix(lower, ".iso") && !strings.HasSuffix(lower, ".img") {
		return "", false
	}
	return name, true
}

// driverForServer resolves a server id from the query string.
func (s *Server) driverForServer(w http.ResponseWriter, r *http.Request) hypervisor.Driver {
	id := r.URL.Query().Get("server")
	if id == "" {
		s.err(w, http.StatusBadRequest, "server query parameter is required")
		return nil
	}
	driver, ok := s.registry.Get(id)
	if !ok {
		s.err(w, http.StatusNotFound, "server: not found")
		return nil
	}
	return driver
}

func (s *Server) downloadISO(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	var req struct {
		Zone               string `json:"zone"`
		Storage            string `json:"storage"`
		Filename           string `json:"filename"`
		URL                string `json:"url"`
		Checksum           string `json:"checksum"`
		ChecksumAlgorithm  string `json:"checksumAlgorithm"`
		VerifyCertificates bool   `json:"verifyCertificates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Zone == "" || req.Storage == "" {
		s.err(w, http.StatusBadRequest, "zone and storage are required")
		return
	}
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		s.err(w, http.StatusBadRequest, "url must be an http(s) address")
		return
	}
	// Default the filename to the URL's last path element.
	if req.Filename == "" {
		req.Filename = path.Base(req.URL)
	}
	filename, ok := safeFilename(req.Filename)
	if !ok {
		s.err(w, http.StatusBadRequest, "filename must be a plain name ending in .iso or .img")
		return
	}
	if req.Checksum != "" && !slices.Contains(checksumAlgorithms, req.ChecksumAlgorithm) {
		s.err(w, http.StatusBadRequest, "checksumAlgorithm must be one of "+strings.Join(checksumAlgorithms, ", "))
		return
	}
	taskID, err := driver.DownloadISO(r.Context(), hypervisor.ISODownloadSpec{
		Zone:               req.Zone,
		Storage:            req.Storage,
		Filename:           filename,
		URL:                req.URL,
		Checksum:           req.Checksum,
		ChecksumAlgorithm:  req.ChecksumAlgorithm,
		VerifyCertificates: req.VerifyCertificates,
	})
	if err != nil {
		s.fail(w, err, "starting image download")
		return
	}
	s.json(w, http.StatusAccepted, map[string]string{"taskId": taskID})
}

// uploadISO streams the raw request body to the hypervisor. The body is
// the image itself (not multipart) so nothing is buffered on the way
// through; metadata rides in the query string.
func (s *Server) uploadISO(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	q := r.URL.Query()
	zone, storage := q.Get("zone"), q.Get("storage")
	if zone == "" || storage == "" {
		s.err(w, http.StatusBadRequest, "zone and storage are required")
		return
	}
	filename, ok := safeFilename(q.Get("filename"))
	if !ok {
		s.err(w, http.StatusBadRequest, "filename must be a plain name ending in .iso or .img")
		return
	}
	// The hypervisor needs an exact length up front, so refuse a body
	// that didn't declare one rather than failing halfway through.
	if r.ContentLength <= 0 {
		s.err(w, http.StatusLengthRequired, "upload requires a Content-Length")
		return
	}
	taskID, err := driver.UploadISO(r.Context(), hypervisor.ISOUploadSpec{
		Zone:      zone,
		Storage:   storage,
		Filename:  filename,
		SizeBytes: r.ContentLength,
	}, r.Body)
	if err != nil {
		// Responding while the client is still sending makes proxies
		// report a broken pipe instead of this error, so absorb what's
		// left of the body first (bounded, in case it's enormous).
		_, _ = io.CopyN(io.Discard, r.Body, 32<<20)
		s.fail(w, err, "uploading image")
		return
	}
	s.json(w, http.StatusAccepted, map[string]string{"taskId": taskID})
}

// deleteISO removes an image. The volume id travels in the query string
// because it contains both a colon and a slash.
func (s *Server) deleteISO(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	q := r.URL.Query()
	zone, volume := q.Get("zone"), q.Get("volume")
	if zone == "" || volume == "" {
		s.err(w, http.StatusBadRequest, "zone and volume are required")
		return
	}
	// Only ISO volumes are deletable here; anything else (a VM disk,
	// a backup) must not be removable through this endpoint.
	if !strings.Contains(volume, ":iso/") {
		s.err(w, http.StatusBadRequest, "volume is not an ISO image")
		return
	}
	taskID, err := driver.DeleteISO(r.Context(), zone, volume)
	if err != nil {
		s.fail(w, err, "deleting image")
		return
	}
	s.json(w, http.StatusOK, map[string]string{"taskId": taskID})
}

func (s *Server) taskStatus(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	// Task ids contain colons, so they arrive percent-encoded; chi routes
	// on the escaped path and hands back the raw value.
	taskID, err := url.PathUnescape(chi.URLParam(r, "taskId"))
	if err != nil {
		s.err(w, http.StatusBadRequest, "malformed task id")
		return
	}
	status, err := driver.TaskStatus(r.Context(), taskID)
	if err != nil {
		s.fail(w, err, "task status")
		return
	}
	s.json(w, http.StatusOK, status)
}
