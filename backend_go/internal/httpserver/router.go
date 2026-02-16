package httpserver

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"backend_go/internal/config"
	"backend_go/internal/security"
	"backend_go/internal/service"
	"backend_go/internal/store/sqlite"
	"backend_go/internal/ws"

	_ "backend_go/docs"
	httpSwagger "github.com/swaggo/http-swagger"
)

// NewRouter constructs the main HTTP router and wires routes, services, and middleware.
func NewRouter(cfg *config.Config, db *sql.DB, hub *ws.Hub, tokenSvc *security.TokenService, passwordHasher *security.PasswordHasher, encryptor *security.Encryptor) http.Handler {
	r := chi.NewRouter()

	// Middlewares
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Repositories
	userRepo := sqlite.NewUserRepo(db)
	convRepo := sqlite.NewConversationRepo(db)
	msgRepo := sqlite.NewMessageRepo(db)
	partRepo := sqlite.NewParticipantRepo(db)

	// Services
	authSvc := service.NewAuthService(userRepo, tokenSvc, passwordHasher)
	userSvc := service.NewUserService(userRepo)
	convSvc := service.NewConversationService(convRepo, partRepo, msgRepo)
	msgSvc := service.NewMessageService(convRepo, partRepo, msgRepo, userRepo, encryptor, cfg.MaxMessagesPerConversation)

	// Simple health endpoints for now
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"zChat Go Application API","version":"1.0.0","docs":"/docs"}`))
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"healthy"}`))
	})

	// Swagger documentation
	r.Get("/docs/*", httpSwagger.Handler(
		httpSwagger.URL("/docs/doc.json"), //The url pointing to API definition
	))

	// API routes
	r.Route("/api", func(r chi.Router) {
		// Auth routes (no auth required)
		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", handleRegister(authSvc, userSvc))
			r.Post("/login", handleLogin(authSvc))
		})

		// Authenticated routes
		r.Group(func(r chi.Router) {
			r.Use(AuthMiddleware(tokenSvc, userRepo))

			// Authenticated auth endpoints
			r.Post("/auth/logout", handleLogout(authSvc))
			r.Get("/auth/me", handleMe())

			// Users
			r.Route("/users", func(r chi.Router) {
				r.Get("/", handleListUsers(userSvc))
				r.Get("/online", handleListOnlineUsers(userSvc))
				r.Get("/{userID}", handleGetUser(userSvc))
			})

			// Conversations and messages
			r.Route("/conversations", func(r chi.Router) {
				r.Post("/", handleCreateConversation(convSvc))
				r.Get("/", handleListConversations(convSvc))
				r.Get("/{conversationID}", handleGetConversation(convSvc))
				r.Post("/{conversationID}/read", handleMarkConversationRead(convSvc))
				r.Get("/{conversationID}/messages", handleListMessages(msgSvc))
				r.Post("/{conversationID}/messages", handleCreateMessage(msgSvc))
			})

			// Uploads (implementation in separate file)
			r.Mount("/uploads", UploadRoutes(cfg))
		})
	})

	// WebSocket endpoint
	r.Get("/ws", ws.MakeHandler(hub, tokenSvc, userRepo, convRepo, msgSvc, encryptor))

	return r
}

// writeJSON is a small helper to send JSON responses.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}


