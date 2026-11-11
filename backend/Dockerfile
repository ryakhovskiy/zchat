# ---- Build stage -------------------------------------------------------------
FROM golang:1.26 AS build

WORKDIR /src

# Pre-cache dependencies
COPY go.mod go.sum ./
# Optional extra root CA for networks with TLS interception (e.g. Zscaler):
#   docker build --secret id=extra_ca,src=/path/to/root-ca.crt .
# The CA is only trusted for this step and is not stored in the image.
RUN --mount=type=secret,id=extra_ca,required=false \
    --mount=type=cache,target=/go/pkg/mod \
    if [ -s /run/secrets/extra_ca ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca > /tmp/ca-bundle.crt && \
      export SSL_CERT_FILE=/tmp/ca-bundle.crt; \
    fi && \
    go mod download && \
    rm -f /tmp/ca-bundle.crt

# Copy source
COPY . .

# Fully static binary (pure Go, no cgo), stripped of debug info and local paths
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# Runtime directories, owned by the distroless "nonroot" user (65532)
RUN mkdir -p /out/uploads && cp -r app /out/app && chown -R 65532:65532 /out/uploads /out/app

# ---- Runtime stage -----------------------------------------------------------
# distroless/static: CA certificates (web push), tzdata, /tmp, nonroot user.
# No shell, no package manager, no libc.
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

COPY --from=build /out/server /app/server
COPY --from=build --chown=65532:65532 /out/app /app/app
COPY --from=build --chown=65532:65532 /out/uploads /app/uploads

USER nonroot:nonroot

# Expose HTTP port (matches default HTTP_PORT)
EXPOSE 8000

# Runtime configuration (override in docker run / compose as needed)
ENV HTTP_HOST=0.0.0.0 \
    HTTP_PORT=8000 \
    UPLOAD_DIR=/app/uploads

# JWT_SECRET and ENCRYPTION_KEY **must** be provided in the environment
ENTRYPOINT ["/app/server"]
