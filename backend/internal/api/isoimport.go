package api

import (
	"encoding/json"
	"io"
	"net/http"
	"path"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"

	"vantric/internal/hypervisor"
)

// ISO import: a server-side download from a URL, or a browser upload
// streamed through to the hypervisor.

var checksumAlgorithms = []string{"md5", "sha1", "sha224", "sha256", "sha384", "sha512"}

// isoExtensions are the media formats an ISO datastore accepts.
var isoExtensions = []string{".iso", ".img"}

// safeFilename rejects path tricks and enforces an allowed extension.
func safeFilename(name string, extensions []string) (string, bool) {
	name = path.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == "/" || strings.Contains(name, "/") {
		return "", false
	}
	lower := strings.ToLower(name)
	for _, ext := range extensions {
		if strings.HasSuffix(lower, ext) {
			return name, true
		}
	}
	return "", false
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
		Node               string `json:"node"`
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
	if req.Node == "" || req.Storage == "" {
		s.err(w, http.StatusBadRequest, "node and storage are required")
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
	filename, ok := safeFilename(req.Filename, isoExtensions)
	if !ok {
		s.err(w, http.StatusBadRequest, "filename must be a plain name ending in .iso or .img")
		return
	}
	if req.Checksum != "" && !slices.Contains(checksumAlgorithms, req.ChecksumAlgorithm) {
		s.err(w, http.StatusBadRequest, "checksumAlgorithm must be one of "+strings.Join(checksumAlgorithms, ", "))
		return
	}
	taskID, err := driver.DownloadISO(r.Context(), hypervisor.ISODownloadSpec{
		Node:               req.Node,
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
	op := s.ops.start("Downloading ISO "+filename, "iso", filename,
		r.URL.Query().Get("server"), "/compute/isos")
	s.watchTask(op, driver, taskID, "Downloaded to "+req.Storage)
	s.json(w, http.StatusAccepted, op)
}

// uploadVolume streams the raw request body to the hypervisor. The body
// is the image itself (not multipart) so nothing is buffered on the way
// through; metadata rides in the query string.
func (s *Server) uploadVolume(content string, extensions []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		driver := s.driverForServer(w, r)
		if driver == nil {
			return
		}
		q := r.URL.Query()
		node, storage := q.Get("node"), q.Get("storage")
		if node == "" || storage == "" {
			s.err(w, http.StatusBadRequest, "node and storage are required")
			return
		}
		filename, ok := safeFilename(q.Get("filename"), extensions)
		if !ok {
			s.err(w, http.StatusBadRequest,
				"filename must be a plain name ending in "+strings.Join(extensions, ", "))
			return
		}
		// The hypervisor needs an exact length up front, so refuse a body
		// that didn't declare one rather than failing halfway through.
		if r.ContentLength <= 0 {
			s.err(w, http.StatusLengthRequired, "upload requires a Content-Length")
			return
		}
		taskID, err := driver.UploadISO(r.Context(), hypervisor.ISOUploadSpec{
			Node:      node,
			Storage:   storage,
			Filename:  filename,
			Content:   content,
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
		kind, to := "iso", "/compute/isos"
		if content == "import" {
			kind, to = "cloudImage", "/compute/cloud-images"
		}
		op := s.ops.start("Uploading "+filename, kind, filename, q.Get("server"), to)
		s.watchTask(op, driver, taskID, "Uploaded to "+storage)
		s.json(w, http.StatusAccepted, op)
	}
}

// deleteVolume removes an ISO or CT template. The volume id travels in
// the query string because it contains both a colon and a slash.
// kind restricts which volumes an endpoint may touch: the underlying
// storage-content path would happily delete VM disks and backups too.
func (s *Server) deleteVolume(kind, label, resourceType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		driver := s.driverForServer(w, r)
		if driver == nil {
			return
		}
		q := r.URL.Query()
		node, volume := q.Get("node"), q.Get("volume")
		if node == "" || volume == "" {
			s.err(w, http.StatusBadRequest, "node and volume are required")
			return
		}
		if !strings.Contains(volume, ":"+kind+"/") {
			s.err(w, http.StatusBadRequest, "volume is not a "+label)
			return
		}
		taskID, err := driver.DeleteVolume(r.Context(), node, volume)
		if err != nil {
			s.fail(w, err, "deleting "+label)
			return
		}
		name := volume[strings.LastIndex(volume, "/")+1:]
		op := s.ops.start("Deleting "+label+" "+name, resourceType, name,
			q.Get("server"), "")
		s.watchTask(op, driver, taskID, "Deleted")
		s.json(w, http.StatusAccepted, op)
	}
}

// deleteImage destroys a VM template — a real VM and its disks, so it
// refuses while any instance still records it as its source image.
// describeImage reads a template's own configuration — a template is a
// VM, so this is the same call the instance detail view makes.
//
// It exists so the create flow can show what the template already
// carries instead of asking for it again: a template built here was
// given a login, keys, DNS and a datasource, and cloning it keeps all
// of that. Blank fields on create leave the clone's inherited values
// alone, so the form was asking questions whose answers were already
// on file.
func (s *Server) describeImage(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	detail, err := driver.Describe(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "template")
		return
	}
	s.json(w, http.StatusOK, detail)
}

// setImageDescription writes a template's notes. A template has no
// record of its own here — it is listed straight from the hypervisor —
// so this is a pass-through with nothing to keep in step.
func (s *Server) setImageDescription(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	description, ok := s.readDescription(w, r)
	if !ok {
		return
	}
	if err := driver.SetDescription(r.Context(), chi.URLParam(r, "id"), description); err != nil {
		s.fail(w, err, "saving the description")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteImage(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	imageID := chi.URLParam(r, "id")
	serverID := r.URL.Query().Get("server")
	instances, err := s.store.ListInstances(r.Context())
	if err != nil {
		s.fail(w, err, "instances")
		return
	}
	for _, inst := range instances {
		if inst.ServerID == serverID && inst.ImageID == imageID {
			s.err(w, http.StatusConflict,
				"instance "+inst.Name+" still records this template as its source image")
			return
		}
	}
	taskID, err := driver.DeleteImage(r.Context(), imageID)
	if err != nil {
		s.fail(w, err, "deleting VM template")
		return
	}
	op := s.ops.start("Deleting VM template "+imageID, "image", imageID,
		serverID, "/compute/vm-templates")
	s.watchTask(op, driver, taskID, "Deleted")
	s.json(w, http.StatusAccepted, op)
}
