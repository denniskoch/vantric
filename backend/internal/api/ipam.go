package api

import (
	"encoding/json"
	"net/http"
	"net/netip"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/store"
)

// The address view inside a subnet.
//
// Addresses are GENERATED from the prefix, not stored: a /16 holds 65k
// of them and almost none carry information, so the table would end up
// the size of the address space instead of the size of what's known.
// Records are joined onto the generated list, and the roles an address
// already has — network, broadcast, gateway, inside the DHCP pool —
// are derived from the subnet itself, because those are facts about
// the range rather than things anybody should have to type.

// addressView is one address in a subnet.
type addressView struct {
	Address string `json:"address"`
	// Role is what the range says this address is: network,
	// broadcast, gateway, dhcp, or "" for an ordinary host address.
	Role string `json:"role"`
	// Usable is false for the network and broadcast addresses, which
	// can never be assigned to anything.
	Usable bool `json:"usable"`
	// Record is what somebody has written down, when there is any.
	Record *store.IPAddress `json:"record,omitempty"`
}

type addressPage struct {
	Addresses []addressView `json:"addresses"`
	// Total is every address the prefix contains, so the pager can
	// size itself without walking them.
	Total int `json:"total"`
	Page  int `json:"page"`
	// Counts describe the WHOLE subnet, not the page — a page's worth
	// of numbers would be useless for capacity.
	Recorded int `json:"recorded"`
	InDHCP   int `json:"inDhcp"`
	Free     int `json:"free"`
}

const addressesPerPage = 100

// listSubnetAddresses walks one page of a subnet's address space.
//
// It counts by arithmetic rather than by iterating: a /8 has sixteen
// million addresses, and the totals must not depend on how big the
// range is.
func (s *Server) listSubnetAddresses(w http.ResponseWriter, r *http.Request) {
	subnet, err := s.store.GetSubnet(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "subnet")
		return
	}
	prefix, err := netip.ParsePrefix(subnet.IPv4Range)
	if err != nil || !prefix.Addr().Is4() {
		s.err(w, http.StatusConflict, "this subnet has no usable IPv4 range")
		return
	}
	records, err := s.store.ListIPAddresses(r.Context(), subnet.ID)
	if err != nil {
		s.fail(w, err, "addresses")
		return
	}
	byAddress := map[string]store.IPAddress{}
	for _, record := range records {
		byAddress[record.Address] = record
	}

	first := ipToUint(prefix.Masked().Addr())
	size := uint64(1) << uint(32-prefix.Bits())
	last := first + size - 1
	dhcpStart, dhcpOK := ipToUintStr(subnet.DHCPStart)
	dhcpStop, stopOK := ipToUintStr(subnet.DHCPStop)
	inPool := func(n uint64) bool {
		return dhcpOK && stopOK && n >= dhcpStart && n <= dhcpStop
	}

	page := 1
	if v, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && v > 1 {
		page = v
	}
	view := addressPage{
		Addresses: []addressView{},
		Total:     int(size),
		Page:      page,
		Recorded:  len(records),
	}
	// Whole-subnet counts, by arithmetic.
	if dhcpOK && stopOK && dhcpStop >= dhcpStart {
		view.InDHCP = int(dhcpStop - dhcpStart + 1)
	}
	unusable := 0
	if size > 2 { // a /31 or /32 has no network and broadcast to spare
		unusable = 2
	}
	view.Free = int(size) - unusable - view.InDHCP - len(records)
	if view.Free < 0 {
		view.Free = 0
	}

	start := first + uint64((page-1)*addressesPerPage)
	for n := start; n <= last && n < start+addressesPerPage; n++ {
		address := uintToIP(n)
		item := addressView{Address: address, Usable: true}
		switch {
		case size > 2 && n == first:
			item.Role, item.Usable = "network", false
		case size > 2 && n == last:
			item.Role, item.Usable = "broadcast", false
		case address == subnet.IPv4Gateway:
			item.Role = "gateway"
		case inPool(n):
			item.Role = "dhcp"
		}
		if record, ok := byAddress[address]; ok {
			item.Record = &record
		}
		view.Addresses = append(view.Addresses, item)
	}
	s.json(w, http.StatusOK, view)
}

// saveSubnetAddress records something about one address.
func (s *Server) saveSubnetAddress(w http.ResponseWriter, r *http.Request) {
	subnet, err := s.store.GetSubnet(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "subnet")
		return
	}
	var req struct {
		Address     string `json:"address"`
		Hostname    string `json:"hostname"`
		MAC         string `json:"mac"`
		Status      string `json:"status"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	address, err := netip.ParseAddr(strings.TrimSpace(req.Address))
	if err != nil || !address.Is4() {
		s.err(w, http.StatusBadRequest, "address must be an IPv4 address")
		return
	}
	prefix, err := netip.ParsePrefix(subnet.IPv4Range)
	if err != nil || !prefix.Contains(address) {
		s.err(w, http.StatusBadRequest,
			req.Address+" is not inside "+subnet.IPv4Range)
		return
	}
	if req.Status != "reserved" {
		req.Status = "assigned"
	}
	record := &store.IPAddress{
		ID:          uuid.NewString(),
		SubnetID:    subnet.ID,
		Address:     address.String(),
		Hostname:    strings.TrimSpace(req.Hostname),
		MAC:         strings.TrimSpace(req.MAC),
		Status:      req.Status,
		Description: strings.TrimSpace(req.Description),
	}
	if err := s.store.SaveIPAddress(r.Context(), record); err != nil {
		s.fail(w, err, "saving address")
		return
	}
	s.json(w, http.StatusOK, record)
}

func (s *Server) deleteSubnetAddress(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteIPAddress(r.Context(),
		chi.URLParam(r, "id"), chi.URLParam(r, "address")); err != nil {
		s.fail(w, err, "deleting address")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func ipToUint(a netip.Addr) uint64 {
	b := a.As4()
	return uint64(b[0])<<24 | uint64(b[1])<<16 | uint64(b[2])<<8 | uint64(b[3])
}

func ipToUintStr(s string) (uint64, bool) {
	a, err := netip.ParseAddr(s)
	if err != nil || !a.Is4() {
		return 0, false
	}
	return ipToUint(a), true
}

func uintToIP(n uint64) string {
	return netip.AddrFrom4([4]byte{
		byte(n >> 24), byte(n >> 16), byte(n >> 8), byte(n),
	}).String()
}
