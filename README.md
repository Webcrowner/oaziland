# Oaziland

A real estate super-app for Cameroon and Africa. This repository contains
everything needed to build it: the design documentation, the backend, and
(as later prompts complete) the web and mobile apps.

## Folder Structure

```
/backend   Django REST API — the shared backend for both apps
/web       Next.js web app (not yet built — Prompt 17)
/mobile    React Native mobile app (not yet built — Prompt 18)
/docs      All six design documents produced for this project
```

## Getting Started (Backend)

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install django djangorestframework django-environ psycopg2-binary pytest-django

# Copy the environment template and fill in real values
cp .env.example .env

# Requires PostgreSQL 16+ with the PostGIS extension running locally.
# See .env.example for the expected DATABASE_URL format.

python manage.py migrate
python -m pytest -v          # runs the automated test suite
python smoke_test.py         # runs the end-to-end "rent a house" scenario
python smoke_test_2.py       # runs the social/monetization/moderation scenario
```

## Current Status

See `/backend/README.md` for a detailed, honest breakdown of exactly
what's built and tested versus what's still a placeholder.

## Documentation

Everything in `/docs` should be read alongside the numbered Build Prompts
document (`05_Build_Prompts.md`) — each prompt references specific
sections of the other five documents.
