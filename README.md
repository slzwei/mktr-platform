# MKTR Platform

This web app is developed by Shawn Lee Yi Heng. #Twilio's Verification

A full‑stack marketing operations platform with agent management, campaign management, a visual campaign landing page designer, file uploads, QR flows, and phone verification via Twilio Verify.

## Highlights

- Admin agent management with owed leads tracking
- Campaign CRUD with agent assignment and demographics
- Visual landing page designer with live preview and auto‑save
- Image uploads with static serving
- QR code resources (campaign/car/promotional)
- JWT auth (email/password) + Google OAuth
- Twilio Verify for SMS OTP
- SQLite by default (swappable to Postgres)

## Tech Stack

- Frontend: React 18, Vite 6, Tailwind, Radix UI, react-router-dom
- Backend: Node.js, Express, Sequelize
- DB: SQLite (dev), Postgres (supported)
- Auth: JWT, Google OAuth (google-auth-library)
- Files: multer (disk), static served at /uploads
- SMS Verify: Twilio Verify

## Monorepo Layout

- Frontend app at project root (`src`, `vite`, etc.)
- Backend server in `backend/` (Express API, Sequelize, SQLite db)

Key directories:

- `src/pages/*`: top-level pages
- `src/components/*`: features (agents, campaigns, designer, etc.)
- `src/api/*`: API client and integrations
- `backend/src/models/*`: Sequelize models
- `backend/src/routes/*`: API endpoints
- `backend/uploads/`: uploaded assets (gitignored)

## Quick Start

### Prerequisites

- Node 18+ and npm
- Twilio account (Verify Service SID)
- Google OAuth Client ID (optional for Google login)

### 1) Clone and install

```bash
git clone https://github.com/slzwei/mktr-platform.git
cd mktr-platform

# Frontend deps
npm install

# Backend deps
cd backend && npm install && cd ..
```

### 2) Environment vars

Frontend `.env` (project root):

```bash
VITE_API_URL=http://localhost:3001/api
```

Backend `.env` (in `backend/`):

```bash
NODE_ENV=development
PORT=3001

# JWT
JWT_SECRET=replace_me
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=http://localhost:5173

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# File Uploads
MAX_FILE_SIZE=10485760
UPLOAD_PATH=uploads/

# Twilio Verify
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Note: `.env.example` files are provided in both root and backend.

### 3) Seed users (admin/agent/fleet_owner)

```bash
cd backend
node src/database/seed.js
```

Admin default (from seed): email `shawnleeapps@gmail.com`, password `admin123`.

### 4) Run

- Backend:

```bash
cd backend
npm start
# Health: http://localhost:3001/health
```

- Frontend:

```bash
npm run dev
# App: http://localhost:5173
```

## Authentication

- Email/Password:
  - POST `/api/auth/login` { email, password } → { token, user }
  - Protected resources require Bearer token
- Google OAuth:
  - POST `/api/auth/google` with credential
  - POST `/api/auth/google/callback` (server exchanges code)
- Current user: GET `/api/auth/profile` (requires JWT)

## Key Features

### Agents

- Endpoints under `/api/users` (admin-only management) and `/api/agents` listing
- User model includes `owed_leads_count` (persisted during create/update)

### Campaigns

- Endpoints: `/api/campaigns`
- Model fields include:
  - `name`, `status`, `type` (default `lead_generation`)
  - `min_age`, `max_age`, `start_date`, `end_date`, `is_active`
  - `assigned_agents` (JSON array)
  - `design_config` (JSON) for landing page designer
- Status reflects `is_active` (active/draft)

Create example:

```bash
curl -X POST http://localhost:3001/api/campaigns \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Campaign",
    "min_age": 18,
    "max_age": 65,
    "is_active": true
  }'
```

### Campaign Landing Page Designer

- Page: `src/pages/AdminCampaignDesigner.jsx`
- Editor: `src/components/campaigns/DesignEditor.jsx`
- Controls:
  - Headline/subheadline
  - Header image upload
  - Theme color, background style, alignment
  - Form width, spacing, headline size
- Live preview with:
  - Phone verification flow (Twilio Verify)
  - Age validation helper
- Auto-save (debounced) updates `design_config` on the campaign

### Phone Verification (Twilio Verify)

- Backend routes:
  - POST `/api/verify/send` { phone, countryCode?="+65" }
  - POST `/api/verify/check` { phone, code, countryCode?="+65" }
- Frontend designer uses these to:
  - Send code on Verify/Resend button
  - Button becomes `Resend (XXs)` with a 20s cooldown
  - Confirm code sets verified state on success

Common errors:

- 500 “Verification service not configured” → ensure backend `.env` has TWILIO\_\* and server restarted
- 400 with Twilio message → verify phone format and service SID

### File Uploads

- Single file: POST `/api/uploads/single?type=image` (form field `file`)
- Multiple files: POST `/api/uploads/multiple` (field `files`)
- Avatars: POST `/api/uploads/avatar` (updates user)
- Static serving: GET `/uploads/<type>/<filename>`
- Designer saves returned `data.file.url` (relative), which the app renders via absolute API origin

cURL example:

```bash
curl -X POST "http://localhost:3001/api/uploads/single?type=image" \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/path/to/image.png"
```

### QR / Prospects / Fleet

- QR tags under `/api/qrcodes`, relate to `campaign` or `car`
- Prospects under `/api/prospects`, including lead source types
- Fleet entities (`cars`, `drivers`, `fleet_owners`) exposed via `/api/fleet`

## Frontend API Client

- `src/api/client.js`:
  - Base client with token management, request helpers, file upload
  - Entities mapped via `src/api/entities.js`
- `VITE_API_URL` must point to backend API (e.g., `http://localhost:3001/api`)

## Scripts

Frontend:

- `npm run dev` (start Vite)
- `npm run build` (build)
- `npm run preview` (preview build)
- `npm run lint` (eslint)

Backend:

- `npm start` (run server)
- `npm run dev` (nodemon)
- `npm run seed` (seed users)
- `npm run migrate` (custom migration hook if used)

## Deployment Notes

- Backend Dockerfile provided in `backend/`
- Configure secrets in environment (JWT, Twilio, Google, CORS)
- Static uploads served from `/uploads`; ensure persistent storage in production
- Helmet is configured to allow cross-origin resource loading (`crossOriginResourcePolicy: 'cross-origin'`) so the frontend can display uploaded images

## Default Ports

- Frontend: 5173
- Backend API: 3001

## Health & Logging

- Health check: GET `/health`
- Server logs include OAuth and upload helpful diagnostics during development

## Security

- Do not commit `.env` files (gitignored)
- JWT secret must be strong in production
- Restrict `CORS_ORIGIN` appropriately
- Validate file uploads and enforce size limits (default 10MB)

## Roadmap Ideas

- Role-based UI gating & feature flags
- Campaign analytics dashboard
- CDN/storage for uploads (S3/GCS)
- E2E tests for designer flow

If you need environment scaffolding for cloud deployment (Docker Compose, CI/CD, secrets), I can add a production-ready setup.
