# syntax=docker/dockerfile:1

# Stage 1: build React frontend
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: build Go backend and dbsync
FROM golang:1.24-bookworm AS backend-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o server ./cmd/server
RUN CGO_ENABLED=1 GOOS=linux go build -o dbsync ./cmd/dbsync
RUN CGO_ENABLED=1 GOOS=linux go build -o ingestvoyage ./cmd/ingestvoyage

# Stage 3: final image
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-builder /app/server ./server
COPY --from=backend-builder /app/dbsync ./dbsync
COPY --from=backend-builder /app/ingestvoyage ./ingestvoyage
COPY --from=backend-builder /app/data/source ./data/source
COPY --from=backend-builder /app/resources ./resources
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
# Rename the long log file to a shell-safe path.
RUN cp "/app/resources/Captain Cook's Journal During His First Vo - James Cook.txt" /app/resources/cook.txt

ENV SQLITE_DSN=/data/on-that-day.db
ENV DATA_DIR=/app/data/source
ENV SITE_DIR=/app/frontend/dist
ENV SERVER_ADDR=:8080
ENV VOYAGE_JSON=/app/data/source/voyages/cook.json
ENV VOYAGE_LOG=/app/resources/cook.txt

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["./entrypoint.sh"]
