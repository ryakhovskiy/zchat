package security

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenService wraps JWT creation and validation.
type TokenService struct {
	secret    []byte
	expiresIn time.Duration
}

func NewTokenService(secret string, expiresIn time.Duration) *TokenService {
	return &TokenService{
		secret:    []byte(secret),
		expiresIn: expiresIn,
	}
}

// CreateForUser creates a JWT for the given username using the default TTL.
func (t *TokenService) CreateForUser(username string) (string, error) {
	return t.CreateWithTTL(username, t.expiresIn)
}

// CreateWithTTL creates a JWT for the given username with an explicit TTL.
func (t *TokenService) CreateWithTTL(username string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub": username,
		"iat": now.Unix(),
		"exp": now.Add(ttl).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(t.secret)
}

// Parse validates a token and returns its claims.
func (t *TokenService) Parse(tokenStr string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return t.secret, nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, jwt.ErrSignatureInvalid
	}
	if claims, ok := token.Claims.(jwt.MapClaims); ok {
		return claims, nil
	}
	return nil, jwt.ErrTokenMalformed
}
