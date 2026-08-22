package api

import (
	"encoding/json"
	"net/http"
)

// Favourite sections, pinned to the top of the global menu.
//
// SELF-SERVICE, like the password and the SSH key: a viewer who can't
// arrange their own menu has been given an account and told to work
// around it. The RBAC middleware exempts these for that reason.
//
// The ids are the frontend's — a section id from nav.tsx — and are
// deliberately NOT validated against a list here. The backend has no
// business knowing what sections exist (the same rule that keeps query
// keys out of the operations code), and an id that stops matching
// after a rename simply doesn't render, which is the right outcome.

func (s *Server) myFavorites(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	ids, err := s.store.Favorites(r.Context(), me.ID)
	if err != nil {
		s.fail(w, err, "your favorites")
		return
	}
	s.json(w, http.StatusOK, ids)
}

func (s *Server) setMyFavorites(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	var ids []string
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		s.err(w, http.StatusBadRequest, "expected a JSON array of section ids")
		return
	}
	// A cap rather than a list: the point of a favourite is that it is
	// a short list, and a menu with fifty pinned entries has no top.
	if len(ids) > 24 {
		s.err(w, http.StatusBadRequest, "that's more favorites than the menu can be shortened by")
		return
	}
	if err := s.store.SetFavorites(r.Context(), me.ID, ids); err != nil {
		s.fail(w, err, "saving your favorites")
		return
	}
	s.json(w, http.StatusOK, ids)
}
