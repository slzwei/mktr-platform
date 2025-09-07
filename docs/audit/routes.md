# routes delta (adtech)

- GET /api/adtech/health → { ok: true }
- gateway continues to proxy /api/adtech/\* to monolith
- leadgen remains on /api/leadgen/\* via gateway; fallback endpoints still accept { code, status }
