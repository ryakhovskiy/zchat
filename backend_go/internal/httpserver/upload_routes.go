package httpserver

import (
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"backend_go/internal/config"
	"backend_go/internal/security"
)

// forbiddenExtensions are rejected on upload.
var forbiddenExtensions = map[string]struct{}{
	".exe": {}, ".dll": {}, ".bat": {}, ".cmd": {}, ".sh": {},
	".py": {}, ".php": {}, ".rb": {}, ".pl": {}, ".ps1": {},
	".vbs": {}, ".js": {}, ".msi": {}, ".com": {},
}

// categoriseFileType maps a MIME type to a short category string.
func categoriseFileType(ext string) string {
	ext = strings.ToLower(ext)
	mtype := mime.TypeByExtension(ext)
	switch {
	case strings.HasPrefix(mtype, "image/"):
		return "image"
	case strings.HasPrefix(mtype, "video/"):
		return "video"
	case strings.HasPrefix(mtype, "audio/"):
		return "audio"
	case strings.Contains(mtype, "pdf"),
		strings.Contains(mtype, "word"),
		strings.Contains(mtype, "openxmlformats"),
		strings.Contains(mtype, "opendocument"),
		strings.Contains(mtype, "text/"),
		strings.Contains(mtype, "msword"),
		strings.HasSuffix(ext, ".doc"),
		strings.HasSuffix(ext, ".docx"),
		strings.HasSuffix(ext, ".xls"),
		strings.HasSuffix(ext, ".xlsx"),
		strings.HasSuffix(ext, ".ppt"),
		strings.HasSuffix(ext, ".pptx"),
		strings.HasSuffix(ext, ".pdf"),
		strings.HasSuffix(ext, ".txt"),
		strings.HasSuffix(ext, ".md"),
		strings.HasSuffix(ext, ".csv"):
		return "document"
	case strings.Contains(mtype, "zip"),
		strings.Contains(mtype, "tar"),
		strings.Contains(mtype, "gzip"),
		strings.Contains(mtype, "7z"),
		strings.HasSuffix(ext, ".zip"),
		strings.HasSuffix(ext, ".tar"),
		strings.HasSuffix(ext, ".gz"),
		strings.HasSuffix(ext, ".rar"),
		strings.HasSuffix(ext, ".7z"):
		return "archive"
	default:
		return "file"
	}
}

// UploadRoutes returns a sub-router mounted at /api/uploads.
func UploadRoutes(cfg *config.Config, tokenSvc *security.TokenService) chi.Router {
	r := chi.NewRouter()

	r.Post("/", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(50 << 20); err != nil {
			http.Error(w, "failed to parse multipart form", http.StatusBadRequest)
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "missing file", http.StatusBadRequest)
			return
		}
		defer file.Close()

		ext := strings.ToLower(filepath.Ext(header.Filename))
		if ext == "" {
			http.Error(w, "file must have an extension", http.StatusBadRequest)
			return
		}
		if _, forbidden := forbiddenExtensions[ext]; forbidden {
			http.Error(w, "file type not allowed", http.StatusBadRequest)
			return
		}

		filename := uuid.New().String() + ext
		destPath := filepath.Join(cfg.UploadDir, filename)

		if err := os.MkdirAll(cfg.UploadDir, 0755); err != nil {
			http.Error(w, "could not create upload directory", http.StatusInternalServerError)
			return
		}

		out, err := os.Create(destPath)
		if err != nil {
			http.Error(w, "could not create file", http.StatusInternalServerError)
			return
		}
		defer out.Close()

		if _, err := io.Copy(out, file); err != nil {
			os.Remove(destPath)
			http.Error(w, "could not save file", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"file_path": "uploads/" + filename,
			"file_type": categoriseFileType(ext),
			"filename":  filename,
		})
	})

	r.Get("/{filename}", func(w http.ResponseWriter, r *http.Request) {
		// Validate Bearer token or ?token= query param
		token := r.URL.Query().Get("token")
		if token == "" {
			// Try Authorization header
			auth := r.Header.Get("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				token = strings.TrimPrefix(auth, "Bearer ")
			}
		}
		if token == "" {
			http.Error(w, "missing token", http.StatusUnauthorized)
			return
		}
		if _, err := tokenSvc.Parse(token); err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		filename := chi.URLParam(r, "filename")
		if filename == "" || filepath.Base(filename) != filename {
			http.Error(w, "invalid filename", http.StatusBadRequest)
			return
		}
		http.ServeFile(w, r, filepath.Join(cfg.UploadDir, filename))
	})

	return r
}
