package api

import (
	"encoding/json"
	"encoding/pem"
	"net/http"
	"strings"

	"golang.org/x/crypto/ssh"
)

// Your SSH identity, managed from My account.
//
// The private half is write-only in every direction: the console will
// take one you already have, and will make you one, but it will never
// show you one back. A key a web app can display is a key a stolen
// session can walk off with.

type sshKeyResponse struct {
	PublicKey string `json:"publicKey"`
	// Imported is true when you brought this key rather than letting the
	// console generate it — worth saying, because rotating replaces it.
	Imported bool `json:"imported"`
	// Fingerprint is what you compare against `ssh-keygen -lf`.
	Fingerprint string `json:"fingerprint"`
}

// mySSHKey returns the signed-in account's public key, minting one on
// first ask so this page is never empty.
func (s *Server) mySSHKey(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	if _, _, err := s.userSigner(r.Context(), me); err != nil {
		s.fail(w, err, "your ssh key")
		return
	}
	s.json(w, http.StatusOK, describeKey(me.SSHPublicKey, me.SSHKeyImported))
}

// rotateMySSHKey throws the old pair away and mints a new one. Guests
// still holding the old key stop letting you in until the provisioner
// replaces it on the next connect — which it does, because the line is
// tagged with your account.
func (s *Server) rotateMySSHKey(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	private, public, err := generateUserKey(me.Email)
	if err != nil {
		s.fail(w, err, "generating a key")
		return
	}
	if err := s.store.SetUserSSHKey(r.Context(), me.ID, private, public, false); err != nil {
		s.fail(w, err, "saving your key")
		return
	}
	s.log.Info("ssh key rotated", "email", me.Email)
	s.json(w, http.StatusOK, describeKey(public, false))
}

// importMySSHKey takes a private key you already use, so the console
// signs in as you with the identity your guests already trust instead
// of needing a second one deployed everywhere.
func (s *Server) importMySSHKey(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r.Context())
	var req struct {
		PrivateKey string `json:"privateKey"`
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.PrivateKey = strings.TrimSpace(req.PrivateKey) + "\n"

	// Parse to the raw key rather than a Signer: a Signer can't be
	// marshalled back out, and an encrypted key has to be stored
	// decrypted to be usable unattended.
	var raw any
	var err error
	if req.Passphrase != "" {
		raw, err = ssh.ParseRawPrivateKeyWithPassphrase(
			[]byte(req.PrivateKey), []byte(req.Passphrase))
	} else {
		raw, err = ssh.ParseRawPrivateKey([]byte(req.PrivateKey))
	}
	if err != nil {
		// Name the two common cases rather than echoing x509's phrasing.
		switch {
		case strings.Contains(err.Error(), "passphrase"):
			s.err(w, http.StatusBadRequest,
				"this key is encrypted — enter its passphrase, or decrypt it first")
			return
		case strings.Contains(err.Error(), "decryption password incorrect"):
			s.err(w, http.StatusBadRequest, "that passphrase doesn't decrypt this key")
			return
		}
		s.err(w, http.StatusBadRequest, "that isn't a private key the console can read: "+err.Error())
		return
	}
	signer, err := ssh.NewSignerFromKey(raw)
	if err != nil {
		s.err(w, http.StatusBadRequest, "the console can't use a key of that type: "+err.Error())
		return
	}

	// Stored decrypted: the console has to be able to use it unattended,
	// and holding a passphrase beside the key it unlocks protects
	// nothing. Anyone who can read the database can sign in as you —
	// equally true of the generated keys.
	stored := req.PrivateKey
	if req.Passphrase != "" {
		block, marshalErr := ssh.MarshalPrivateKey(raw, keyComment(me.Email))
		if marshalErr != nil {
			s.err(w, http.StatusBadRequest,
				"the console can't store a key of that type: "+marshalErr.Error())
			return
		}
		stored = string(pem.EncodeToMemory(block))
	}
	public := authorizedKey(signer.PublicKey(), me.Email)
	if err := s.store.SetUserSSHKey(r.Context(), me.ID, stored, public, true); err != nil {
		s.fail(w, err, "saving your key")
		return
	}
	s.log.Info("ssh key imported", "email", me.Email, "type", signer.PublicKey().Type())
	s.json(w, http.StatusOK, describeKey(public, true))
}

func describeKey(publicKey string, imported bool) sshKeyResponse {
	res := sshKeyResponse{PublicKey: publicKey, Imported: imported}
	if pub, _, _, _, err := ssh.ParseAuthorizedKey([]byte(publicKey)); err == nil {
		res.Fingerprint = ssh.FingerprintSHA256(pub)
	}
	return res
}
