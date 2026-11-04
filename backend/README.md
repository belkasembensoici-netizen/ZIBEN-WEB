# ZIBEN Nova OS Backend

## Purpose and status

The backend is the initial API foundation for ZIBEN Nova OS. It currently
exposes liveness/readiness checks and an explicit, non-sensitive module
capability contract. Product, commerce, identity, automation, and AI business
workflows and business endpoints are not implemented. Persistent tenant
schemas and RLS policies are defined, but the policies rely on caller-settable
settings and are not an authenticated tenant boundary. Migration
`0003_runtime_tenant_access_lockdown` removes production `app_runtime` access
to the application schema until an approved identity/verifier design and
database isolation evidence exist. The migration is not yet applied.
Business data endpoints must remain unavailable until trusted authentication,
tenant authorization, migrations, and integration tests are operational.

## Technology

- Node.js and TypeScript using native ECMAScript modules
- NestJS 12 with the Express platform adapter
- RxJS
- NestJS Observe instrumentation
- PostgreSQL with `pg` connection pooling and Drizzle ORM
- Vitest and Supertest for tests

The persistence foundation includes tenant-aware identity and domain tables,
composite foreign keys, and forced RLS policies. Production runtime data
access remains disabled pending trusted context verification.

## Project structure

```text
backend/
  .gitattributes
  .oxlintrc.json
  .prettierrc
  AGENTS.md
  README.md
  nest-cli.json
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
  vitest.config.e2e.ts
  vitest.config.db-integration.ts
  drizzle.config.ts
  src/
    app-bootstrap.spec.ts
    app-bootstrap.ts
    app.controller.ts
    app.controller.spec.ts
    app.module.ts
    app.service.ts
    main.ts
    database/
      migrate.ts
      database.config.ts
      database.config.spec.ts
      migration-safety.ts
      migration-safety.spec.ts
      migrate.spec.ts
      database.module.ts
      database-pool.lifecycle.ts
      database.service.ts
      schema/
      migrations/
    health/
      health.controller.ts
      health.service.ts
    core/
      core.controller.ts
      core.module.ts
  test/
    app.e2e-spec.ts
    database.db-integration-spec.ts
```

## Prerequisites and installation

Use Node.js `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=26.0.0`, and npm
`>=10 <12`. These ranges satisfy the Node engine requirements in the locked
toolchain; the package manager version used for verification is npm 11.
Install dependencies from this directory:

```bash
npm ci
```

When running npm from another directory, explicitly select this package:

```powershell
npm --prefix "C:\Users\home\Desktop\ZIBEN WEB\backend" ci
```

## Development and production

Run these commands from `backend/`:

```bash
npm run start
npm run start:dev
```

The first command starts the application; the second starts it in watch mode.
For production, build and then run the compiled application:

```bash
npm run build
npm run start:prod
```

## API

The bootstrap applies the global `api` prefix and URI versioning with default
version `1`.

| Method | Route                  | Response                                                                                |
| ------ | ---------------------- | --------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1`              | `Hello World!`                                                                          |
| `GET`  | `/api/v1/health/live`  | Process liveness only; does not contact dependencies.                                   |
| `GET`  | `/api/v1/health/ready` | PostgreSQL readiness; returns HTTP 503 with sanitized status when unavailable.          |
| `GET`  | `/api/v1/capabilities` | Static implementation status for platform modules; contains no tenant or business data. |

`CoreController` is registered under the `core` path but currently declares no
route handlers.

The frontend application shell displays live readiness and capability state.
By default it expects the frontend and API on the same origin behind a reverse
proxy. For separate origins, set the `ziben-api-base-url` HTML meta tag to the
API origin and allow the frontend origin in the backend's `CORS_ORIGIN`. The
health and capability endpoints disclose no connection details, credentials,
tenant data, or business metrics.

## Domain foundations (not yet user-facing APIs)

- `CommerceModule` exports tested order amount calculations in integer minor
  currency units, explicit order-state transitions, and COD collection versus
  reconciliation rules. It does not persist orders, validate an external
  delivery receipt, reserve inventory, or expose commerce APIs.
- `IdentityModule` exports a tenant authorization boundary requiring a
  verified identity plus an active persisted membership and role. Membership
  and tenant-role permission repositories use transaction-local
  identity/tenant context. The identity-provider adapter remains unconfigured
  and fails closed; no session integration or business API is exposed.
- `MarketIntelligenceModule` exports evidence normalization that preserves
  source provenance, confidence, country/region, and distinctions between
  observations, statistical findings, hypotheses, and recommendations. New
  records are explicitly `unverified`; provenance fields do not establish
  that a claim is true. Evidence is not persisted and no market-data sources
  are connected.
- `AIStudioModule` exports a provider adapter boundary with model allowlists,
  bounded execution, response/usage validation, and an approval-verifier
  interface. The default approval verifier denies sensitive operations. No
  provider adapter, credentials, durable execution history, or public AI
  endpoint is configured.
- The AI Studio module also exports an agent runner that requires the
  runtime-branded verified tenant context, tenant-scoped agent definition,
  durable history port, bounded structured plans, registered/allowlisted
  tools, tenant-role checks, and a verified approval reference before every
  write tool. Execution history begins before tool side effects. Its default
  definition/history adapters deny execution; no agent API is exposed.
- `AutomationModule` exports timestamped HMAC verification over exact raw
  request bytes. A signed request alone is not replay protection; durable
  idempotency, job processing, secret rotation, and n8n integration remain
  unimplemented. No webhook endpoint is exposed.

These modules are foundations only. Do not mark the corresponding product
modules complete or expose tenant data until identity, authorization,
persistence, operational controls, and integration tests are in place.

## Configuration

The application reads configuration directly from process environment
variables:

| Variable                                                                                                         | Behavior                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                                                           | TCP port from `1` through `65535`; defaults to `3000` only when unset. Invalid values stop startup with an error.                                                                                          |
| `CORS_ORIGIN`                                                                                                    | Comma-separated HTTP(S) origins. Values are trimmed, normalized, and deduplicated. Paths, credentials, query strings, fragments, and invalid entries stop startup. Unset or whitespace-only disables CORS. |
| `OBSERVE_ENABLED`                                                                                                | Explicit opt-in. Only the exact value `true` enables telemetry; unset defaults to `false`.                                                                                                                 |
| `OBSERVE_APP_KEY`                                                                                                | Required with `OBSERVE_APP_SECRET` only when `OBSERVE_ENABLED=true`; empty, whitespace-only, and scaffold-placeholder values are rejected.                                                                 |
| `OBSERVE_APP_SECRET`                                                                                             | Required with `OBSERVE_APP_KEY` only when `OBSERVE_ENABLED=true`; empty, whitespace-only, and scaffold-placeholder values are rejected.                                                                    |
| `OBSERVE_ENDPOINT`                                                                                               | Required when enabled and must exactly match an approved HTTPS origin. No production destinations are currently approved.                                                                                  |
| `DATABASE_URL`                                                                                                   | Required PostgreSQL URL for the runtime identity (`app_runtime` by default). It must include credentials; never use a migration credential here.                                                           |
| `DATABASE_POOL_MAX`                                                                                              | Optional pool size from `1` through `50`; defaults to `10`.                                                                                                                                                |
| `DATABASE_IDLE_TIMEOUT_MS`                                                                                       | Optional idle-client timeout from `1000` through `300000`; defaults to `30000`.                                                                                                                            |
| `DATABASE_CONNECTION_TIMEOUT_MS`                                                                                 | Optional connection timeout from `1000` through `60000`; defaults to `5000`.                                                                                                                               |
| `DATABASE_SSL`                                                                                                   | `verify-full` by default: TLS certificate and hostname verification are required in every environment. `disable` is accepted only for loopback hosts with `DATABASE_ALLOW_INSECURE_LOCAL=true`.            |
| `DATABASE_SSL_CA`                                                                                                | Optional PEM CA certificate supplied securely by the cloud secret/configuration service. It is validated and used with certificate verification.                                                           |
| `DATABASE_ALLOW_INSECURE_LOCAL`                                                                                  | Explicit local-development-only opt-in for `DATABASE_SSL=disable`; requires a loopback hostname. Never set in cloud deployments.                                                                           |
| `DATABASE_MIGRATION_URL`                                                                                         | Dedicated migration credential (`db_migrator`); never configure it as the runtime URL. `npm run db:migrate` requires explicit expected target details and performs live identity checks before DDL.        |
| `DATABASE_MIGRATION_TARGET_ENV`                                                                                  | Required migration target label: `development`, `staging`, or `production`. Production also requires `DATABASE_MIGRATION_PRODUCTION_APPROVED=true` from a protected deployment environment.                |
| `DATABASE_MIGRATION_EXPECTED_HOST` / `DATABASE_MIGRATION_EXPECTED_PORT` / `DATABASE_MIGRATION_EXPECTED_DATABASE` | Required expected identity. Each value must match the migration URL before connecting; live database role/name/privileges are checked before migrations.                                                   |
| `DATABASE_MIGRATION_PRODUCTION_APPROVED`                                                                         | Explicit protected-environment gate required for production migration runs; it is not a substitute for CI approval controls or least-privilege credentials.                                                |
| `OIDC_ISSUER`                                                                                                    | Optional HTTPS OIDC issuer. Must be set with `OIDC_AUDIENCE`; configures signature verification only, not tenant authorization.                                                                            |
| `OIDC_AUDIENCE`                                                                                                  | Optional API resource audience expected in access tokens. Must be distinct from the browser client ID and set with `OIDC_ISSUER`; no ID token or client-side tenant claim grants access.                   |
| `OPENAI_API_KEY`                                                                                                 | Optional server-side OpenAI credential. Required with `OPENAI_MODEL_IDS`; never expose it to frontend code or logs.                                                                                        |
| `OPENAI_MODEL_IDS`                                                                                               | Comma-separated explicit model allowlist. Required with `OPENAI_API_KEY`; unlisted models cannot be requested by the provider adapter.                                                                     |

When OpenAI configuration is absent, no provider is registered. Supplying only
one of the key or model list stops application startup. The adapter sends
non-streaming Chat Completions requests only to the fixed HTTPS OpenAI API
endpoint, forwards the execution abort signal, limits response bodies, and
does not return provider error bodies to callers. This enables the provider
port only; agent definitions and durable history remain unconfigured, and no
agent execution HTTP route is exposed. Provider sandbox execution requires
owner-supplied credentials and has not been verified.

When both OIDC values are absent, the identity verifier denies every token.
Setting only one is a startup configuration error. The verifier validates
RS256/ES256 signatures against HTTPS discovery/JWKS documents, issuer,
audience, time claims, and signing-key rotation. Provider/network failures are
surfaced; no token or claim is trusted by default. This does not enable HTTP
authentication, create memberships, or provide a trusted PostgreSQL tenant
context. Production runtime database access remains locked down.

Observe is disabled unless `OBSERVE_ENABLED=true`. When enabled, configuration
must include both credentials and an explicitly approved endpoint. The
application currently has no approved production endpoints, so enabling
telemetry fails closed until an owner approves a destination and adds its exact
HTTPS origin to the allow-list in `src/observe-config.ts`. No default collector
or custom external endpoint is assumed. The endpoint must be an HTTPS origin
without URL credentials, a path, query, fragment, or non-standard port.
Configuration is validated before `@nestjs/observe` is imported, because the
installed package captures `OBSERVE_ENDPOINT` at import time. Credentials are
never included in configuration error messages.

When explicitly enabled, this backend sets request-body capture, forwarded
logs, and source snippets off. The installed Observe version instruments
incoming/provider traces, runtime metrics, and errors. Its outgoing HTTP and
supported database instrumentation are enabled by default: HTTP spans include
the method, host, and URL with recognized sensitive query values masked;
database spans remove SQL literals and do not read bound parameters. Trace-ID
propagation on outgoing HTTP is enabled by default. The package documentation
states that supported model-call instrumentation records model/token metadata
but not prompts or completions.

The package's redaction covers selected error/log text and captured request
fields; it is not a guarantee that every custom attribute or application data
is safe to transmit. The PostgreSQL driver is configured; supported database
instrumentation may therefore emit database spans when Observe is explicitly
enabled. Review telemetry content and the installed package's redaction
behavior before approving any production destination. Credentials must remain
in the runtime environment and must never be committed.

## Database foundation

`DatabaseModule` owns one bounded `pg.Pool` per Nest process, provides a shared
Drizzle instance through dependency injection, and closes the pool during Nest
shutdown. Feature modules should import `DatabaseModule` rather than create
their own pools. Use `DatabaseService.transaction()` for non-tenant work,
`identityTransaction()` for a runtime-verified identity resolving a selected
tenant, and `tenantTransaction()` for a runtime-branded verified tenant
context. Both scoped methods set transaction-local identity/tenant settings
using parameterized SQL; nested service transactions are rejected. Tenant
tables use forced PostgreSQL RLS and tenant-aware foreign keys. These
application-controlled settings protect against missing-context and
cross-tenant query mistakes, but are not an independent defense against
arbitrary SQL execution under a role with table access. Migration
`0003_runtime_tenant_access_lockdown` revokes the production runtime role's
application-schema privileges until a trusted database context is approved.
That migration is not yet applied; do not use `app_runtime` against a
provisioned database until the guarded migration has run.

The Drizzle schema and pending migrations define tenants, users, memberships,
tenant role permissions, commerce records, COD collections, AI agent
definitions/executions, automation definitions/executions, Market
Intelligence evidence, and audit events. The identity repository resolves
provider issuer/subject claims to persisted user memberships. Permission
checks require explicit persisted tenant-role grants; no default grants are
seeded. No migrations have been applied and no live identity provider is
configured.

The application never runs migrations at startup. `drizzle.config.ts` is
generation-only: it contains no database URL or credentials, so Drizzle Kit
cannot connect using this project configuration. Review generated SQL before
applying it with the guarded `npm run db:migrate` command. That command checks
the explicit environment/host/port/database target, verifies the live role,
database, TLS, role attributes, schema-owner membership and ownership, and
holds a PostgreSQL advisory lock across the migration run. CI/deployment jobs
must also serialize database deployment operations; the advisory lock
serializes cooperating ZIBEN migration runners, not unrelated migration tools.
Do not invoke `drizzle-kit migrate` directly. Production deployment must expose
`DATABASE_MIGRATION_URL` only to the guarded runner, not to schema-generation
jobs or application processes.
Pre-provision the `app` and `drizzle` schemas through the approved database
administration procedure. The `app` schema must be owned by `schema_owner`;
the `drizzle` schema must be owned by `db_migrator`. The initial migrations
grant application access to the integration role; migration
`0003_runtime_tenant_access_lockdown` removes production `app_runtime`
privileges pending trusted tenant-context verification.

Generate candidate SQL with `npm run db:generate`; this schema-generation
command does not need database credentials or connect to PostgreSQL. Review
each generated migration before applying it with `npm run db:migrate`. The
guarded runner assumes `schema_owner` for reviewed DDL and returns to
`db_migrator` for the migration ledger.

| Role               | Purpose                                        | Required boundaries                                                                                                                                                             |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_owner`     | Non-login owner for application schema objects | No login, superuser, `BYPASSRLS`, `CREATEDB`, or `CREATEROLE`; migration role may assume it for reviewed DDL. `CREATE` is limited to the pre-provisioned `app` schema.          |
| `db_migrator`      | Controlled deployment migrations               | Separate credential; no database-level `CREATE`; `CREATE` is limited to the pre-provisioned `drizzle` schema; can assume `schema_owner`; never used by the app.                 |
| `app_runtime`      | Application runtime                            | No application-schema/object access until a trusted verifier and RLS boundary are approved; no ownership, `CREATE`, superuser, or `BYPASSRLS`.                                  |
| `app_test_runtime` | Isolated integration tests                     | Disposable `_test` target only; test-only table access exercises policies but does not prove authenticated tenant isolation. No ownership, `CREATE`, superuser, or `BYPASSRLS`. |

Provision roles, the target database, both schemas, and grants through an
approved database-administration procedure before applying migrations.
`schema_owner` receives `CREATE` only on `app`; `db_migrator` owns `drizzle`,
receives `CREATE` only on that schema, and receives controlled membership in
`schema_owner`. The guarded runner creates the migration-ledger table inside
the pre-provisioned `drizzle` schema and checks live schema ownership and
privileges before applying SQL. Neither migration nor runtime roles need
database-level `CREATE`. Grant `USAGE` and `SELECT` on the migration ledger to
`app_test_runtime`; its application-table privileges must remain confined to a
disposable isolated test database. These test-only RLS policies are not a
trusted production boundary. Apply the guarded runtime-access lockdown before
using `app_runtime`. Grant
`CONNECT` and `TEMP` to the isolated `app_test_runtime` database role for
temporary-table tests; runtime roles must not receive database or schema
`CREATE`. Do not expose PostgreSQL publicly;
use the managed service's private networking and verified TLS. No cloud
provider is selected, and no cloud roles, databases, schemas, or migrations
have been provisioned.

The repository CI workflow runs offline typecheck, unit/e2e tests, lint,
formatting, frontend JavaScript syntax validation, and a production build. It
does not provision or connect to a database, run integration tests, or execute
migrations. Production migration exclusivity is therefore not verified until
an approved deployment pipeline makes `DATABASE_MIGRATION_URL` available only
to the guarded migration job and serializes that job with other deployment
operations.

### PostgreSQL integration tests

Unit tests do not require PostgreSQL. Real database tests are isolated in a
separate Vitest configuration and are skipped unless
`RUN_DB_INTEGRATION_TESTS=true`. The CI job must provision or request a
dedicated disposable managed PostgreSQL test database; never use production
credentials or local PostgreSQL containers. Set `TEST_DATABASE_URL` using
`app_test_runtime` and `TEST_DATABASE_MIGRATION_URL` using `db_migrator`, plus
`TEST_DATABASE_HOST`, `TEST_DATABASE_PORT`, and `TEST_DATABASE_NAME` as
independently protected target values. Both URLs must exactly match those
values, use the same `_test` database, and connect over verified TLS. Before
migration, the suite checks endpoint, role, database, TLS, role attributes,
schema ownership and migration role grants, then holds the same advisory lock
used by the migration runner. Afterward it verifies restricted runtime
privileges and ledger read access, transaction commit/rollback, connection
reuse, transaction-local setting cleanup, RLS policy activation,
cross-tenant read/write denial, and cross-tenant foreign-key rejection.

```powershell
npm --prefix "C:\Users\home\Desktop\ZIBEN WEB\backend" run test:db:integration
```

Only run this in the reviewed CI/CD workflow against the exact isolated test
target. The suite applies migrations to that database. Its checks are guard
rails, not a substitute for credentials scoped so they cannot access other
databases. The suite never runs during application startup.

## Build and tests

```bash
npm run build
npm run test
npm run test:e2e
npm run typecheck
npm run format:check
```

`npm run lint` is also available for linting source and tests.
