package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/raphaelrong/on-that-day/internal/service"
)

// Handler holds HTTP handlers for the API and static site.
type Handler struct {
	svc     *service.Service
	siteDir string
}

// New creates a new Handler that serves static files from siteDir.
func New(svc *service.Service, siteDir string) *Handler {
	return &Handler{svc: svc, siteDir: siteDir}
}

// RegisterRoutes registers all routes on the provided mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	// Original frontend data paths (so the static site works unchanged).
	mux.HandleFunc("/data/authors.json", h.Authors)
	mux.HandleFunc("/data/days/", h.DayByFile)

	// API paths.
	mux.HandleFunc("/healthz", h.Healthz)
	mux.HandleFunc("/api/authors", h.Authors)
	mux.HandleFunc("/api/days/", h.Day)
	mux.HandleFunc("/api/voyage/", h.Voyage)

	// Static files (index.html, app.js, style.css, cover images, etc.).
	if h.siteDir != "" {
		if _, err := os.Stat(h.siteDir); err == nil {
			fs := http.FileServer(http.Dir(h.siteDir))
			mux.Handle("/", fs)
		}
	}
}

// Healthz returns a simple health check.
func (h *Handler) Healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Authors serves the authors list.
func (h *Handler) Authors(w http.ResponseWriter, r *http.Request) {
	authors, err := h.svc.ListAuthors(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, authors)
}

// Day serves a single day shard via /api/days/MM-DD or /api/days/MM/DD.
func (h *Handler) Day(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/days/")
	h.serveDay(w, r, path)
}

// DayByFile serves a single day shard via the original /data/days/MM-DD.json path.
func (h *Handler) DayByFile(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/data/days/")
	path = strings.TrimSuffix(path, ".json")
	h.serveDay(w, r, path)
}

// Voyage serves the full chronological route for a voyage author.
func (h *Handler) Voyage(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, "/api/voyage/")
	if key == "" {
		writeError(w, http.StatusBadRequest, "missing voyage key")
		return
	}
	resp, err := h.svc.GetVoyage(r.Context(), key)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) serveDay(w http.ResponseWriter, r *http.Request, path string) {
	parts := strings.Split(path, "/")

	var monthStr, dayStr string
	switch len(parts) {
	case 1:
		md := strings.Split(parts[0], "-")
		if len(md) != 2 {
			writeError(w, http.StatusBadRequest, "invalid date, expected MM-DD")
			return
		}
		monthStr, dayStr = md[0], md[1]
	case 2:
		monthStr, dayStr = parts[0], parts[1]
	default:
		writeError(w, http.StatusBadRequest, "invalid date")
		return
	}

	month, err := strconv.Atoi(monthStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid month")
		return
	}
	day, err := strconv.Atoi(dayStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid day")
		return
	}

	resp, err := h.svc.GetDay(r.Context(), month, day)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// SiteDir returns the configured static site directory.
func (h *Handler) SiteDir() string {
	return h.siteDir
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, err any) {
	msg := "error"
	switch v := err.(type) {
	case string:
		msg = v
	case error:
		msg = v.Error()
	}
	writeJSON(w, status, map[string]string{"error": msg})
}
