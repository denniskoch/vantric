package api

import (
	"encoding/json"
	"net/http"
	"net/netip"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/store"
)

// Subnets are the console's own record of what each address range is
// for — the IPAM half of "what's running vs what DNS publishes vs what
// the addresses were meant to be".
//
// Only manual ranges are writable. A subnet whose source is a
// controller belongs to that controller, and this API refuses to edit
// it rather than letting two systems disagree about the same range.

type subnetRequest struct {
	Name        string `json:"name"`
	StackType   string `json:"stackType"`
	VLAN        int    `json:"vlan"`
	IPv4Range   string `json:"ipv4Range"`
	IPv4Gateway string `json:"ipv4Gateway"`
	Description string `json:"description"`
}

// validate checks the request and returns a message fit to show, or "".
//
// The range and gateway are parsed rather than pattern-matched,
// because the mistakes worth catching are semantic: a gateway that
// isn't inside its own subnet, or host bits set on what claims to be
// a network. Neither looks wrong.
func (r *subnetRequest) validate() string {
	r.Name = strings.TrimSpace(r.Name)
	r.IPv4Range = strings.TrimSpace(r.IPv4Range)
	r.IPv4Gateway = strings.TrimSpace(r.IPv4Gateway)
	r.Description = strings.TrimSpace(r.Description)
	if r.StackType == "" {
		r.StackType = "IPv4"
	}

	switch {
	case r.Name == "":
		return "a name is required"
	case r.StackType != "IPv4":
		return "stack type must be IPv4"
	case r.IPv4Range == "":
		return "an IPv4 range is required"
	// 0 means untagged. 4095 is reserved and 4096 doesn't fit the
	// 12-bit tag, which is the mistake people actually make.
	case r.VLAN < 0 || r.VLAN > 4094:
		return "VLAN must be between 1 and 4094, or 0 for untagged"
	}

	prefix, err := netip.ParsePrefix(r.IPv4Range)
	if err != nil {
		return "IPv4 range must be CIDR, for example 192.168.80.0/24"
	}
	if !prefix.Addr().Is4() {
		return "IPv4 range must be an IPv4 network"
	}
	// 192.168.80.7/24 is a host address wearing a network's clothes.
	// Storing it would make every later containment test wrong.
	if prefix.Masked() != prefix {
		return "IPv4 range has host bits set — did you mean " +
			prefix.Masked().String() + "?"
	}

	if r.IPv4Gateway != "" {
		gateway, err := netip.ParseAddr(r.IPv4Gateway)
		if err != nil || !gateway.Is4() {
			return "IPv4 gateway must be an IPv4 address"
		}
		if !prefix.Contains(gateway) {
			return "IPv4 gateway " + r.IPv4Gateway + " is not inside " + r.IPv4Range
		}
	}
	return ""
}

// listSubnets returns one list: the ranges recorded here and the ones
// the network controllers already know about, merged.
//
// Merged on the SERVER, in one response, rather than letting the page
// draw its own rows and then append the controller's when they arrive.
// Two renders would mean the table jumps, and worse, that the answer
// depends on which request finished — a subnet is a subnet whoever
// happens to know about it.
//
// A controller that doesn't answer is skipped and logged, not fatal:
// the same rule catalog listings follow. Losing the manual rows
// because a controller is down would be the wrong trade.
func (s *Server) listSubnets(w http.ResponseWriter, r *http.Request) {
	subnets, err := s.store.ListSubnets(r.Context())
	if err != nil {
		s.fail(w, err, "subnets")
		return
	}
	subnets = append(subnets, s.discoveredSubnets(r)...)

	// Ordered by address, so a manual record and a controller's view of
	// the same range land next to each other and the duplication shows
	// itself.
	slices.SortFunc(subnets, func(a, b store.Subnet) int {
		if n := compareRanges(a.IPv4Range, b.IPv4Range); n != 0 {
			return n
		}
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, subnets)
}

// discoveredSubnets reads the LAN networks every configured controller
// defines. WANs are deliberately left out — they have ranges, but the
// Internet page is where an uplink belongs, and listing them here
// would answer "what are my subnets" with somebody's ISP.
func (s *Server) discoveredSubnets(r *http.Request) []store.Subnet {
	records, err := s.store.ListNetworkProviders(r.Context())
	if err != nil {
		s.log.Error("listing network providers for subnets", "error", err)
		return nil
	}
	var found []store.Subnet
	for _, record := range records {
		provider, ok := s.networkRegistry.Get(record.ID)
		if !ok {
			continue
		}
		networks, err := provider.Networks(r.Context(), "")
		if err != nil {
			s.log.Error("reading networks for subnets",
				"controller", record.Name, "error", err)
			continue
		}
		for _, n := range networks {
			if n.Category != "lan" || n.Subnet == "" {
				continue
			}
			subnet := store.Subnet{
				// Stable without being a database row: the same
				// network keeps the same id across reads, and it can
				// never collide with a stored uuid.
				ID:        "unifi:" + record.ID + ":" + n.ID,
				Name:      n.Name,
				Source:    record.Name,
				StackType: "IPv4",
				VLAN:      n.VLAN,
			}
			// UniFi states this as the GATEWAY with a prefix length
			// — 192.168.80.1/24, not 192.168.80.0/24 — so one parse
			// yields both fields, and taking it at face value would
			// file every network under a range that doesn't exist.
			if prefix, err := netip.ParsePrefix(n.Subnet); err == nil && prefix.Addr().Is4() {
				subnet.IPv4Range = prefix.Masked().String()
				if prefix.Addr() != prefix.Masked().Addr() {
					subnet.IPv4Gateway = prefix.Addr().String()
				}
			} else {
				subnet.IPv4Range = n.Subnet
			}
			if n.Site != "" {
				subnet.Description = "site " + n.Site
			}
			found = append(found, subnet)
		}
	}
	return found
}

// compareRanges orders CIDR strings by address. Anything unparseable
// sorts last rather than throwing the order away.
func compareRanges(a, b string) int {
	pa, errA := netip.ParsePrefix(a)
	pb, errB := netip.ParsePrefix(b)
	switch {
	case errA != nil && errB != nil:
		return strings.Compare(a, b)
	case errA != nil:
		return 1
	case errB != nil:
		return -1
	}
	if n := pa.Addr().Compare(pb.Addr()); n != 0 {
		return n
	}
	return pa.Bits() - pb.Bits()
}

func (s *Server) getSubnet(w http.ResponseWriter, r *http.Request) {
	subnet, err := s.store.GetSubnet(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "subnet")
		return
	}
	s.json(w, http.StatusOK, subnet)
}

func (s *Server) createSubnet(w http.ResponseWriter, r *http.Request) {
	var req subnetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if msg := req.validate(); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	subnet := &store.Subnet{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Source:      store.SourceManual,
		StackType:   req.StackType,
		VLAN:        req.VLAN,
		IPv4Range:   req.IPv4Range,
		IPv4Gateway: req.IPv4Gateway,
		Description: req.Description,
	}
	if err := s.store.CreateSubnet(r.Context(), subnet); err != nil {
		s.fail(w, err, "saving subnet")
		return
	}
	s.json(w, http.StatusCreated, subnet)
}

func (s *Server) updateSubnet(w http.ResponseWriter, r *http.Request) {
	existing, err := s.store.GetSubnet(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "subnet")
		return
	}
	// Whoever reported it owns it; editing here would make the two
	// disagree with no way to tell which is right.
	if existing.Source != store.SourceManual {
		s.err(w, http.StatusConflict,
			"this subnet comes from "+existing.Source+" and is read-only here")
		return
	}
	var req subnetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if msg := req.validate(); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	existing.Name = req.Name
	existing.StackType = req.StackType
	existing.VLAN = req.VLAN
	existing.IPv4Range = req.IPv4Range
	existing.IPv4Gateway = req.IPv4Gateway
	existing.Description = req.Description
	if err := s.store.UpdateSubnet(r.Context(), existing); err != nil {
		s.fail(w, err, "saving subnet")
		return
	}
	s.json(w, http.StatusOK, existing)
}

func (s *Server) deleteSubnet(w http.ResponseWriter, r *http.Request) {
	existing, err := s.store.GetSubnet(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "subnet")
		return
	}
	if existing.Source != store.SourceManual {
		s.err(w, http.StatusConflict,
			"this subnet comes from "+existing.Source+" and is read-only here")
		return
	}
	if err := s.store.DeleteSubnet(r.Context(), existing.ID); err != nil {
		s.fail(w, err, "deleting subnet")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
