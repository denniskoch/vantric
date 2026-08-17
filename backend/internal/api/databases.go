package api

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/database"
	dbfactory "vantric/internal/database/factory"
	"vantric/internal/store"
)

// Database servers are existing servers this console connects to.
// Same shape as hypervisors and DNS providers: a DB record holding
// credentials, one live driver per record in a registry.

// identRe guards every name that reaches a DDL statement. DDL can't
// take bind parameters, so the driver quotes identifiers and this
// keeps the surface small in the first place.
var identRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_$-]{0,62}$`)

func (s *Server) databaseRoutes(r chi.Router) {
	r.Get("/database/engines", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, dbfactory.Types)
	})
	r.Get("/database/servers", s.listDatabaseServers)
	r.Post("/database/servers", s.createDatabaseServer)
	r.Get("/database/servers/{id}", s.getDatabaseServer)
	r.Put("/database/servers/{id}", s.updateDatabaseServer)
	r.Delete("/database/servers/{id}", s.deleteDatabaseServer)
	r.Get("/database/databases", s.listDatabases)
	r.Post("/database/servers/{id}/databases", s.createDatabase)
	r.Delete("/database/servers/{id}/databases/{name}", s.dropDatabase)
	r.Get("/database/servers/{id}/users", s.listDatabaseUsers)
	r.Post("/database/servers/{id}/users", s.createDatabaseUser)
	r.Put("/database/servers/{id}/users/{name}/password", s.setDatabaseUserPassword)
	r.Delete("/database/servers/{id}/users/{name}", s.dropDatabaseUser)
	r.Get("/database/servers/{id}/connections", s.listDatabaseConnections)
	// Inside one database. Read on demand for the detail view — these
	// query the target's own catalog and PostgreSQL has to connect to
	// it, so they are never part of a polled listing.
	r.Get("/database/servers/{id}/databases/{name}/tables", s.listDatabaseTables)
	r.Get("/database/servers/{id}/databases/{name}/grants", s.listDatabaseGrants)
	r.Put("/database/servers/{id}/databases/{name}/access", s.grantDatabaseAccess)
	r.Delete("/database/servers/{id}/databases/{name}/access", s.revokeDatabaseAccess)
}

// databaseServerView is the API shape: everything but the password,
// plus what the server reports when it's reachable.
type databaseServerView struct {
	store.DatabaseServer
	HasPassword bool                 `json:"hasPassword"`
	Status      string               `json:"status"` // connected | unreachable
	Info        *database.ServerInfo `json:"info,omitempty"`
	Error       string               `json:"error,omitempty"`
}

func (s *Server) probeDatabaseServer(ctx context.Context, rec store.DatabaseServer) databaseServerView {
	view := databaseServerView{DatabaseServer: rec, HasPassword: rec.Password != "", Status: "unknown"}
	driver, ok := s.dbRegistry.Get(rec.ID)
	if !ok {
		view.Error = "no driver loaded"
		return view
	}
	info, err := driver.Info(ctx)
	if err != nil {
		view.Status = "unreachable"
		view.Error = err.Error()
		return view
	}
	view.Status = "connected"
	view.Info = info
	return view
}

func (s *Server) listDatabaseServers(w http.ResponseWriter, r *http.Request) {
	servers, err := s.store.ListDatabaseServers(r.Context())
	if err != nil {
		s.fail(w, err, "database servers")
		return
	}
	views := make([]databaseServerView, len(servers))
	var wg sync.WaitGroup
	for i := range servers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeDatabaseServer(r.Context(), servers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

func (s *Server) getDatabaseServer(w http.ResponseWriter, r *http.Request) {
	rec, err := s.store.GetDatabaseServer(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "database server")
		return
	}
	s.json(w, http.StatusOK, s.probeDatabaseServer(r.Context(), *rec))
}

type databaseServerRequest struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	Database string `json:"database"`
	SSLMode  string `json:"sslMode"`
}

func (s *Server) validateDatabaseServer(w http.ResponseWriter, req *databaseServerRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(dbfactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported database engine")
		return false
	}
	if strings.TrimSpace(req.Host) == "" {
		s.err(w, http.StatusBadRequest, "a host is required")
		return false
	}
	if req.Port < 1 || req.Port > 65535 {
		s.err(w, http.StatusBadRequest, "port must be between 1 and 65535")
		return false
	}
	if strings.TrimSpace(req.Username) == "" {
		s.err(w, http.StatusBadRequest, "a username is required")
		return false
	}
	return true
}

func (s *Server) createDatabaseServer(w http.ResponseWriter, r *http.Request) {
	var req databaseServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateDatabaseServer(w, &req) {
		return
	}
	if existing, err := s.store.GetDatabaseServerByName(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a server with this name already exists")
		return
	}
	rec := &store.DatabaseServer{
		ID:       uuid.NewString(),
		Name:     req.Name,
		Type:     req.Type,
		Host:     strings.TrimSpace(req.Host),
		Port:     req.Port,
		Username: strings.TrimSpace(req.Username),
		Password: req.Password,
		Database: strings.TrimSpace(req.Database),
		SSLMode:  req.SSLMode,
	}
	driver, err := dbfactory.Build(rec)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// Reject credentials that don't work rather than storing a server
	// that can never connect.
	if err := driver.Ping(r.Context()); err != nil {
		driver.Close()
		s.log.Warn("database server rejected", "name", rec.Name, "type", rec.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateDatabaseServer(r.Context(), rec); err != nil {
		driver.Close()
		s.fail(w, err, "creating server")
		return
	}
	s.dbRegistry.Set(rec.ID, driver)
	s.json(w, http.StatusCreated, s.probeDatabaseServer(r.Context(), *rec))
}

func (s *Server) updateDatabaseServer(w http.ResponseWriter, r *http.Request) {
	rec, err := s.store.GetDatabaseServer(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "database server")
		return
	}
	var req databaseServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateDatabaseServer(w, &req) {
		return
	}
	if req.Name != rec.Name {
		if existing, err := s.store.GetDatabaseServerByName(r.Context(), req.Name); err == nil && existing != nil {
			s.err(w, http.StatusConflict, "a server with this name already exists")
			return
		}
	}
	rec.Name = req.Name
	rec.Type = req.Type
	rec.Host = strings.TrimSpace(req.Host)
	rec.Port = req.Port
	rec.Username = strings.TrimSpace(req.Username)
	rec.Database = strings.TrimSpace(req.Database)
	rec.SSLMode = req.SSLMode
	if req.Password != "" { // blank means "keep existing"
		rec.Password = req.Password
	}
	driver, err := dbfactory.Build(rec)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := driver.Ping(r.Context()); err != nil {
		driver.Close()
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateDatabaseServer(r.Context(), rec); err != nil {
		driver.Close()
		s.fail(w, err, "updating server")
		return
	}
	s.dbRegistry.Set(rec.ID, driver)
	s.json(w, http.StatusOK, s.probeDatabaseServer(r.Context(), *rec))
}

func (s *Server) deleteDatabaseServer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteDatabaseServer(r.Context(), id); err != nil {
		s.fail(w, err, "deleting server")
		return
	}
	s.dbRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// dbDriver resolves the {id} path param to a live driver.
func (s *Server) dbDriver(w http.ResponseWriter, r *http.Request) database.Driver {
	driver, ok := s.dbRegistry.Get(chi.URLParam(r, "id"))
	if !ok {
		s.err(w, http.StatusNotFound, "database server: not found")
		return nil
	}
	return driver
}

// listDatabases spans every server, stamping each database with the
// server it came from — the same pattern as catalog and node listings.
func (s *Server) listDatabases(w http.ResponseWriter, r *http.Request) {
	servers, err := s.store.ListDatabaseServers(r.Context())
	if err != nil {
		s.fail(w, err, "database servers")
		return
	}
	if only := r.URL.Query().Get("server"); only != "" {
		servers = slices.DeleteFunc(servers, func(rec store.DatabaseServer) bool { return rec.ID != only })
	}
	databases := []database.Database{}
	for _, rec := range servers {
		driver, ok := s.dbRegistry.Get(rec.ID)
		if !ok {
			continue
		}
		found, err := driver.Databases(r.Context())
		if err != nil {
			// One unreachable server shouldn't blank out the others.
			s.log.Warn("listing databases", "server", rec.Name, "error", err)
			continue
		}
		for i := range found {
			found[i].ServerID = rec.ID
		}
		databases = append(databases, found...)
	}
	s.json(w, http.StatusOK, databases)
}

func (s *Server) createDatabase(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	var req struct {
		Name  string `json:"name"`
		Owner string `json:"owner"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !identRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must start with a letter and use letters, digits, _ or -")
		return
	}
	if req.Owner != "" && !identRe.MatchString(req.Owner) {
		s.err(w, http.StatusBadRequest, "owner is not a valid role name")
		return
	}
	if err := driver.CreateDatabase(r.Context(), database.DatabaseSpec{
		Name:  req.Name,
		Owner: req.Owner,
	}); err != nil {
		s.fail(w, err, "creating database")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) dropDatabase(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	name := chi.URLParam(r, "name")
	// The engine's own databases are listed but never dropped from
	// here — losing template1 or postgres breaks the server.
	databases, err := driver.Databases(r.Context())
	if err != nil {
		s.fail(w, err, "databases")
		return
	}
	i := slices.IndexFunc(databases, func(db database.Database) bool { return db.Name == name })
	if i < 0 {
		s.err(w, http.StatusNotFound, "database: not found")
		return
	}
	if databases[i].System {
		s.err(w, http.StatusConflict, "this database belongs to the engine and can't be dropped here")
		return
	}
	if err := driver.DropDatabase(r.Context(), name); err != nil {
		s.fail(w, err, "dropping database")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listDatabaseUsers(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	users, err := driver.Users(r.Context())
	if err != nil {
		s.fail(w, err, "database users")
		return
	}
	s.json(w, http.StatusOK, users)
}

func (s *Server) createDatabaseUser(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	var req struct {
		Name     string `json:"name"`
		Host     string `json:"host"`
		Password string `json:"password"`
		CanLogin bool   `json:"canLogin"`
		CreateDB bool   `json:"createDb"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !identRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must start with a letter and use letters, digits, _ or -")
		return
	}
	if req.CanLogin && req.Password == "" {
		s.err(w, http.StatusBadRequest, "a user that can log in needs a password")
		return
	}
	if err := driver.CreateUser(r.Context(), database.UserSpec{
		Name:     req.Name,
		Host:     req.Host,
		Password: req.Password,
		CanLogin: req.CanLogin,
		CreateDB: req.CreateDB,
	}); err != nil {
		s.fail(w, err, "creating user")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) setDatabaseUserPassword(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Password == "" {
		s.err(w, http.StatusBadRequest, "a password is required")
		return
	}
	name := chi.URLParam(r, "name")
	if !identRe.MatchString(name) {
		s.err(w, http.StatusBadRequest, "not a valid user name")
		return
	}
	if err := driver.SetPassword(r.Context(), name, r.URL.Query().Get("host"), req.Password); err != nil {
		s.fail(w, err, "setting password")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) dropDatabaseUser(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	name := chi.URLParam(r, "name")
	if !identRe.MatchString(name) {
		s.err(w, http.StatusBadRequest, "not a valid user name")
		return
	}
	if err := driver.DropUser(r.Context(), name, r.URL.Query().Get("host")); err != nil {
		s.fail(w, err, "dropping user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listDatabaseConnections(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	connections, err := driver.Connections(r.Context())
	if err != nil {
		s.fail(w, err, "connections")
		return
	}
	s.json(w, http.StatusOK, connections)
}

func (s *Server) listDatabaseTables(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	name := chi.URLParam(r, "name")
	if !identRe.MatchString(name) {
		s.err(w, http.StatusBadRequest, "that isn't a valid database name")
		return
	}
	tables, err := driver.Tables(r.Context(), name)
	if err != nil {
		s.fail(w, err, "tables")
		return
	}
	s.json(w, http.StatusOK, tables)
}

func (s *Server) listDatabaseGrants(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	name := chi.URLParam(r, "name")
	if !identRe.MatchString(name) {
		s.err(w, http.StatusBadRequest, "that isn't a valid database name")
		return
	}
	grants, err := driver.Grants(r.Context(), name)
	if err != nil {
		s.fail(w, err, "grants")
		return
	}
	s.json(w, http.StatusOK, grants)
}

// accessRequest grants one user one level on one database — and
// creates that user first when asked, because "make an account for
// this app and let it in" is one job, not two pages.
type accessRequest struct {
	User string `json:"user"`
	Host string `json:"host"`
	// Level is read | readwrite | full.
	Level string `json:"level"`
	// CreateUser makes the account before granting; Password is
	// required with it.
	CreateUser bool   `json:"createUser"`
	Password   string `json:"password"`
}

func (s *Server) grantDatabaseAccess(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	dbName := chi.URLParam(r, "name")
	if !identRe.MatchString(dbName) {
		s.err(w, http.StatusBadRequest, "that isn't a valid database name")
		return
	}
	var req accessRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	req.User = strings.TrimSpace(req.User)
	if !identRe.MatchString(req.User) {
		s.err(w, http.StatusBadRequest, "that isn't a valid user name")
		return
	}
	if !database.ValidAccessLevel(database.AccessLevel(req.Level)) {
		s.err(w, http.StatusBadRequest, "pick an access level: read, readwrite or full")
		return
	}
	if req.CreateUser {
		if len(req.Password) < 8 {
			s.err(w, http.StatusBadRequest, "a new user needs a password of at least 8 characters")
			return
		}
		if err := driver.CreateUser(r.Context(), database.UserSpec{
			Name:     req.User,
			Host:     req.Host,
			Password: req.Password,
			CanLogin: true,
		}); err != nil {
			s.err(w, http.StatusBadRequest, err.Error())
			return
		}
		s.log.Info("database user created", "database", dbName, "user", req.User)
	}
	if err := driver.GrantAccess(r.Context(), database.AccessSpec{
		Database: dbName,
		User:     req.User,
		Host:     req.Host,
		Level:    database.AccessLevel(req.Level),
	}); err != nil {
		// A user created a moment ago but left without access is worse
		// than either outcome alone, so say both halves happened.
		if req.CreateUser {
			s.err(w, http.StatusBadRequest,
				"the user was created but granting access failed: "+err.Error())
			return
		}
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	s.log.Info("database access granted", "database", dbName, "user", req.User, "level", req.Level)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) revokeDatabaseAccess(w http.ResponseWriter, r *http.Request) {
	driver := s.dbDriver(w, r)
	if driver == nil {
		return
	}
	dbName := chi.URLParam(r, "name")
	user := r.URL.Query().Get("user")
	if !identRe.MatchString(dbName) || !identRe.MatchString(user) {
		s.err(w, http.StatusBadRequest, "that isn't a valid database or user name")
		return
	}
	if err := driver.RevokeAccess(r.Context(), dbName, user, r.URL.Query().Get("host")); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	s.log.Info("database access revoked", "database", dbName, "user", user)
	w.WriteHeader(http.StatusNoContent)
}
