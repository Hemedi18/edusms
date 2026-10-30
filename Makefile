.PHONY: help setup services-start services-stop migrate seed backend-run celery-run web-dev web-build web-test backend-test flutter-test test clean

PYTHON := backend/.venv/bin/python
PIP := backend/.venv/bin/pip

help:
	@echo "EduSMS Monorepo Developer Commands:"
	@echo "  make setup          - Initialize Python venv, Node packages, and Flutter pub deps"
	@echo "  make services-start - Start local PostgreSQL & Redis dev instances"
	@echo "  make services-stop  - Stop local PostgreSQL & Redis dev instances"
	@echo "  make migrate        - Run Django PostgreSQL migrations"
	@echo "  make seed           - Seed safe development demo data (Simulation Mode)"
	@echo "  make backend-run    - Start Django ASGI server on :8000"
	@echo "  make celery-run     - Start Celery worker + beat"
	@echo "  make web-dev        - Start React Vite dev server on :5173"
	@echo "  make web-build      - Typecheck and build production web bundle"
	@echo "  make backend-test   - Run backend pytest suite"
	@echo "  make web-test       - Run frontend Vitest test suite"
	@echo "  make flutter-test   - Run Flutter static analysis and test suite"
	@echo "  make test           - Run all automated test suites"

setup:
	python3.13 -m venv backend/.venv
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements.txt
	npm --prefix web install
	cd mobile && flutter pub get

services-start:
	bash scripts/dev_services.sh start

services-stop:
	bash scripts/dev_services.sh stop

migrate:
	backend/.venv/bin/python backend/manage.py migrate

seed:
	backend/.venv/bin/python backend/manage.py seed_demo

backend-run:
	cd backend && .venv/bin/daphne -b 0.0.0.0 -p 8000 edusms.asgi:application

celery-run:
	cd backend && .venv/bin/celery -A edusms worker -B -l info

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

backend-test:
	cd backend && .venv/bin/pytest

web-test:
	cd web && npm run test

flutter-test:
	cd mobile && flutter analyze && flutter test

test: backend-test web-test flutter-test
