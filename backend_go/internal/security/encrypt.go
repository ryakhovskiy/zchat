package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

// Encryptor provides symmetric encryption for message content.
// It uses AES-GCM with a 32-byte key, roughly mirroring the security
// guarantees of the Python Fernet-based implementation.
type Encryptor struct {
	aead cipher.AEAD
}

func NewEncryptor(key []byte) (*Encryptor, error) {
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
	return &Encryptor{aead: aead}, nil
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
	if err != nil {
		return "", err
	}
	if len(raw) < e.aead.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce := raw[:e.aead.NonceSize()]
	ciphertext := raw[e.aead.NonceSize():]
	plain, err := e.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

