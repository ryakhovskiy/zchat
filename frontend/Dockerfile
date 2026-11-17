# ---- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /src

# package-lock.json is optional (currently gitignored); use it when present
COPY package.json package-lock.json* ./
# Optional extra root CA for networks with TLS interception (e.g. Zscaler):
#   docker build --secret id=extra_ca,src=/path/to/root-ca.crt .
# The CA is only trusted for this step and is not stored in the image.
RUN --mount=type=secret,id=extra_ca,required=false \
    --mount=type=cache,target=/root/.npm \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi && \
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

COPY . .

# Build-time configuration (baked into the JS bundle)
ARG VITE_API_URL=/api
ARG VITE_WS_URL=/ws
# Optional: if empty, the app fetches the key from /api/push/vapid-key
ARG VITE_VAPID_PUBLIC_KEY=
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY

RUN npm run build

# ---- Runtime stage -----------------------------------------------------------
# nginx only (no Node, no node_modules), running as non-root user "nginx" (101)
FROM nginxinc/nginx-unprivileged:alpine-slim

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 8080
