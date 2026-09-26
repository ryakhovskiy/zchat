package security

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"runtime"
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

// argon2Sem bounds how many argon2id derivations may run at once.
//
// Each derivation allocates argon2Memory (64 MiB). /api/auth/login and
// /api/auth/register are unauthenticated, so without a ceiling an attacker can
// multiply that by the request rate and OOM the process. Capping concurrency
// converts an unbounded memory spike into a bounded queue: peak usage is
// cap(argon2Sem) * 64 MiB regardless of how much traffic arrives.
//
// Sized from GOMAXPROCS because argon2 is CPU-bound — running more derivations
// than we have cores buys no throughput, only memory.
var argon2Sem = make(chan struct{}, max(2, runtime.GOMAXPROCS(0)))

// withArgon2Slot runs fn while holding a slot in argon2Sem. It blocks until a
// slot frees up; queued goroutines cost ~KB each, versus 64 MiB if they ran.
func withArgon2Slot[T any](fn func() T) T {
	argon2Sem <- struct{}{}
	defer func() { <-argon2Sem }()
	return fn()
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
	key := withArgon2Slot(func() []byte {
		return argon2.IDKey([]byte(plain), salt, argon2Time, argon2Memory, argon2Threads, argon2KeyLen)
	})
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
	if len(key) != argon2KeyLen {
		return fmt.Errorf("unexpected argon2id key length: %d", len(key))
	}

	candidate := withArgon2Slot(func() []byte {
		return argon2.IDKey([]byte(plain), salt, time, memory, threads, argon2KeyLen)
	})
	if subtle.ConstantTimeCompare(candidate, key) != 1 {
		return fmt.Errorf("password mismatch")
	}
	return nil
}
