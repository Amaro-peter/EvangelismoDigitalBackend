# 🐳 Docker Development Guide

## Prerequisites

- Docker Desktop installed and running
- Docker Compose v3.8+
- Git Bash (Windows) or Terminal (Mac/Linux)

## Quick Start

### First Time Setup

```bash
# Make the helper script executable (Linux/Mac/Git Bash)
chmod +x docker-dev.sh

# Start all services
./docker-dev.sh start

# Or manually
docker-compose up --build
```

### Windows (PowerShell/CMD)

```powershell
docker-compose up --build
```

## Helper Script Commands

The `docker-dev.sh` script provides convenient commands for development:

```bash
# Start services
./docker-dev.sh start

# Stop services
./docker-dev.sh stop

# View logs
./docker-dev.sh logs           # All services
./docker-dev.sh logs app       # Just API
./docker-dev.sh logs worker    # Just worker

# Rebuild
./docker-dev.sh rebuild

# Database operations
./docker-dev.sh migrate "add_users_table"  # Create migration (local)
./docker-dev.sh migrate-deploy              # Deploy in container
./docker-dev.sh seed                        # Seed database

# Development tools
./docker-dev.sh prisma-studio  # Open Prisma Studio
./docker-dev.sh shell          # Shell into app container
./docker-dev.sh shell worker   # Shell into worker container

# Maintenance
./docker-dev.sh status         # Service status
./docker-dev.sh clean          # Remove volumes
./docker-dev.sh reset          # Full reset
```

## Services & Ports

| Service | Port | URL |
|---------|------|-----|
| API | 3333 | http://localhost:3333 |
| Prisma Studio | 5555 | http://localhost:5555 |
| PostgreSQL | 5432 | localhost:5432 |
| Redis | 6379 | localhost:6379 |

## Development Workflow

### 1. Start Development

```bash
./docker-dev.sh start
```

### 2. Make Code Changes

- Code changes are hot-reloaded automatically
- API restarts on file changes (via `tsx watch`)

### 3. Database Changes

```bash
# Create migration (runs locally, not in container)
./docker-dev.sh migrate "description_of_change"

# Or manually
npx prisma migrate dev --name description_of_change
```

### 4. View Logs

```bash
# All services
./docker-dev.sh logs

# Specific service
./docker-dev.sh logs app
./docker-dev.sh logs worker
./docker-dev.sh logs db
./docker-dev.sh logs redis
```

## Troubleshooting

### Services Won't Start

```bash
# Clean everything and rebuild
./docker-dev.sh clean
./docker-dev.sh rebuild
```

### Database Issues

```bash
# Reset database completely
./docker-dev.sh reset
```

### Port Already in Use

```bash
# Check what's using the port
# Linux/Mac
lsof -i :3333

# Windows
netstat -ano | findstr :3333

# Stop the conflicting service or change port in .env
```

### Prisma Client Out of Sync

```bash
# Shell into container
./docker-dev.sh shell

# Regenerate Prisma client
npx prisma generate
```

### Redis Connection Issues

```bash
# Check Redis is running
./docker-dev.sh logs redis

# Test connection
./docker-dev.sh shell
redis-cli -h redis -p 6379 -a ZP8xM6H4R5A0dJQ7L2WcN3E9yFVkBG ping
```

## Environment Variables

Key variables in `.env`:

```env
# Database
POSTGRES_HOST=db              # Container hostname
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=evangelismodigital

# Redis
REDIS_HOST=redis              # Container hostname
REDIS_PORT=6379
REDIS_PASSWORD=ZP8xM6H4R5A0dJQ7L2WcN3E9yFVkBG

# App
APP_PORT=3333
NODE_ENV=development
```

## Health Checks

All services have health checks:

- **Database**: Checks PostgreSQL is accepting connections
- **Redis**: Checks Redis responds to PING
- **API**: Checks /health-check endpoint
- **Worker**: Checks process is running

## Volume Persistence

Data is persisted in Docker volumes:

- `pgdata`: PostgreSQL data
- `redis_data`: Redis data

These survive container restarts but are removed with `./docker-dev.sh clean`

## Best Practices

1. **Use the helper script** for common operations
2. **Create migrations locally** (not in container)
3. **Check logs** when debugging
4. **Reset database** when schema gets out of sync
5. **Keep .env secure** (don't commit passwords)

## Common Tasks

### Run Prisma Studio

```bash
./docker-dev.sh prisma-studio
# Opens on http://localhost:5555
```

### Access Database Directly

```bash
./docker-dev.sh shell

# Inside container
psql $DATABASE_URL
```

### Inspect Redis

```bash
./docker-dev.sh shell

# Inside container
redis-cli -h redis -p 6379 -a $REDIS_PASSWORD
```

### View Worker Queue

Check BullMQ dashboard or logs:

```bash
./docker-dev.sh logs worker
```

## Stopping Development

```bash
# Stop services (keeps data)
./docker-dev.sh stop

# Stop and remove containers (keeps data)
./docker-dev.sh down

# Remove everything including data
./docker-dev.sh clean
```

## Production Differences

Development setup differs from production:

| Feature | Development | Production |
|---------|-------------|------------|
| Hot Reload | ✅ Yes | ❌ No |
| Source Maps | ✅ Yes | ❌ No |
| Volumes | ✅ Mounted | ❌ Copied |
| Logging | Detailed | Structured |
| Build | Dev build | Minified |

For production deployment, see `deploy.sh` and PM2 configuration.