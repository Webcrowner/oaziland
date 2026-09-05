# Oaziland backend — production Docker image.
#
# WHY a multi-stage-free, single-stage build here: this is a
# straightforward Python/Django app with no heavy compiled
# dependencies that would benefit from a separate build stage — a
# single stage keeps this file simple to read for someone deploying
# it for the first time, at essentially no cost in image size.

FROM python:3.12-slim

# WHY these two env vars: PYTHONDONTWRITEBYTECODE stops Python from
# writing .pyc files into the container (no benefit in a container
# that's rebuilt on every deploy); PYTHONUNBUFFERED makes print()/log
# output show up immediately in `docker logs`, rather than being
# buffered and appearing late or out of order.
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# System packages needed to build Python packages with C extensions
# (psycopg2, etc.) — installed and then the apt cache is removed in
# the same layer to keep the final image smaller.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Copying requirements BEFORE the rest of the code is a deliberate
# Docker caching pattern: as long as requirements.txt doesn't change,
# Docker reuses this layer instead of reinstalling every dependency
# on every single code change — much faster rebuilds during
# development and redeploys.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# A real health check Docker itself understands — docker-compose can
# wait for this to pass before considering the container "ready",
# and `docker ps` will show unhealthy containers clearly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:8000/health/ || exit 1

EXPOSE 8000

# The actual startup sequence: run migrations, collect static files,
# THEN start the real production server (gunicorn, not Django's own
# development server, which is not meant for production traffic).
CMD ["sh", "-c", "python manage.py migrate --no-input && python manage.py collectstatic --no-input && gunicorn oaziland.wsgi:application --bind 0.0.0.0:8000 --workers 3 --log-file -"]
