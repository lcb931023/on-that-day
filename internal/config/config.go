package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/joho/godotenv"
)

// Config holds all runtime configuration for the application.
type Config struct {
	DSN        string
	ServerAddr string
	DataDir    string // used by dbsync
	SiteDir    string // used by server to serve static files
}

// Load returns a Config populated from environment variables.
// It automatically loads a .env file from the working directory if present.
func Load() (*Config, error) {
	// Try to load .env from the current working directory; ignore if missing.
	if wd, err := os.Getwd(); err == nil {
		_ = godotenv.Load(filepath.Join(wd, ".env"))
	}

	dsn := os.Getenv("SQLITE_DSN")
	if dsn == "" {
		// Default to a file in the project root.
		dsn = "on-that-day.db"
	}

	addr := os.Getenv("SERVER_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "../on-that-day/site/data"
	}

	siteDir := os.Getenv("SITE_DIR")
	if siteDir == "" {
		siteDir = "frontend/dist"
	}

	return &Config{
		DSN:        dsn,
		ServerAddr: addr,
		DataDir:    dataDir,
		SiteDir:    siteDir,
	}, nil
}

// MustLoad is like Load but panics on error.
func MustLoad() *Config {
	cfg, err := Load()
	if err != nil {
		panic(fmt.Sprintf("failed to load config: %v", err))
	}
	return cfg
}

// AsBool parses an environment variable as a bool, defaulting to the given value.
func AsBool(key string, def bool) bool {
	s := os.Getenv(key)
	if s == "" {
		return def
	}
	v, err := strconv.ParseBool(s)
	if err != nil {
		return def
	}
	return v
}
