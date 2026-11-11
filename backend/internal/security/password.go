package security

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// Argon2id parameters for new hashes: OWASP's m=19 MiB, t=2, p=1 profile.
// It is as strong as the earlier m=64 MiB, t=1, p=4 but needs about a third of
// the memory, which matters on small (0.5 GB) servers. Existing hashes keep
// verifying with the parameters stored in them, and are re-hashed with these
// on the next successful login (see NeedsUpgrade).
const (
	argon2Time    = 2
	argon2Memory  = 19 * 1024 // KiB
	argon2Threads = 1
	argon2KeyLen  = 32
	argon2SaltLen = 16
)

// Each argon2id computation allocates its full memory parameter at once.
// Capping how many run concurrently bounds peak memory under bursts of
// logins or registrations.
var argon2Slots = make(chan struct{}, 2)

func argon2IDKey(password, salt []byte, time, memory uint32, threads uint8, keyLen uint32) []byte {
	argon2Slots <- struct{}{}
	defer func() { <-argon2Slots }()
	return argon2.IDKey(password, salt, time, memory, threads, keyLen)
}

type PasswordHasher struct {
	bcryptCost int
}

func NewPasswordHasher(cost int) *PasswordHasher {
	if cost == 0 {
		cost = bcrypt.DefaultCost
	}
	return &PasswordHasher{bcryptCost: cost}
}

func (h *PasswordHasher) Hash(plain string) (string, error) {
	salt := make([]byte, argon2SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	key := argon2IDKey([]byte(plain), salt, argon2Time, argon2Memory, argon2Threads, argon2KeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argon2Memory, argon2Time, argon2Threads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func (h *PasswordHasher) Verify(plain, hashed string) error {
	if strings.HasPrefix(hashed, "$argon2id$") {
		return h.verifyArgon2id(plain, hashed)
	}
	return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(plain))
}

// NeedsUpgrade reports whether a stored hash should be replaced: legacy
// (non-argon2id) hashes, and argon2id hashes made with other parameters.
func (h *PasswordHasher) NeedsUpgrade(hashed string) bool {
	if !strings.HasPrefix(hashed, "$argon2id$") {
		return true
	}
	parts, memory, time, threads, err := parseArgon2id(hashed)
	if err != nil || len(parts) != 6 {
		return true
	}
	return memory != argon2Memory || time != argon2Time || threads != argon2Threads
}

// parseArgon2id splits "$argon2id$v=N$m=N,t=N,p=N$<salt>$<key>" and parses
// its version and cost parameters.
func parseArgon2id(hashed string) (parts []string, memory, time uint32, threads uint8, err error) {
	parts = strings.Split(hashed, "$")
	// expected: ["", "argon2id", "v=N", "m=N,t=N,p=N", "<salt>", "<key>"]
	if len(parts) != 6 {
		return nil, 0, 0, 0, fmt.Errorf("invalid argon2id hash format")
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return nil, 0, 0, 0, fmt.Errorf("parse argon2id version: %w", err)
	}
	if version != argon2.Version {
		return nil, 0, 0, 0, fmt.Errorf("unsupported argon2id version: %d", version)
	}

	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return nil, 0, 0, 0, fmt.Errorf("parse argon2id params: %w", err)
	}
	return parts, memory, time, threads, nil
}

func (h *PasswordHasher) verifyArgon2id(plain, hashed string) error {
	parts, memory, time, threads, err := parseArgon2id(hashed)
	if err != nil {
		return err
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return fmt.Errorf("decode argon2id salt: %w", err)
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return fmt.Errorf("decode argon2id key: %w", err)
	}
	if len(key) != argon2KeyLen {
		return fmt.Errorf("unexpected argon2id key length: %d", len(key))
	}

	candidate := argon2IDKey([]byte(plain), salt, time, memory, threads, argon2KeyLen)
	if subtle.ConstantTimeCompare(candidate, key) != 1 {
		return fmt.Errorf("password mismatch")
	}
	return nil
}
