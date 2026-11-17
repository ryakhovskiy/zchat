# Static client: no dependency installation or build step.
FROM nginxinc/nginx-unprivileged:alpine-slim@sha256:a8cb0f33d51fa107c96fd2bd3a71aaf564ec131e9d2bdf8700944f0ed8b170d7

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js /usr/share/nginx/html/

USER 101
EXPOSE 8080
