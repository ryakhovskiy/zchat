package security_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"backend/internal/security"
)

func newHasher() *security.PasswordHasher {
	return security.NewPasswordHasher(bcrypt.MinCost) // fastest cost for tests
}

// ── Hash ─────────────────────────────────────────────────────────────────────

func TestHash_ProducesArgon2id(t *testing.T) {
	h := newHasher()
	hash, err := h.Hash("Password1!")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(hash, "$argon2id$"), "expected argon2id prefix, got: %s", hash)
}

func TestHash_DifferentSaltsEachCall(t *testing.T) {
	h := newHasher()
	hash1, err := h.Hash("Password1!")
	require.NoError(t, err)
	hash2, err := h.Hash("Password1!")
	require.NoError(t, err)
	assert.NotEqual(t, hash1, hash2, "two hashes of the same password should differ due to random salt")
}

// ── Verify — argon2id hashes ──────────────────────────────────────────────────

func TestVerify_Argon2id_CorrectPassword(t *testing.T) {
	h := newHasher()
	hash, err := h.Hash("CorrectPassword1!")
	require.NoError(t, err)
	assert.NoError(t, h.Verify("CorrectPassword1!", hash))
}

func TestVerify_Argon2id_WrongPassword(t *testing.T) {
	h := newHasher()
	hash, err := h.Hash("CorrectPassword1!")
	require.NoError(t, err)
	assert.Error(t, h.Verify("WrongPassword1!", hash))
}

func TestVerify_Argon2id_EmptyPassword(t *testing.T) {
	h := newHasher()
	hash, err := h.Hash("CorrectPassword1!")
	require.NoError(t, err)
	assert.Error(t, h.Verify("", hash))
}

// ── Verify — legacy bcrypt hashes ────────────────────────────────────────────

func bcryptHash(t *testing.T, plain string) string {
	t.Helper()
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.MinCost)
	require.NoError(t, err)
	return string(b)
}

func TestVerify_Bcrypt_CorrectPassword(t *testing.T) {
	h := newHasher()
	hash := bcryptHash(t, "LegacyPassword1!")
	assert.NoError(t, h.Verify("LegacyPassword1!", hash))
}

func TestVerify_Bcrypt_WrongPassword(t *testing.T) {
	h := newHasher()
	hash := bcryptHash(t, "LegacyPassword1!")
	assert.Error(t, h.Verify("WrongPassword1!", hash))
}

func TestVerify_Bcrypt_EmptyPassword(t *testing.T) {
	h := newHasher()
	hash := bcryptHash(t, "LegacyPassword1!")
	assert.Error(t, h.Verify("", hash))
}

// ── NeedsUpgrade ─────────────────────────────────────────────────────────────

func TestNeedsUpgrade_BcryptHash_ReturnsTrue(t *testing.T) {
	h := newHasher()
	hash := bcryptHash(t, "LegacyPassword1!")
	assert.True(t, h.NeedsUpgrade(hash))
}

func TestNeedsUpgrade_Argon2idHash_ReturnsFalse(t *testing.T) {
	h := newHasher()
	hash, err := h.Hash("Password1!")
	require.NoError(t, err)
	assert.False(t, h.NeedsUpgrade(hash))
}

func TestNeedsUpgrade_UnknownPrefix_ReturnsTrue(t *testing.T) {
	h := newHasher()
	assert.True(t, h.NeedsUpgrade("$unknown$somegibberish"))
}

func TestNeedsUpgrade_EmptyString_ReturnsTrue(t *testing.T) {
	h := newHasher()
	assert.True(t, h.NeedsUpgrade(""))
}

// ── Round-trip: bcrypt hash verified, then re-hashed to argon2id ─────────────

func TestMigrationRoundTrip(t *testing.T) {
	h := newHasher()
	password := "MigrateMe1!"

	// Simulate a stored bcrypt hash (legacy)
	oldHash := bcryptHash(t, password)
	assert.True(t, h.NeedsUpgrade(oldHash), "bcrypt hash should need upgrade")

	// Verify still works against the old hash
	require.NoError(t, h.Verify(password, oldHash), "bcrypt hash should still verify correctly")

	// Upgrade to argon2id
	newHash, err := h.Hash(password)
	require.NoError(t, err)
	assert.False(t, h.NeedsUpgrade(newHash), "argon2id hash should not need upgrade")

	// New hash also verifies correctly
	assert.NoError(t, h.Verify(password, newHash))

	// Wrong password fails against new hash
	assert.Error(t, h.Verify("WrongPassword1!", newHash))
}
