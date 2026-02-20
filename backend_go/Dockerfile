FROM golang:1.26

WORKDIR /app

# Pre-cache dependencies
COPY go.mod ./
RUN go mod download

# Copy source
COPY . .

# Build the server binary
RUN CGO_ENABLED=1 GOOS=linux go build -o /app/server ./cmd/server

# Expose HTTP port (matches default HTTP_PORT)
EXPOSE 8000

# Runtime configuration (override in docker run / compose as needed)
ENV HTTP_HOST=0.0.0.0 \
    HTTP_PORT=8000

# JWT_SECRET and ENCRYPTION_KEY **must** be provided in the environment
CMD ["/app/server"]

