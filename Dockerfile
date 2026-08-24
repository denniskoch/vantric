# Build the frontend.
#
# PINNED TO THE BUILDER'S OWN ARCHITECTURE. Its output is JavaScript and
# therefore architecture-blind, so building it once natively beats
# building it twice — once of them emulated — for a multi-arch image.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Nothing about branding is baked in. Whose console this says it is, and
# its wordmark, are stored settings changed in IAM & Admin → Branding —
# so a published image can be rebranded without building your own.
RUN npm run build

# Build the backend (pure Go, no cgo — modernc sqlite).
#
# CROSS-COMPILED, NOT EMULATED. Go targets another architecture from a
# native toolchain, so the builder stays on the host's platform and only
# GOARCH changes — an arm64 image takes as long as an amd64 one. Running
# the compiler under QEMU instead turns a one-minute build into ten.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS backend
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -ldflags='-s -w' -o /out/server ./cmd/server

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
