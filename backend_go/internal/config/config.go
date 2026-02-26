package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AppName     string
	Env         string
	Host        string
	Port        int
	DatabaseURL string

	JWTSecret          string
	AccessTokenMinutes int
	RememberMeDays     int
	EncryptKey         string

	UploadDir                  string
	CORSOrigins                []string
	Debug                      bool
	MaxMessagesPerConversation int
}

func Load() (*Config, error) {
	dbHost := getEnv("POSTGRES_HOST", "localhost")
	dbPort := getEnv("POSTGRES_PORT", "5432")
	dbUser := getEnv("POSTGRES_USER", "postgres")
	dbPass := getEnv("POSTGRES_PASSWORD", "postgres")
	dbName := getEnv("POSTGRES_DB", "zchat")

	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(dbUser, dbPass),
		Host:     fmt.Sprintf("%s:%s", dbHost, dbPort),
		Path:     dbName,
		RawQuery: "sslmode=disable",
	}
	dbURL := u.String()

	cfg := &Config{
		AppName:     getEnv("APP_NAME", "zChat Go API"),
		Env:         getEnv("APP_ENV", "development"),
		Host:        getEnv("HTTP_HOST", "0.0.0.0"),
		Port:        getEnvAsInt("HTTP_PORT", 8000),
		DatabaseURL: dbURL,

		JWTSecret:          os.Getenv("JWT_SECRET"),
		AccessTokenMinutes: getEnvAsInt("ACCESS_TOKEN_EXPIRE_MINUTES", 60*24),
		RememberMeDays:     getEnvAsInt("REMEMBER_ME_TOKEN_EXPIRE_DAYS", 30),
		EncryptKey:         os.Getenv("ENCRYPTION_KEY"),

		UploadDir:                  getEnv("UPLOAD_DIR", "uploads"),
		Debug:                      getEnvAsBool("DEBUG", true),
		MaxMessagesPerConversation: getEnvAsInt("MAX_MESSAGES_PER_CONVERSATION", 1000),
	}

	cors := getEnv("CORS_ORIGINS", "")
	if cors != "" {
		parts := strings.Split(cors, ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		cfg.CORSOrigins = parts
	} else {
		cfg.CORSOrigins = []string{"http://localhost:3000", "http://localhost:5173"}
	}

	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	if cfg.EncryptKey == "" {
		return nil, fmt.Errorf("ENCRYPTION_KEY is required")
	}

	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating upload dir: %w", err)
	}

	return cfg, nil
}

func (c *Config) HTTPAddr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvAsInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}

func getEnvAsBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
