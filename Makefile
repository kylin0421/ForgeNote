.PHONY: api frontend worker dev test lint build docker-up docker-down clean

api:
	uv run --env-file .env run_api.py

frontend:
	cd frontend && npm run dev

worker:
	uv run --env-file .env surreal-commands-worker --import-modules commands

dev:
	docker compose up -d surrealdb
	uv run --env-file .env run_api.py &
	uv run --env-file .env surreal-commands-worker --import-modules commands &
	cd frontend && npm run dev

test:
	uv run pytest

lint:
	uv run ruff check .
	cd frontend && npm run lint

build:
	cd frontend && npm run build

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

clean:
	uv cache clean
	cd frontend && npm cache verify
