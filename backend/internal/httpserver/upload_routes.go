package httpserver

import (
	"database/sql"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"backend/internal/config"
	"backend/internal/security"
)

// forbiddenExtensions are rejected on upload.
//
// Two groups: executables/scripts, and browser-renderable markup. The latter
// (.html, .svg, etc.) would otherwise be served with a renderable Content-Type
// from the app's own origin, giving an attacker stored XSS against any user who
// opens the "attachment" — see SECURITY_HARDENING.md item 3.
var forbiddenExtensions = map[string]struct{}{
	".exe": {}, ".dll": {}, ".bat": {}, ".cmd": {}, ".sh": {},
	".py": {}, ".php": {}, ".rb": {}, ".pl": {}, ".ps1": {},
	".vbs": {}, ".js": {}, ".msi": {}, ".com": {},
	".html": {}, ".htm": {}, ".xhtml": {}, ".shtml": {}, ".mhtml": {},
	".svg": {}, ".svgz": {}, ".xml": {}, ".xsl": {}, ".xslt": {},
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
func UploadRoutes(cfg *config.Config, db *sql.DB, tokenSvc *security.TokenService) chi.Router {
	r := chi.NewRouter()

	r.Post("/", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 51<<20) // 50MB + overhead
		// #nosec G120 -- body is bounded by MaxBytesReader above and the 50MB ParseMultipartForm limit
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
		if strings.ContainsAny(ext, `/\`) {
			http.Error(w, "invalid file extension", http.StatusBadRequest)
			return
		}
		if ext == "" {
			http.Error(w, "file must have an extension", http.StatusBadRequest)
			return
		}
		if _, forbidden := forbiddenExtensions[ext]; forbidden {
			http.Error(w, "file type not allowed", http.StatusBadRequest)
			return
		}

		// Read first 512 bytes to detect content type
		buf := make([]byte, 512)
		n, err := file.Read(buf)
		if err != nil && err != io.EOF {
			http.Error(w, "error reading file", http.StatusInternalServerError)
			return
		}
		mimeType := http.DetectContentType(buf[:n])
		// Rewind file pointer
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			http.Error(w, "error processing file", http.StatusInternalServerError)
			return
		}

		filename := uuid.New().String() + ext
		if err := os.MkdirAll(cfg.UploadDir, 0o750); err != nil {
			http.Error(w, "could not create upload directory", http.StatusInternalServerError)
			return
		}

		root, err := os.OpenRoot(cfg.UploadDir)
		if err != nil {
			http.Error(w, "could not open upload directory", http.StatusInternalServerError)
			return
		}
		defer root.Close()

		out, err := root.Create(filename)
		if err != nil {
			http.Error(w, "could not create file", http.StatusInternalServerError)
			return
		}
		defer out.Close()

		if _, err := io.Copy(out, file); err != nil {
			_ = root.Remove(filename)
			http.Error(w, "could not save file", http.StatusInternalServerError)
			return
		}

		fileSize := header.Size
		if fileSize == 0 {
			if fi, err := out.Stat(); err == nil {
				fileSize = fi.Size()
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"file_path":     "uploads/" + filename,
			"file_type":     categoriseFileType(ext),
			"filename":      filename,
			"mime_type":     mimeType,
			"original_name": header.Filename,
			"file_size":     fileSize,
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

		// Try to fetch metadata from DB. The download filename defaults to the
		// stored (UUID) name and is upgraded to the user-facing original_name
		// only when a row exists — but Content-Disposition: attachment is set
		// unconditionally below, so a missing/failed lookup can never cause the
		// file to be served inline (SECURITY_HARDENING.md item 3).
		filePathKey := "uploads/" + filename
		downloadName := filename
		var originalName string
		err := db.QueryRowContext(r.Context(), "SELECT original_name FROM attachments WHERE file_path = $1", filePathKey).Scan(&originalName)
		if err == nil && originalName != "" {
			downloadName = originalName
			// Increment read_count
			_, _ = db.ExecContext(r.Context(), "UPDATE attachments SET read_count = read_count + 1 WHERE file_path = $1", filePathKey)
		}
		// mime.FormatMediaType safely quotes/encodes the filename (RFC 2183),
		// so a name containing quotes, backslashes, or CR/LF cannot break out of
		// the header value. Fall back to a fixed name if it somehow can't.
		disposition := mime.FormatMediaType("attachment", map[string]string{"filename": downloadName})
		if disposition == "" {
			disposition = "attachment"
		}
		w.Header().Set("Content-Disposition", disposition)
		root, err := os.OpenRoot(cfg.UploadDir)
		if err != nil {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		defer root.Close()

		f, err := root.Open(filename)
		if err != nil {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		defer f.Close()

		fi, err := f.Stat()
		if err != nil {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		http.ServeContent(w, r, filename, fi.ModTime(), f)
	})

	return r
}
