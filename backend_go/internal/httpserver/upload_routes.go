package httpserver

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"backend_go/internal/config"
)

// UploadRoutes returns a sub-router mounted at /api/uploads.
// For now this is a minimal implementation:
// - POST /         -> 501 Not Implemented
// - GET /{filename} -> serves static files from cfg.UploadDir
func UploadRoutes(cfg *config.Config) chi.Router {
	r := chi.NewRouter()

	// Placeholder upload endpoint – can be extended to enforce size/type limits.
	r.Post("/", func(w http.ResponseWriter, r *http.Request) {
		// Expect a multipart/form-data request with file field named "file"
		if err := r.ParseMultipartForm(50 << 20); err != nil { // 50MB limit
			http.Error(w, "failed to parse multipart form", http.StatusBadRequest)
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "missing file", http.StatusBadRequest)
			return
		}
		defer file.Close()

		ext := filepath.Ext(header.Filename)
		if ext == "" {
			http.Error(w, "file must have an extension", http.StatusBadRequest)
			return
		}

		filename := strconv.FormatInt(time.Now().UnixNano(), 10) + ext
		destPath := filepath.Join(cfg.UploadDir, filename)

		out, err := os.Create(destPath)
		if err != nil {
			http.Error(w, "could not create file", http.StatusInternalServerError)
			return
		}
		defer out.Close()

		if _, err := io.Copy(out, file); err != nil {
			http.Error(w, "could not save file", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"file_path": destPath,
			"file_type": "file",
			"filename":  filename,
		})
	})

	// Simple file serving endpoint compatible with existing URLs: /api/uploads/{filename}
	r.Get("/{filename}", func(w http.ResponseWriter, r *http.Request) {
		filename := chi.URLParam(r, "filename")
		if filename == "" {
			http.Error(w, "missing filename", http.StatusBadRequest)
			return
		}
		// Prevent path traversal by cleaning the path and not allowing separators.
		if filepath.Base(filename) != filename {
			http.Error(w, "invalid filename", http.StatusBadRequest)
			return
		}
		http.ServeFile(w, r, filepath.Join(cfg.UploadDir, filename))
	})

	return r
}

