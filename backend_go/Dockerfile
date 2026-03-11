FROM golang:1.24

WORKDIR /app

# Pre-cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Install system dependencies required by Chromium on Debian
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libdbus-1-3 \
    libxshmfence1 libx11-xcb1 fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright Chromium browser (deps already installed above)
RUN go run github.com/playwright-community/playwright-go/cmd/playwright install chromium

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

