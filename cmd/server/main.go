package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/raphaelrong/on-that-day/internal/config"
	"github.com/raphaelrong/on-that-day/internal/db"
	"github.com/raphaelrong/on-that-day/internal/handler"
	"github.com/raphaelrong/on-that-day/internal/repository"
	"github.com/raphaelrong/on-that-day/internal/service"
)

func main() {
	cfg := config.MustLoad()
	debug := os.Getenv("DEBUG") == "true"

	database := db.MustNew(cfg.DSN, debug)
	if err := db.Ping(database); err != nil {
		log.Fatalf("database ping failed: %v", err)
	}

	repo := repository.New(database)
	if err := repo.Migrate(context.Background()); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}

	svc := service.New(repo)
	h := handler.New(svc, cfg.SiteDir)

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	log.Printf("server listening on %s", cfg.ServerAddr)
	if err := http.ListenAndServe(cfg.ServerAddr, corsMiddleware(mux)); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}

// corsMiddleware adds permissive CORS headers for local React/Vite dev servers.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
