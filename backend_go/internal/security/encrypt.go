package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/fernet/fernet-go"
)

// Encryptor provides symmetric encryption for message content.
// It uses AES-GCM with a 32-byte key, roughly mirroring the security
// guarantees of the Python Fernet-based implementation.
type Encryptor struct {
	aead       cipher.AEAD
	fernetKeys []*fernet.Key
}

func NewEncryptor(key []byte, legacyKeys []string) (*Encryptor, error) {
	// Derive a fixed-size 32-byte key from the provided bytes using SHA-256.
	// This allows using arbitrary-length secrets (e.g. from existing .env files)
	// while ensuring AES-256 compatibility.
	if len(key) == 0 {
		return nil, errors.New("encryption key must not be empty")
	}
	sum := sha256.Sum256(key)
	k := sum[:]
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	fernetKeys := make([]*fernet.Key, 0, len(legacyKeys)+1)
	if fk := parseFernetKey(string(key)); fk != nil {
		fernetKeys = append(fernetKeys, fk)
	}
	for _, rawKey := range legacyKeys {
		if fk := parseFernetKey(rawKey); fk != nil {
			fernetKeys = append(fernetKeys, fk)
		}
	}

	return &Encryptor{aead: aead, fernetKeys: fernetKeys}, nil
}

func parseFernetKey(raw string) *fernet.Key {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	key, err := fernet.DecodeKey(trimmed)
	if err != nil {
		return nil
	}
	return key
}

func (e *Encryptor) Encrypt(plain string) (string, error) {
	nonce := make([]byte, e.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := e.aead.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (e *Encryptor) Decrypt(enc string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err == nil {
		if len(raw) < e.aead.NonceSize() {
			return "", errors.New("ciphertext too short")
		}
		nonce := raw[:e.aead.NonceSize()]
		ciphertext := raw[e.aead.NonceSize():]
		plain, openErr := e.aead.Open(nil, nonce, ciphertext, nil)
		if openErr == nil {
			return string(plain), nil
		}
	}

	if len(e.fernetKeys) > 0 {
		if plain := fernet.VerifyAndDecrypt([]byte(enc), 0*time.Second, e.fernetKeys); plain != nil {
			return string(plain), nil
		}
	}

	return "", errors.New("failed to decrypt message payload")
}
