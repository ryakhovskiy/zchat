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

const (
	argon2Time    = 1
	argon2Memory  = 64 * 1024
	argon2Threads = 4
	argon2KeyLen  = 32
	argon2SaltLen = 16
)

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
	key := argon2.IDKey([]byte(plain), salt, argon2Time, argon2Memory, argon2Threads, argon2KeyLen)
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

func (h *PasswordHasher) NeedsUpgrade(hashed string) bool {
	return !strings.HasPrefix(hashed, "$argon2id$")
}

func (h *PasswordHasher) verifyArgon2id(plain, hashed string) error {
	parts := strings.Split(hashed, "$")
	// expected: ["", "argon2id", "v=N", "m=N,t=N,p=N", "<salt>", "<key>"]
	if len(parts) != 6 {
		return fmt.Errorf("invalid argon2id hash format")
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return fmt.Errorf("parse argon2id version: %w", err)
	}
	if version != argon2.Version {
		return fmt.Errorf("unsupported argon2id version: %d", version)
	}

	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return fmt.Errorf("parse argon2id params: %w", err)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return fmt.Errorf("decode argon2id salt: %w", err)
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return fmt.Errorf("decode argon2id key: %w", err)
	}

	candidate := argon2.IDKey([]byte(plain), salt, time, memory, threads, uint32(len(key)))
	if subtle.ConstantTimeCompare(candidate, key) != 1 {
		return fmt.Errorf("password mismatch")
	}
	return nil
}
