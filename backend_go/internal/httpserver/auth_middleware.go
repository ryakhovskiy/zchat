package httpserver

import (
	"context"
	"log"
	"net/http"
	"strings"

	"backend_go/internal/domain"
	"backend_go/internal/security"
)

type contextKey string

const userContextKey contextKey = "currentUser"

// WithUser returns a new context carrying the current user.
func WithUser(ctx context.Context, user *domain.User) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

// CurrentUser extracts the current user from context, if any.
func CurrentUser(r *http.Request) *domain.User {
	if v := r.Context().Value(userContextKey); v != nil {
		if u, ok := v.(*domain.User); ok {
			return u
		}
	}
	return nil
}

// AuthMiddleware validates the Bearer token and attaches the user to the context.
func AuthMiddleware(tokens *security.TokenService, users domain.UserRepository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
				http.Error(w, "missing or invalid Authorization header", http.StatusUnauthorized)
				return
			}
			tokenStr := strings.TrimSpace(authHeader[len("Bearer "):])

			claims, err := tokens.Parse(tokenStr)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			sub, _ := claims["sub"].(string)
			if sub == "" {
				http.Error(w, "invalid token subject", http.StatusUnauthorized)
				return
			}

			user, err := users.GetByUsername(r.Context(), sub)
			if err != nil {
				log.Printf("AuthMiddleware: GetByUsername error for sub '%s': %v", sub, err)
				http.Error(w, "user not found", http.StatusUnauthorized)
				return
			}
			if user == nil {
				log.Printf("AuthMiddleware: user nil for sub '%s'", sub)
				http.Error(w, "user not found", http.StatusUnauthorized)
				return
			}
			if !user.IsActive {
				log.Printf("AuthMiddleware: user inactive for sub '%s'", sub)
				http.Error(w, "user not found", http.StatusUnauthorized)
				return
			}

			ctx := WithUser(r.Context(), user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
