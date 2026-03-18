package httpserver

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"backend/internal/config"
	"backend/internal/security"
	"backend/internal/service"
	"backend/internal/store/postgres"
	"backend/internal/ws"

	_ "backend/docs"

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
	userRepo := postgres.NewUserRepo(db)
	convRepo := postgres.NewConversationRepo(db)
	msgRepo := postgres.NewMessageRepo(db)
	partRepo := postgres.NewParticipantRepo(db)
	deletedMsgRepo := postgres.NewUserDeletedMessageRepo(db)
	pushSubRepo := postgres.NewPushSubscriptionRepo(db)

	// Services
	defaultTTL := time.Duration(cfg.AccessTokenMinutes) * time.Minute
	rememberMeTTL := time.Duration(cfg.RememberMeDays) * 24 * time.Hour

	authSvc := service.NewAuthService(userRepo, tokenSvc, passwordHasher, defaultTTL, rememberMeTTL)
	userSvc := service.NewUserService(userRepo)
	convSvc := service.NewConversationService(convRepo, partRepo, msgRepo)
	msgSvc := service.NewMessageService(convRepo, partRepo, msgRepo, deletedMsgRepo, userRepo, encryptor, cfg.MaxMessagesPerConversation, cfg.UploadDir)
	// wire circular reference
	convSvc.SetMessageService(msgSvc)

	// Push notification service (optional — disabled if VAPID keys are not configured)
	var pushSvc *service.PushService
	if cfg.VAPIDPublicKey != "" && cfg.VAPIDPrivateKey != "" {
		pushSvc = service.NewPushService(pushSubRepo, cfg.VAPIDPrivateKey, cfg.VAPIDPublicKey)
	}

	// Static endpoints
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

	r.Get("/robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("User-agent: *\nDisallow: /"))
	})

	// Swagger documentation
	r.Get("/docs/*", httpSwagger.Handler(
		httpSwagger.URL("/docs/doc.json"),
	))

	// Static app downloads (APK, etc.)
	r.Handle("/app/*", http.StripPrefix("/app/", http.FileServer(http.Dir("app"))))

	// API routes
	r.Route("/api", func(r chi.Router) {
		// Auth routes (no auth required)
		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", handleRegister(authSvc, userSvc))
			r.Post("/login", handleLogin(authSvc))
		})

		// Public VAPID key endpoint (no auth required)
		r.Get("/push/vapid-key", handleVAPIDKey(cfg.VAPIDPublicKey))

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

			// Message edit / delete
			r.Route("/messages", func(r chi.Router) {
				r.Put("/{messageID}", handleEditMessage(msgSvc))
				r.Delete("/{messageID}", handleDeleteMessage(msgSvc))
			})

			// Push notification subscription management
			r.Post("/push/subscribe", handlePushSubscribe(pushSubRepo))
			r.Delete("/push/unsubscribe", handlePushUnsubscribe(pushSubRepo))

		})

		// Moved outside of AuthMiddleware group to allow download via ?token= query param
		r.Mount("/uploads", UploadRoutes(cfg, db, tokenSvc))
	})

	// WebSocket endpoint
	pingInterval := time.Duration(cfg.WSPingIntervalSec) * time.Second
	pongTimeout := time.Duration(cfg.WSPongTimeoutSec) * time.Second
	r.Get("/ws", ws.MakeHandler(hub, tokenSvc, userRepo, convRepo, msgSvc, encryptor, pushSvc, cfg.CORSOrigins, pingInterval, pongTimeout))

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
