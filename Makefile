.PHONY: build up down logs restart clean

build:
	docker-compose build

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

restart:
	docker-compose restart

clean:
	docker-compose down -v --remove-orphans
	docker rmi aep-agent-runtime:latest aep-api:latest aep-frontend:latest 2>/dev/null || true

agent-runtime-image:
	docker build -t aep-agent-runtime:latest ./agent-runtime

dev-api:
	cd api && npm run dev

dev-frontend:
	cd frontend && npm run dev
