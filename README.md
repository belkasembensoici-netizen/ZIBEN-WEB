# ZIBEN Nova OS

ZIBEN Nova OS is an independent, cloud-first AI commerce and automation
operating platform for merchants, digital sellers, businesses, creators, and
automation professionals. Algeria is the initial market for configurable
regional intelligence; the global core must not hardcode regional assumptions.

## Product priorities

1. ZIBEN Command Center — the central platform operations interface.
2. ZIBEN Market Intelligence — evidence-based market and campaign insights,
   initially specializing in Algeria.

These are product priorities, not claims that either feature is implemented.

## Architecture

- Frontend: existing HTML, CSS, and JavaScript, now including a responsive
  application workspace shell with honest empty/unavailable states.
- Backend: NestJS and TypeScript modular-monolith foundation.
- Database: PostgreSQL with Drizzle ORM and explicit SQL migrations.
- Automation: n8n integration is planned.
- AI: provider-independent architecture is planned; no provider is selected.
- Deployment: managed cloud services; the separate local Docker stack is not a
  ZIBEN Nova OS dependency.
- CI: [offline GitHub Actions checks](./.github/workflows/ci.yml); cloud
  database provisioning and migration deployment remain separate.

See [docs/MASTER_ARCHITECTURE.md](./docs/MASTER_ARCHITECTURE.md) for the current
architecture direction and provider-selection criteria.

The proposed identity-provider and tenant-context decision is documented in
[ADR 0001](./docs/adr/0001-enterprise-identity-and-tenant-context.md). The
provider is not selected; tenant-data access remains disabled pending verified
database isolation.

## Current implementation status

- Frontend preserves the marketing site and adds navigation for Command
  Center, commerce, AI, market intelligence, automation, analytics, activity,
  notifications, and settings. Business views are honest empty states; they
  do not represent fabricated records as production data.
- The AI demo no longer simulates analysis. A bounded provider-adapter
  execution service and tenant-scoped agent runner exist, but no provider,
  credentials, durable execution history, or public execution API is
  configured.
- Backend exposes liveness, PostgreSQL readiness, and a public, non-sensitive
  `/api/v1/capabilities` endpoint describing implementation status.
- The Command Center currently displays only live API/database health and
  capability status. It has no tenant business metrics.
- GitHub Actions runs offline backend checks and a production build; it does
  not provision a database or run migrations.
- Identity, tenant, commerce, AI execution, automation, market-evidence, and
  audit schema foundations exist. The current RLS policies trust
  caller-settable PostgreSQL settings and are not an authenticated boundary.
  Migration `0003_runtime_tenant_access_lockdown` revokes production
  `app_runtime` access to the application schema until a trusted identity and
  database-verifier design is selected. That migration has not been applied.
- Identity has a fail-closed authorization boundary; no provider is configured.
  The membership schema/repository exists but remains unavailable under the
  runtime database lockout. An optional OIDC verifier is not an HTTP
  authentication guard. Commerce order/totals/inventory invariants, bounded AI
  agent execution, evidence normalization, and replay-store-gated webhook
  verification have tested foundations, but lack persistence and public APIs.
- Cloud database provisioning and live migration/integration verification
  have not been performed.

## Run locally

Start the backend from PowerShell after providing its approved development
database settings through the environment:

```powershell
Set-Location "C:\Users\home\Desktop\ZIBEN WEB\backend"
$env:OBSERVE_ENABLED = "false"
$env:DATABASE_URL = "<development runtime PostgreSQL URL>"
$env:CORS_ORIGIN = "http://127.0.0.1:5500"
npm run start:dev
```

In VS Code, open `frontend/index.html` with the Live Server extension. If
Live Server uses a different origin, set `CORS_ORIGIN` to that exact origin
and set the `ziben-api-base-url` meta tag in `frontend/index.html` to the
backend origin (for example `http://127.0.0.1:3000`). Do not use production
credentials for local development. Without a reachable backend, the app shell
remains navigable and reports service/capability status as unavailable.
