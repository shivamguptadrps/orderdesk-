# OrderDesk API. Built and run by deploy/server/docker-compose.yml.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY requirements.txt constraints.txt ./
RUN pip install -r requirements.txt -c constraints.txt

COPY . .
RUN useradd --create-home --uid 10001 app && mkdir -p /app/uploads && chown -R app /app/uploads
USER app

EXPOSE 8000
# Apply database migrations, then serve. One process: the nightly related-products job runs inside it.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
