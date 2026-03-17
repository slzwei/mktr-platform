# Contributing to MKTR Platform

## Prerequisites

- Node 18+
- Docker & Docker Compose
- PostgreSQL 15+ (or use Docker)

## Project Structure

```
mktr-platform/
├── src/                  # Frontend (React 18 + Vite + Tailwind)
├── backend/              # Backend API (Express 5 + Sequelize + PostgreSQL)
│   ├── src/routes/       # API route handlers
│   ├── src/database/     # Migrations, seeds, models
│   └── docker-compose.yml
├── services/             # Microservices (auth, gateway, leadgen)
├── infra/                # Infrastructure docker-compose
└── docs/                 # Documentation
```

## Getting Started

### 1. Install dependencies

```bash
npm install            # Frontend
cd backend && npm install  # Backend
```

### 2. Configure environment

```bash
cp .env.example .env                   # Frontend
cp backend/.env.example backend/.env   # Backend
```

Edit both `.env` files with your values. See [docs/ENV.md](docs/ENV.md) for details.

### 3. Start the database

```bash
cd backend && docker-compose up postgres -d
```

### 4. Run migrations and seed

```bash
cd backend
npm run migrate
npm run seed
```

### 5. Start development servers

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
npm run dev
```

Frontend: http://localhost:5173 | Backend API: http://localhost:3001

<!-- AUTO-GENERATED:scripts-start -->
## Available Scripts

### Frontend (`package.json`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint on all files |
| `npm run analyze` | Production build + open bundle visualizer |
| `npm test` | Run Vitest test suite |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run prepare` | Install Husky git hooks |

### Backend (`backend/package.json`)

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start dev server with nodemon |
| `npm test` | Run Jest test suite |
| `npm run test:legacy-safe` | Run legacy-safe test harness |
| `npm run migrate` | Run database migrations |
| `npm run seed` | Seed database with default data |
| `npm run seed:fleet` | Seed fleet/vehicle data |
| `npm run update-users` | Run user update script |
| `npm run load:smoke` | Smoke load test |
| `npm run load:spike` | Spike load test |
| `npm run load:stress` | Stress load test |
| `npm run load:soak` | Soak load test |
| `npm run load:rr` | Request/response load test |
| `npm run docker:build` | Build Docker image |
| `npm run docker:run` | Start via docker-compose |
| `npm run docker:down` | Stop docker-compose services |
<!-- AUTO-GENERATED:scripts-end -->

## Docker Compose (Full Stack)

```bash
cd backend && docker-compose up --build
```

This starts:
- **PostgreSQL 15** on port `5433` (mapped from container `5432`)
- **Backend API** on port `3001`
- **Redis 7** on port `6379` (optional caching)

### Microservices Stack (infra/)

```bash
cd infra && docker compose up --build
```

- Auth Service (RS256, JWKS) on `:4001`
- API Gateway (JWT verify + proxy) on `:4000`
- Postgres 16 on `:55432`

## Testing

- **Frontend**: `npm test` (Vitest + Testing Library + jsdom)
- **Backend**: `cd backend && npm test` (Jest + Supertest)
- Lint-staged runs ESLint on pre-commit via Husky

## Code Style

- Vanilla JS (no TypeScript) throughout
- ESLint with React/hooks plugins
- Prettier for formatting
- Husky + lint-staged enforces lint on commit

## PR Checklist

- [ ] `npm run lint` passes
- [ ] `npm test` passes (frontend)
- [ ] `cd backend && npm test` passes (backend)
- [ ] New env vars added to both `.env.example` files
- [ ] Migrations are reversible
