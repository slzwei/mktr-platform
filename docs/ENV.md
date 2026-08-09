# Environment Variables

<!-- AUTO-GENERATED:env-start -->

## Frontend (`.env`)

All frontend variables **must** start with `VITE_` to be exposed to the browser.

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_API_URL` | Yes | Backend API base URL (no trailing slash) | `http://localhost:3001/api` |
| `VITE_GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID (must match backend) | `*.apps.googleusercontent.com` |
| `VITE_SENTRY_DSN` | No | Sentry error tracking DSN | `https://...@sentry.io/...` |
| `WEBHOOK_ENABLED` | No | Master switch for outgoing webhooks | `true` / `false` |
| `LYFE_API_URL` | No | Lyfe Edge Function base URL | `https://...supabase.co/functions/v1/...` |
| `LYFE_API_KEY` | No | API key for Lyfe agent API | |
| `LYFE_WEBHOOK_URL` | No | Lyfe lead-forwarding webhook URL | `https://<project>.supabase.co/functions/v1/receive-mktr-lead` |
| `LYFE_WEBHOOK_SECRET` | No | Shared HMAC secret (must match Supabase `MKTR_WEBHOOK_SECRET`) | |

## Backend (`backend/.env`)

### General

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment mode |
| `PORT` | No | `3001` | Server listen port |
| `TRUST_PROXY` | No | `false` | Set `true` behind reverse proxy |

### Database (PostgreSQL)

Omit all `DB_*` vars to fall back to SQLite.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_HOST` | Yes* | — | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_NAME` | Yes* | — | Database name |
| `DB_USER` | Yes* | — | Database user |
| `DB_PASSWORD` | Yes* | — | Database password |
| `DB_SSL` | No | auto | Force SSL on/off (auto-enabled in production) |
| `DATABASE_URL` | No | `fresh.db` | SQLite fallback path (when `DB_HOST` unset) |

### Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** | — | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | No | `7d` | Token lifetime |
| `GOOGLE_CLIENT_ID` | Yes | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth secret (optional for public clients) |
| `GOOGLE_REDIRECT_URI` | No | derived | Explicit redirect URI (falls back to `FRONTEND_BASE_URL`) |

### URLs

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FRONTEND_BASE_URL` | Yes | — | Frontend origin for invite links, redirects |
| `FRONTEND_URL` | No | `FRONTEND_BASE_URL` | Alias used in some auth routes |
| `PUBLIC_BASE_URL` | Yes | — | Public backend URL for QR codes, tracking links |
| `CORS_ORIGIN` | Yes | — | Allowed CORS origins (comma-separated) |

### Branding

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COMPANY_NAME` | No | `MKTR` | Company name in emails/UI |
| `COMPANY_URL` | No | — | Company website URL |

### Email (SMTP)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_HOST` | Yes* | — | SMTP server hostname |
| `EMAIL_PORT` | No | `587` | SMTP port |
| `EMAIL_USER` | Yes* | — | SMTP username |
| `EMAIL_PASSWORD` | Yes* | — | SMTP password |
| `EMAIL_FROM` | No | `EMAIL_USER` | From address |

### Twilio (Phone Verification)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TWILIO_ACCOUNT_SID` | Yes* | — | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Yes* | — | Twilio auth token |
| `TWILIO_VERIFY_SERVICE_SID` | Yes* | — | Twilio Verify service SID |

### DigitalOcean Spaces (File Storage)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DO_SPACES_KEY` | Yes* | — | Spaces access key |
| `DO_SPACES_SECRET` | Yes* | — | Spaces secret key |
| `DO_SPACES_REGION` | No | `nyc3` | Spaces region |
| `DO_SPACES_ENDPOINT` | Yes* | — | Spaces endpoint URL |
| `DO_SPACES_BUCKET` | Yes* | — | Bucket name |
| `DO_SPACES_CDN_BASE` | No | — | CDN base URL |

### Security / Tracking

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IP_HASH_SALT` | No | — | Salt for hashing visitor IPs |
| `ATTRIB_SECRET` | No | — | HMAC secret for attribution cookies |
| `MAX_FILE_SIZE` | No | `10485760` | Max upload size in bytes (10 MB) |

### Rate Limiting

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Window in ms (15 min in prod) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `200` | Max requests per window |

### System Defaults

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEFAULT_AGENT_ID` | No | — | Pre-assigned agent ID for unassigned leads |
| `SYSTEM_AGENT_EMAIL` | No | `system@mktr.local` | Email for system agent record |

### Webhook Integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WEBHOOK_ENABLED` | No | `false` | Enable outbound webhook dispatch |

### Lyfe Agent API

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LYFE_API_URL` | No | — | Lyfe agent API base URL |
| `LYFE_API_KEY` | No | — | Lyfe agent API key |

### Sentry

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_DSN` | No | — | Sentry DSN for backend error tracking |

> **\*** Required for the feature to work, but the app starts without it.

<!-- AUTO-GENERATED:env-end -->
