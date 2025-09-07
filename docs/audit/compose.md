# compose stability (monolith)

- monolith now exposes GET /api/adtech/health → { ok: true }
- docker-compose healthcheck hits http://localhost:3001/api/adtech/health every 10s (12 retries)
- restart policy: on-failure (lets container auto-recover on transient errors)

Notes:

- gateway routes /api/adtech/\* to monolith (authn applied)
- health is informational in CI; failures do not fail smoke-phase-b
