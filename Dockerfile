# Build the frontend
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Whose console this says it is. Unset builds as Vantric, which is what
# a fork should get; compose passes these through from .env.
ARG VITE_BRAND_NAME
ARG VITE_BRAND_SUFFIX
ARG VITE_BRAND_LOGO
RUN npm run build

# Build the backend (pure Go, no cgo — modernc sqlite)
FROM golang:1.26-alpine AS backend
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/server ./cmd/server

# Runtime: single binary + static assets
FROM alpine:3.21
RUN apk add --no-cache ca-certificates && adduser -D -H app
COPY --from=backend /out/server /usr/local/bin/server
COPY --from=frontend /src/frontend/dist /app/static
ENV VANTRIC_LISTEN=0.0.0.0:8080 \
    VANTRIC_DB_DSN=/data/vantric.db \
    VANTRIC_STATIC_DIR=/app/static
RUN mkdir /data && chown app /data
USER app
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["server"]
