#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting production deploy..."

# ---------------------------------------------------------------------------
# 1. Load environment variables
# ---------------------------------------------------------------------------
echo "🔐 Loading environment variables..."

if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    exit 1
fi

set -a
source .env
set +a

# Sanity checks (fail fast)
: "${POSTGRES_USER:?Missing POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD}"
: "${POSTGRES_DB:?Missing POSTGRES_DB}"
: "${DATABASE_URL:?Missing DATABASE_URL}"
: "${REDIS_PASSWORD:?Missing REDIS_PASSWORD}"
: "${JWT_SECRET:?Missing JWT_SECRET}"

# ---------------------------------------------------------------------------
# 2. Generate redis.conf with password
# ---------------------------------------------------------------------------
echo "🔧 Generating redis.conf..."

cat > redis.conf << EOF
# Redis Configuration File for Production
# Generated automatically by deploy.sh - DO NOT EDIT MANUALLY

# Network
bind 0.0.0.0
port 6379
timeout 300

# Persistence
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec

# Security
requirepass ${REDIS_PASSWORD}

# Limits
maxmemory 200mb
maxmemory-policy noeviction

# Disable dangerous commands
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command KEYS ""
rename-command CONFIG ""

# Logging
loglevel notice
logfile ""

# Performance
tcp-backlog 511
tcp-keepalive 300
EOF

echo "✅ redis.conf generated"

# Add to .gitignore if not already there
if [ -f .gitignore ]; then
    if ! grep -q "^redis.conf$" .gitignore; then
        echo "redis.conf" >> .gitignore
        echo "📝 Added redis.conf to .gitignore"
    fi
else
    echo "redis.conf" > .gitignore
    echo "📝 Created .gitignore with redis.conf"
fi

# ---------------------------------------------------------------------------
# 4. Build images
# ---------------------------------------------------------------------------
echo "🐳 Building Docker images..."
docker compose -f docker-compose.prod.yml build --no-cache

# ---------------------------------------------------------------------------
# 5. Stop existing containers (if any)
# ---------------------------------------------------------------------------
echo "🛑 Stopping existing containers..."
docker compose -f docker-compose.prod.yml down || true

# ---------------------------------------------------------------------------
# 6. Start database & redis first
# ---------------------------------------------------------------------------
echo "🗄️  Starting database and redis..."
docker compose -f docker-compose.prod.yml up -d db redis

# Wait for services to be healthy
echo "⏳ Waiting for database and redis to be healthy..."
timeout 60 bash -c 'until docker compose -f docker-compose.prod.yml ps db | grep -q "(healthy)"; do sleep 2; done' || {
    echo "❌ Error: Database failed to become healthy"
    docker compose -f docker-compose.prod.yml logs db
    exit 1
}

timeout 60 bash -c 'until docker compose -f docker-compose.prod.yml ps redis | grep -q "(healthy)"; do sleep 2; done' || {
    echo "❌ Error: Redis failed to become healthy"
    docker compose -f docker-compose.prod.yml logs redis
    exit 1
}

echo "✅ Database and Redis are healthy"

# ---------------------------------------------------------------------------
# 7. Run migrator (ONE-SHOT)
# ---------------------------------------------------------------------------
echo "🧬 Running Prisma migrator..."
docker compose -f docker-compose.prod.yml up --abort-on-container-exit migrator

# Check if migration succeeded
if [ $? -ne 0 ]; then
    echo "❌ Error: Migration failed"
    docker compose -f docker-compose.prod.yml logs migrator
    exit 1
fi

echo "✅ Migrations completed successfully"

# ---------------------------------------------------------------------------
# 8. Start application services
# ---------------------------------------------------------------------------
echo "⚙️  Starting application services..."
docker compose -f docker-compose.prod.yml up -d app worker

# Wait for app to be healthy
echo "⏳ Waiting for application to be healthy..."
timeout 120 bash -c 'until docker compose -f docker-compose.prod.yml ps app | grep -q "(healthy)"; do sleep 3; done' || {
    echo "❌ Error: Application failed to become healthy"
    docker compose -f docker-compose.prod.yml logs app
    exit 1
}

echo "✅ Application is healthy"

# ---------------------------------------------------------------------------
# 9. Cleanup
# ---------------------------------------------------------------------------
echo "🧹 Cleaning unused images..."
docker image prune -f

# Clean up dangling volumes (optional, commented out for safety)
# docker volume prune -f

# ---------------------------------------------------------------------------
# 10. Final status and health checks
# ---------------------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment finished successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Container Status:"
docker compose -f docker-compose.prod.yml ps
echo ""
echo "🏥 Health Checks:"
docker compose -f docker-compose.prod.yml ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "📝 Quick Commands:"
echo "  View logs:        docker compose -f docker-compose.prod.yml logs -f"
echo "  View app logs:    docker compose -f docker-compose.prod.yml logs -f app"
echo "  View all status:  docker compose -f docker-compose.prod.yml ps -a"
echo "  Stop all:         docker compose -f docker-compose.prod.yml down"
echo "  Restart app:      docker compose -f docker-compose.prod.yml restart app"
echo ""
echo "🌐 Application should be available at: http://localhost:${APP_PORT}"
echo ""