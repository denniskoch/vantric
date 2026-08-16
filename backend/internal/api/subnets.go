package api

import (
	"encoding/json"
	"net/http"
	"net/netip"
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

func (s *Server) listSubnets(w http.ResponseWriter, r *http.Request) {
	subnets, err := s.store.ListSubnets(r.Context())
	if err != nil {
		s.fail(w, err, "subnets")
		return
	}
	s.json(w, http.StatusOK, subnets)
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
