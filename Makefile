.PHONY: all deps sync server test clean docker-build docker-up docker-down

all: deps sync server

deps:
	go mod tidy
	cd frontend && npm install

sync:
	go run ./cmd/dbsync
	sleep 1
	go run ./cmd/ingestvoyage

server:
	go run ./cmd/server

dev:
	@echo "Start backend with: make server"
	@echo "Start frontend with: cd frontend && npm run dev"

test:
	go test ./...

clean:
	rm -f on-that-day.db
	docker compose down -v

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down
