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

	"lab-cloud-manager/internal/hypervisor"
)

// DownloadISO asks the node to fetch the image itself; the bytes never
// pass through this app.
func (d *Driver) DownloadISO(ctx context.Context, spec hypervisor.ISODownloadSpec) (string, error) {
	form := url.Values{
		"content":  {"iso"},
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

// UploadISO streams content to the node as a multipart body. An
// io.Pipe keeps memory flat regardless of image size.
func (d *Driver) UploadISO(ctx context.Context, spec hypervisor.ISOUploadSpec, content io.Reader) (string, error) {
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		err := func() error {
			if err := mw.WriteField("content", "iso"); err != nil {
				return err
			}
			part, err := mw.CreateFormFile("filename", spec.Filename)
			if err != nil {
				return err
			}
			if _, err := io.Copy(part, content); err != nil {
				return err
			}
			return mw.Close()
		}()
		// Closing with the error surfaces it on the request side.
		_ = pw.CloseWithError(err)
	}()

	path := fmt.Sprintf("/nodes/%s/storage/%s/upload", spec.Zone, spec.Storage)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.cfg.BaseURL+"/api2/json"+path, pr)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "PVEAPIToken="+d.cfg.TokenID+"="+d.cfg.Secret)
	req.Header.Set("Content-Type", mw.FormDataContentType())

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
