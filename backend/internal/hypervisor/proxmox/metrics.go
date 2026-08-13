package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"lab-cloud-manager/internal/hypervisor"
)

// sortByName orders a slice by a string key extracted from each element.
func sortByName[T any](items []T, key func(T) string) {
	slices.SortFunc(items, func(a, b T) int { return strings.Compare(key(a), key(b)) })
}

// Metrics reads Proxmox RRD data for a VM. Samples with no data (the
// VM was off) come back with zeroed fields, which callers render as gaps.
func (d *Driver) Metrics(ctx context.Context, driverID string, timeframe hypervisor.MetricTimeframe) ([]hypervisor.MetricPoint, error) {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return nil, err
	}
	return d.rrdData(ctx, fmt.Sprintf("/nodes/%s/qemu/%s/rrddata", node, driverID), timeframe)
}

func (d *Driver) rrdData(ctx context.Context, base string, timeframe hypervisor.MetricTimeframe) ([]hypervisor.MetricPoint, error) {
	if timeframe == "" {
		timeframe = hypervisor.TimeframeHour
	}
	var rows []struct {
		Time      int64   `json:"time"`
		CPU       float64 `json:"cpu"` // fraction 0..1
		Mem       float64 `json:"mem"`
		MaxMem    float64 `json:"maxmem"`
		DiskRead  float64 `json:"diskread"`
		DiskWrite float64 `json:"diskwrite"`
		NetIn     float64 `json:"netin"`
		NetOut    float64 `json:"netout"`
	}
	path := fmt.Sprintf("%s?timeframe=%s&cf=AVERAGE", base, timeframe)
	if err := d.do(ctx, http.MethodGet, path, nil, &rows); err != nil {
		return nil, err
	}
	points := make([]hypervisor.MetricPoint, 0, len(rows))
	for _, r := range rows {
		points = append(points, hypervisor.MetricPoint{
			Time:           r.Time,
			CPUPercent:     r.CPU * 100,
			MemoryBytes:    r.Mem,
			MaxMemoryBytes: r.MaxMem,
			DiskReadBytes:  r.DiskRead,
			DiskWriteBytes: r.DiskWrite,
			NetInBytes:     r.NetIn,
			NetOutBytes:    r.NetOut,
		})
	}
	return points, nil
}

// OSInfo asks the QEMU guest agent about the guest OS. Without an agent
// it falls back to the configured ostype.
func (d *Driver) OSInfo(ctx context.Context, driverID string) (*hypervisor.OSInfo, error) {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return nil, err
	}
	info := &hypervisor.OSInfo{}

	var cfg map[string]any
	cfgPath := fmt.Sprintf("/nodes/%s/qemu/%s/config", node, driverID)
	if err := d.do(ctx, http.MethodGet, cfgPath, nil, &cfg); err == nil {
		info.OSType = cfgString(cfg, "ostype")
	}

	var osRes struct {
		Result struct {
			ID            string `json:"id"`
			KernelRelease string `json:"kernel-release"`
			KernelVersion string `json:"kernel-version"`
			Machine       string `json:"machine"`
			Name          string `json:"name"`
			PrettyName    string `json:"pretty-name"`
			Version       string `json:"version"`
		} `json:"result"`
	}
	osPath := fmt.Sprintf("/nodes/%s/qemu/%s/agent/get-osinfo", node, driverID)
	if err := d.do(ctx, http.MethodGet, osPath, nil, &osRes); err != nil {
		return info, nil // no agent: Available stays false
	}
	info.Available = true
	info.Name = osRes.Result.PrettyName
	if info.Name == "" {
		info.Name = osRes.Result.Name
	}
	info.Version = osRes.Result.Version
	info.KernelRelease = osRes.Result.KernelRelease
	info.KernelVersion = osRes.Result.KernelVersion
	info.Machine = osRes.Result.Machine

	var hostRes struct {
		Result struct {
			HostName string `json:"host-name"`
		} `json:"result"`
	}
	hostPath := fmt.Sprintf("/nodes/%s/qemu/%s/agent/get-host-name", node, driverID)
	if err := d.do(ctx, http.MethodGet, hostPath, nil, &hostRes); err == nil {
		info.Hostname = hostRes.Result.HostName
	}
	return info, nil
}
