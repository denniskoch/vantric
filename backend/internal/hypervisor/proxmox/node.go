package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"vantric/internal/hypervisor"
)

// The host's own status and history. Everything else this driver reads
// describes something RUNNING ON a node; this describes the node.

// cfgMap descends into a nested object. Proxmox groups the host's
// status by subsystem (cpuinfo, memory, swap, rootfs), so reading it
// means one level of descent rather than a flat map.
func cfgMap(cfg map[string]any, key string) map[string]any {
	if m, ok := cfg[key].(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func cfgInt64(cfg map[string]any, key string) int64 {
	switch v := cfg[key].(type) {
	case float64:
		return int64(v)
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	default:
		return 0
	}
}

func cfgFloat(cfg map[string]any, key string) float64 {
	switch v := cfg[key].(type) {
	case float64:
		return v
	case string:
		f, _ := strconv.ParseFloat(v, 64)
		return f
	default:
		return 0
	}
}

// NodeStatus reads a host's own description of itself.
//
// It decodes through the map helpers rather than a typed struct on
// purpose: Proxmox spells several of these fields as a string on one
// version and a number on the next (cpuinfo.mhz is the usual one), and
// a typed decode fails WHOLE — one field changing shape would empty
// the page rather than blank a row.
func (d *Driver) NodeStatus(ctx context.Context, zone string) (*hypervisor.NodeStatus, error) {
	var raw map[string]any
	path := fmt.Sprintf("/nodes/%s/status", zone)
	if err := d.do(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}

	cpu := cfgMap(raw, "cpuinfo")
	mem := cfgMap(raw, "memory")
	swap := cfgMap(raw, "swap")
	root := cfgMap(raw, "rootfs")
	boot := cfgMap(raw, "boot-info")

	status := &hypervisor.NodeStatus{
		ID:            zone,
		Name:          zone,
		UptimeSeconds: cfgInt64(raw, "uptime"),

		CPUModel:   cfgString(cpu, "model"),
		CPUSockets: cfgInt(cpu, "sockets"),
		CPUCores:   cfgInt(cpu, "cores"),
		CPUs:       cfgInt(cpu, "cpus"),
		CPUMHz:     cfgString(cpu, "mhz"),
		// Both arrive as fractions of one core-second per second.
		CPUPercent:    cfgFloat(raw, "cpu") * 100,
		IOWaitPercent: cfgFloat(raw, "wait") * 100,

		MemoryTotalBytes: cfgInt64(mem, "total"),
		MemoryUsedBytes:  cfgInt64(mem, "used"),
		SwapTotalBytes:   cfgInt64(swap, "total"),
		SwapUsedBytes:    cfgInt64(swap, "used"),
		KSMSharedBytes:   cfgInt64(cfgMap(raw, "ksm"), "shared"),
		RootTotalBytes:   cfgInt64(root, "total"),
		RootUsedBytes:    cfgInt64(root, "used"),

		KernelVersion: cfgString(raw, "kversion"),
		Version:       cfgString(raw, "pveversion"),
		BootMode:      cfgString(boot, "mode"),
		SecureBoot:    cfgBool(boot, "secureboot"),
	}

	// loadavg is 1/5/15 minutes as strings. Kept as reported: they are
	// read, not computed with, and reformatting them would only risk
	// disagreeing with what the hypervisor's own console shows.
	if load, ok := raw["loadavg"].([]any); ok {
		for _, v := range load {
			if s, ok := v.(string); ok {
				status.LoadAverage = append(status.LoadAverage, s)
			}
		}
	}
	return status, nil
}

// NodeMetrics reads the host's RRD history.
//
// A node's RRD is NOT a guest's: it reports memused/memtotal where a
// guest reports mem/maxmem, and it carries root-filesystem usage in
// place of per-disk I/O — a host has no single disk to count. So the
// disk fields of every point stay zero here, and the caller renders
// three charts rather than a fourth that would always read flat.
func (d *Driver) NodeMetrics(ctx context.Context, zone string, timeframe hypervisor.MetricTimeframe) ([]hypervisor.MetricPoint, error) {
	if timeframe == "" {
		timeframe = hypervisor.TimeframeHour
	}
	var rows []struct {
		Time     int64   `json:"time"`
		CPU      float64 `json:"cpu"` // fraction 0..1
		MemUsed  float64 `json:"memused"`
		MemTotal float64 `json:"memtotal"`
		NetIn    float64 `json:"netin"`
		NetOut   float64 `json:"netout"`
	}
	path := fmt.Sprintf("/nodes/%s/rrddata?timeframe=%s&cf=AVERAGE", zone, timeframe)
	if err := d.do(ctx, http.MethodGet, path, nil, &rows); err != nil {
		return nil, err
	}
	points := make([]hypervisor.MetricPoint, 0, len(rows))
	for _, r := range rows {
		points = append(points, hypervisor.MetricPoint{
			Time:           r.Time,
			CPUPercent:     r.CPU * 100,
			MemoryBytes:    r.MemUsed,
			MaxMemoryBytes: r.MemTotal,
			NetInBytes:     r.NetIn,
			NetOutBytes:    r.NetOut,
		})
	}
	return points, nil
}
