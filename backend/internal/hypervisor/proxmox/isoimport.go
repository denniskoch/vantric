package proxmox

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"

	"vantric/internal/hypervisor"
)

// DownloadISO asks the node to fetch the image itself; the bytes never
// pass through this app.
func (d *Driver) DownloadISO(ctx context.Context, spec hypervisor.ISODownloadSpec) (string, error) {
	content := spec.Content
	if content == "" {
		content = "iso"
	}
	form := url.Values{
		"content":  {content},
		"filename": {spec.Filename},
		"url":      {spec.URL},
	}
	if spec.Checksum != "" && spec.ChecksumAlgorithm != "" {
		form.Set("checksum", spec.Checksum)
		form.Set("checksum-algorithm", spec.ChecksumAlgorithm)
	}
	if !spec.VerifyCertificates {
		form.Set("verify-certificates", "0")
	}
	var upid string
	path := fmt.Sprintf("/nodes/%s/storage/%s/download-url", spec.Zone, spec.Storage)
	if err := d.do(ctx, http.MethodPost, path, form, &upid); err != nil {
		return "", err
	}
	return upid, nil
}

// multipartQuoteReplacer escapes the characters that would break a
// Content-Disposition filename.
var multipartQuoteReplacer = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\r", "", "\n", "")

// UploadISO streams content to the node as a multipart body.
//
// The multipart envelope is assembled by hand rather than with
// multipart.Writer so its exact byte length is known in advance:
// pveproxy answers 501 to chunked transfer encoding, which is what Go
// falls back to when a request body has no known length. Only the
// envelope is built in memory — the image itself is streamed.
func (d *Driver) UploadISO(ctx context.Context, spec hypervisor.ISOUploadSpec, content io.Reader) (string, error) {
	if spec.SizeBytes <= 0 {
		return "", fmt.Errorf("proxmox: upload needs the image size up front")
	}
	contentType := spec.Content
	if contentType == "" {
		contentType = "iso"
	}
	boundary := multipart.NewWriter(io.Discard).Boundary()
	prologue := fmt.Sprintf(
		"--%s\r\nContent-Disposition: form-data; name=\"content\"\r\n\r\n%s\r\n"+
			"--%s\r\nContent-Disposition: form-data; name=\"filename\"; filename=\"%s\"\r\n"+
			"Content-Type: application/octet-stream\r\n\r\n",
		boundary, contentType, boundary, multipartQuoteReplacer.Replace(spec.Filename))
	epilogue := fmt.Sprintf("\r\n--%s--\r\n", boundary)

	body := io.MultiReader(
		strings.NewReader(prologue),
		io.LimitReader(content, spec.SizeBytes),
		strings.NewReader(epilogue),
	)

	path := fmt.Sprintf("/nodes/%s/storage/%s/upload", spec.Zone, spec.Storage)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.cfg.BaseURL+"/api2/json"+path, body)
	if err != nil {
		return "", err
	}
	req.ContentLength = int64(len(prologue)) + spec.SizeBytes + int64(len(epilogue))
	req.Header.Set("Authorization", "PVEAPIToken="+d.cfg.TokenID+"="+d.cfg.Secret)
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)

	resp, err := d.uploadClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("proxmox: upload %s: %s: %s", path, resp.Status, strings.TrimSpace(string(raw)))
	}
	var env struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return "", fmt.Errorf("proxmox: decoding upload response: %w", err)
	}
	return env.Data, nil
}

// DeleteVolume removes a storage volume. The storage is part of the
// volume id ("local:iso/debian.iso"), so only the node has to be
// supplied.
func (d *Driver) DeleteVolume(ctx context.Context, zone, volumeID string) (string, error) {
	storage, _, found := strings.Cut(volumeID, ":")
	if !found || storage == "" {
		return "", fmt.Errorf("proxmox: %q is not a volume id", volumeID)
	}
	// Deleting can return a task id or null depending on the storage
	// backend, so decode into a nullable string.
	var upid *string
	path := fmt.Sprintf("/nodes/%s/storage/%s/content/%s",
		zone, storage, url.PathEscape(volumeID))
	if err := d.do(ctx, http.MethodDelete, path, nil, &upid); err != nil {
		return "", err
	}
	if upid == nil {
		return "", nil
	}
	return *upid, nil
}

// DeleteImage destroys a template VM along with its disks. Templates
// can't be running, so there's no shutdown step.
func (d *Driver) DeleteImage(ctx context.Context, imageID string) (string, error) {
	node, err := d.node(ctx, imageID)
	if err != nil {
		return "", err
	}
	var upid *string
	path := fmt.Sprintf("/nodes/%s/qemu/%s?purge=1&destroy-unreferenced-disks=1", node, imageID)
	if err := d.do(ctx, http.MethodDelete, path, nil, &upid); err != nil {
		return "", err
	}
	d.mu.Lock()
	delete(d.nodeOf, imageID)
	d.mu.Unlock()
	if upid == nil {
		return "", nil
	}
	return *upid, nil
}

// TaskStatus reports on a UPID. The node is encoded in the UPID itself
// (UPID:node:…), so callers don't have to track it.
func (d *Driver) TaskStatus(ctx context.Context, taskID string) (*hypervisor.TaskStatus, error) {
	parts := strings.Split(taskID, ":")
	if len(parts) < 2 || parts[0] != "UPID" {
		return nil, fmt.Errorf("proxmox: %q is not a task id", taskID)
	}
	node := parts[1]
	var res struct {
		Status     string `json:"status"`
		ExitStatus string `json:"exitstatus"`
	}
	path := fmt.Sprintf("/nodes/%s/tasks/%s/status", node, url.PathEscape(taskID))
	if err := d.do(ctx, http.MethodGet, path, nil, &res); err != nil {
		return nil, err
	}
	return &hypervisor.TaskStatus{
		ID:         taskID,
		Status:     res.Status,
		ExitStatus: res.ExitStatus,
		Running:    res.Status == "running",
		Succeeded:  res.Status == "stopped" && res.ExitStatus == "OK",
	}, nil
}
