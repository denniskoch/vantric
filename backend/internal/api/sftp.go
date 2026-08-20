package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"

	"vantric/internal/store"
)

// File transfer to and from a guest, over SFTP.
//
// It rides the SAME identity as the terminal — the signed-in account's
// own key, as the local part of their email — which is what makes this
// safe without a permission model of its own: the transfer can reach
// exactly what that person's shell can reach, no more. There is
// deliberately no path sandbox for that reason. Adding one would
// suggest the console is the thing granting access, when the guest's
// own file permissions are.
//
// A transfer opens its own connection rather than borrowing the
// terminal's. They are separate HTTP requests, an upload shouldn't
// stall the shell behind it, and a session isn't required to be open
// at all.

// uploadLimit caps a single upload. Large enough for an installer,
// small enough that a mistake doesn't fill the guest's disk.
const uploadLimit = 2 << 30 // 2 GiB

// sftpDial opens an SFTP session to an instance as the signed-in user.
func (s *Server) sftpDial(w http.ResponseWriter, r *http.Request) (*sftp.Client, *ssh.Client, bool) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return nil, nil, false
	}
	if inst.InternalIP == "" {
		s.err(w, http.StatusConflict, "no address known for this instance")
		return nil, nil, false
	}
	me := userFrom(r.Context())
	if me == nil {
		s.err(w, http.StatusUnauthorized, "sign in and try again")
		return nil, nil, false
	}
	signer, _, err := s.userSigner(r.Context(), me)
	if err != nil {
		s.err(w, http.StatusBadGateway, err.Error())
		return nil, nil, false
	}
	// Never a name from the request: the account signs in as itself.
	username := sshUserFor(me)
	client, err := dialSSH(inst.InternalIP, sshAuth{Username: username}, signer)
	if err != nil {
		s.err(w, http.StatusBadGateway,
			"could not connect to "+inst.Name+" as "+username+": "+err.Error())
		return nil, nil, false
	}
	fs, err := sftp.NewClient(client)
	if err != nil {
		client.Close()
		// Almost always sshd without the sftp subsystem enabled, which
		// is a guest-side setting and worth naming as one.
		s.err(w, http.StatusBadGateway,
			"SFTP is not available on this guest (is the sshd sftp subsystem enabled?): "+err.Error())
		return nil, nil, false
	}
	return fs, client, true
}

// sshUserFor is the guest account this person signs in as: the local
// part of their email, matching what the terminal does.
func sshUserFor(u *store.User) string {
	if local, _, found := strings.Cut(u.Email, "@"); found {
		return local
	}
	return u.Email
}

func (s *Server) sftpUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		s.err(w, http.StatusBadRequest, "expected a multipart upload")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		s.err(w, http.StatusBadRequest, "no file in the request")
		return
	}
	defer file.Close()
	if header.Size > uploadLimit {
		s.err(w, http.StatusRequestEntityTooLarge, "file is larger than 2 GiB")
		return
	}
	// Default to the home directory, which is where a relative path
	// lands over SFTP anyway.
	dest := strings.TrimSpace(r.FormValue("path"))
	if dest == "" {
		dest = path.Base(header.Filename)
	} else if strings.HasSuffix(dest, "/") {
		dest += path.Base(header.Filename)
	}

	fs, client, ok := s.sftpDial(w, r)
	if !ok {
		return
	}
	defer client.Close()
	defer fs.Close()

	remote, err := fs.Create(dest)
	if err != nil {
		s.err(w, http.StatusBadGateway, "could not write "+dest+": "+err.Error())
		return
	}
	written, err := io.Copy(remote, io.LimitReader(file, uploadLimit))
	closeErr := remote.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		s.err(w, http.StatusBadGateway, "upload failed after "+
			strconv.FormatInt(written, 10)+" bytes: "+err.Error())
		return
	}
	s.json(w, http.StatusOK, map[string]any{"path": dest, "bytes": written})
}

func (s *Server) sftpDownload(w http.ResponseWriter, r *http.Request) {
	remotePath := strings.TrimSpace(r.URL.Query().Get("path"))
	if remotePath == "" {
		s.err(w, http.StatusBadRequest, "a path is required")
		return
	}

	// An upload is a POST and the middleware records it; this is a GET
	// and it never did — see recordGuestAccess. WHICH file is the whole
	// point of the row: "somebody downloaded something from a guest" is
	// not an audit trail.
	started := time.Now()
	var size int64
	var failure error
	defer func() {
		s.recordGuestAccess(r, guestAccessEntry{
			action: "instances.sftp.download", resource: chi.URLParam(r, "instance"),
			payload: downloadDetail(remotePath, size), at: started,
			duration: time.Since(started), err: failure,
		})
	}()

	fs, client, ok := s.sftpDial(w, r)
	if !ok {
		failure = errors.New("could not open an SFTP session to the guest")
		return
	}
	defer client.Close()
	defer fs.Close()

	info, err := fs.Stat(remotePath)
	if err != nil {
		failure = err
		s.err(w, http.StatusNotFound, remotePath+": "+err.Error())
		return
	}
	if info.IsDir() {
		failure = errors.New("is a directory")
		s.err(w, http.StatusBadRequest, remotePath+" is a directory")
		return
	}
	size = info.Size()
	remote, err := fs.Open(remotePath)
	if err != nil {
		failure = err
		s.err(w, http.StatusBadGateway, remotePath+": "+err.Error())
		return
	}
	defer remote.Close()

	// Headers before the body: once bytes are flowing there is no way
	// to turn a failure into an error response, so everything that can
	// fail has already been tried.
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("Content-Disposition",
		`attachment; filename="`+strings.ReplaceAll(path.Base(remotePath), `"`, "")+`"`)
	if _, err := io.Copy(w, remote); err != nil && !errors.Is(err, io.EOF) {
		failure = err
		s.log.Error("sftp download", "path", remotePath, "error", err)
	}
}

// downloadDetail is what the audit row carries beyond the instance: the
// file, and how much of it there was. Size is omitted when the transfer
// never got far enough to know it, rather than written as a confident 0.
func downloadDetail(remotePath string, size int64) string {
	detail := map[string]any{"path": remotePath}
	if size > 0 {
		detail["bytes"] = size
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		return ""
	}
	return string(encoded)
}
