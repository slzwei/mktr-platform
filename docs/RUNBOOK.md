# MKTR Platform Runbook

## Deployment

### Backend (Docker)

```bash
cd backend
docker build -t mktr-backend .
docker-compose up -d
```

### Backend (Bare Metal)

```bash
cd backend
npm ci --omit=dev
npm run migrate
NODE_ENV=production npm start
```

### Frontend (Static Build)

```bash
npm ci
npm run build
# Deploy dist/ to CDN or static host
```

## Health Checks

| Service | Endpoint | Expected |
|---------|----------|----------|
| Backend API | `GET /api/health` | `200 OK` |
| PostgreSQL | `pg_isready -U mktr_user -d mktr_db` | exit 0 |
| Redis | `redis-cli ping` | `PONG` |

## Common Issues

### Database connection refused

- Verify `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` in `backend/.env`
- Check PostgreSQL is running: `docker-compose ps postgres`
- Check logs: `docker-compose logs postgres`

### CORS errors in browser

- Ensure `CORS_ORIGIN` in `backend/.env` matches the frontend URL exactly
- Multiple origins: use comma-separated values

### JWT authentication failures

- Verify `JWT_SECRET` is set and matches across services
- Check token expiry (`JWT_EXPIRES_IN`)
- For cookie-based auth: ensure `TRUST_PROXY=true` behind reverse proxy

### SMTP / Email failures

- Current known issue: SMTP credentials may expire (535 Authentication Credentials Invalid)
- Verify `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASSWORD`
- Test with: `curl -v smtp://EMAIL_HOST:EMAIL_PORT`

### Webhook dispatch silently skipped

- `WEBHOOK_ENABLED` must be `true` (string, not boolean)
- Check that `LYFE_WEBHOOK_URL` and `LYFE_WEBHOOK_SECRET` are set for Lyfe integration

### Migrations fail

```bash
cd backend && npm run migrate
```

If stuck, check `SequelizeMeta` table for applied migrations.

## Rollback Procedures

### Backend rollback

```bash
# Revert to previous Docker image
docker-compose down
docker tag mktr-backend:latest mktr-backend:rollback
docker pull mktr-backend:previous-tag
docker-compose up -d
```

### Database rollback

Sequelize migrations are reversible. To undo the last migration:

```bash
cd backend
npx sequelize-cli db:migrate:undo
```

## Docker Services

<!-- AUTO-GENERATED:docker-start -->

| Service | Image | Port (host:container) | Purpose |
|---------|-------|----------------------|---------|
| `postgres` | `postgres:15-alpine` | `5433:5432` | Primary database |
| `backend` | Build from `backend/Dockerfile` | `3001:3001` | API server |
| `redis` | `redis:7-alpine` | `6379:6379` | Caching (optional) |

<!-- AUTO-GENERATED:docker-end -->

## Monitoring

- **Sentry**: Error tracking (set `SENTRY_DSN` / `VITE_SENTRY_DSN`)
- **Swagger**: API docs at `GET /api-docs` (when swagger-ui-express is mounted)
- **Pino logs**: Structured JSON logging via pino/pino-http
