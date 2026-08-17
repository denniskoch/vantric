package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"vantric/internal/dns"
)

// The SOA is its own endpoint rather than a record type in the set
// editor. Every other editable type holds one plain string; this one
// holds seven fields with different units and different consequences,
// and the record-set form has nowhere to put that. It also isn't a SET
// — a zone has exactly one, always, and it cannot be created or
// deleted, only changed.

// zoneSOA finds the apex SOA and returns it parsed.
func (s *Server) zoneSOA(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	zoneID := chi.URLParam(r, "id")
	_, soa, err := s.readSOA(r, provider, zoneID)
	if err != nil {
		s.fail(w, err, "SOA record")
		return
	}
	if soa == nil {
		// Not an error: a provider that manages the SOA itself simply
		// never reports one, and saying so beats an empty form.
		s.err(w, http.StatusNotFound, "this provider doesn't expose the zone's SOA record")
		return
	}
	s.json(w, http.StatusOK, soa)
}

func (s *Server) readSOA(r *http.Request, provider dns.Provider, zoneID string) (*dns.Record, *dns.SOA, error) {
	records, err := provider.Records(r.Context(), zoneID)
	if err != nil {
		return nil, nil, err
	}
	for i := range records {
		if records[i].Type != "SOA" {
			continue
		}
		soa, err := dns.ParseSOA(records[i].Content, records[i].TTL)
		if err != nil {
			return nil, nil, err
		}
		return &records[i], soa, nil
	}
	return nil, nil, nil
}

func (s *Server) saveZoneSOA(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	zoneID := chi.URLParam(r, "id")

	var req dns.SOA
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := req.Validate(); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}

	existing, current, err := s.readSOA(r, provider, zoneID)
	if err != nil {
		s.fail(w, err, "SOA record")
		return
	}
	if current == nil {
		s.err(w, http.StatusNotFound, "this provider doesn't expose the zone's SOA record")
		return
	}
	// A changed zone needs a higher serial or secondaries ignore it.
	// The console won't invent one — a serial that moves backwards is
	// worse than one that doesn't move — but it refuses to write one
	// that would strand the change.
	if req.Serial < current.Serial {
		s.err(w, http.StatusBadRequest,
			"the serial must not go backwards; secondaries ignore a zone whose serial has decreased")
		return
	}

	zone, err := provider.Zone(r.Context(), zoneID)
	if err != nil {
		s.fail(w, err, "zone")
		return
	}
	ttl := req.TTL
	if ttl <= 0 {
		ttl = existing.TTL
	}

	spec := dns.RecordSetSpec{
		Name:   zone.Name,
		Type:   "SOA",
		TTL:    ttl,
		Values: []dns.RecordSetValue{{Content: req.Content()}},
	}
	if writer, ok := provider.(dns.RecordSetWriter); ok {
		if _, err := writer.SaveRecordSet(r.Context(), zoneID, spec); err != nil {
			s.fail(w, err, "saving the SOA record")
			return
		}
	} else if _, err := provider.UpdateRecord(r.Context(), zoneID, existing.ID, dns.RecordSpec{
		Name:    zone.Name,
		Type:    "SOA",
		Content: req.Content(),
		TTL:     ttl,
	}); err != nil {
		s.fail(w, err, "saving the SOA record")
		return
	}

	_, saved, err := s.readSOA(r, provider, zoneID)
	if err != nil || saved == nil {
		// The write went through; reporting what was asked for beats
		// failing a request that succeeded.
		s.json(w, http.StatusOK, req)
		return
	}
	s.json(w, http.StatusOK, saved)
}
