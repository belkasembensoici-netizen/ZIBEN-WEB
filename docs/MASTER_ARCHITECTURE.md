ZIBEN Nova OS

Master Architecture Specification

Version: 1.0.0
Status: Initial Architecture
Project Type: AI-Native Business Operating System
Target: Global SaaS Platform

## Current Engineering Directive

The current owner-approved direction supersedes any conflicting initial
assumptions below: ZIBEN Nova OS is an independent, cloud-first global SaaS
platform. Local infrastructure and the separate ZIBEN Docker/Local Stack are
not product dependencies. Preserve the existing frontend prototype and visual
identity; do not rewrite it without a separate approved plan.

The highest product priorities are the ZIBEN Command Center and ZIBEN Market
Intelligence. Provider selection remains open; database and infrastructure
design must remain portable until the owner selects a cloud platform.

### Phase 1D — PostgreSQL Foundation

The backend uses NestJS, TypeScript, PostgreSQL, `pg`, and Drizzle. Runtime
connections use `DATABASE_URL` with the restricted `app_runtime` identity.
Migration operations use a separate `DATABASE_MIGRATION_URL` with
`db_migrator`; credentials must be injected through a managed secret store or
protected CI environment, not committed to project files.

TLS certificate and hostname verification are the default in every
environment. A managed PostgreSQL CA bundle may be injected through
`DATABASE_SSL_CA`. Insecure TLS is an explicit opt-in limited to loopback
development hosts and is never the cloud deployment mode.

Migrations are a deployment operation, never an application-startup action.
Drizzle Kit configuration is schema-generation-only and contains no database
credentials. The guarded `db:migrate` runner reads the reviewed Drizzle SQL,
requires pre-provisioned `app` and `drizzle` schemas, validates the expected
environment/host/port/database, live role, TLS, schema ownership, schema-scoped
privileges, and effective `schema_owner` role assumption, then applies pending
SQL transactionally under a PostgreSQL advisory lock. Migration and schema
owner roles must not have database-level `CREATE`; their `CREATE` privileges
are scoped to their respective schemas. CI/CD must additionally serialize
deployment jobs and inject migration credentials only into the guarded job.
Direct invocation of Drizzle Kit's migrate command is unsupported. The
repository CI workflow runs offline build and test checks only; it does not
deploy migrations or provide database credentials. Production migration
secret-injection and serialization controls remain unconfigured, so
production-exclusive execution is not verified.

Integration tests target an isolated, disposable managed PostgreSQL test
database using separate `db_migrator` and `app_test_runtime` identities. They
validate configured endpoint/database/role values before applying migrations;
credential scope and protected CI secrets remain independent safety controls.
No local PostgreSQL container or local volume is part of this workflow.

The backend exposes a dependency-free liveness endpoint and a sanitized
PostgreSQL readiness endpoint. The existing frontend can display the readiness
result when deployed with a same-origin API reverse proxy; no tenant, AI,
automation, or business capabilities are implied by this operational check.

The frontend retains the marketing experience and includes a responsive
application shell for planned workspaces. Its Command Center currently reports
service health and API capability status only; commerce, identity, AI,
automation, and market intelligence remain unavailable. `GET /api/v1/capabilities`
is static implementation metadata and does not expose business data. Empty
states are intentional and must not be replaced with fabricated metrics.

The backend exports non-HTTP domain foundations for AI provider execution,
evidence-provenance validation, and HMAC webhook verification. These services
have focused offline unit coverage but no provider, market source, database
storage, durable replay protection, or public business endpoints. Their
capability states are partial, not complete integrations.

The commerce domain also contains tested minor-unit total calculation, order
state transitions, and COD collection/reconciliation invariants. It does not
provide persistence, inventory concurrency, authenticated APIs, shipping, or
payment-provider integration.

The identity module exports a tenant authorization boundary that combines a
verified principal with an active tenant membership and role check. An
optional OIDC verifier validates RS256/ES256 token signatures, issuer,
audience, time claims, and JWKS key rotation; it remains default-deny until
configured and is not an HTTP authentication guard. See
[ADR 0001](./adr/0001-enterprise-identity-and-tenant-context.md). Its
unconfigured adapters deny by default; this is not end-to-end authentication.
Domain tables and forced RLS policies now exist, but those policies currently
rely on caller-settable PostgreSQL settings and are not an authenticated
tenant boundary. A follow-up migration removes `app_runtime` access to the
`app` schema and its objects until a trusted identity/verifier design is approved.
That migration has not yet been applied, so tenant-data routes must remain
unavailable until the guarded migration is deployed. The separate integration
role can exercise the policies on an isolated test database, but this is not
production tenant-isolation evidence.

Cloud provider selection is pending. This is a preliminary, provider-neutral
comparison; region availability, network features, pricing, and product terms
must be rechecked for the actual deployment regions before selection.

| Candidate                                     | Global/compatibility and connectivity                                                                                                           | Security, recovery, and scale                                                                                                       | Cost/operations considerations                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AWS RDS for PostgreSQL / Aurora PostgreSQL    | Broad AWS region footprint; VPC private networking; standard PostgreSQL on RDS, with Aurora's PostgreSQL-compatible engine as a separate option | Managed TLS certificates/CA rotation, IAM authentication options, automated backups/PITR, HA and read scaling choices               | RDS is a comparatively direct managed-Postgres path; Aurora adds engine and pricing complexity. Compare actual region, storage, I/O, HA, and transfer costs. |
| Azure Database for PostgreSQL Flexible Server | Azure regions and VNet/private access options; standard PostgreSQL service                                                                      | TLS/CA configuration, Entra ID authentication options, managed backups/PITR and HA/scaling features vary by region/tier             | Attractive when application identity, networking, and operations are already Azure-based; pricing is tier/region dependent.                                  |
| Google Cloud SQL for PostgreSQL               | Google Cloud regions; private IP and supported private connectivity; standard PostgreSQL service                                                | TLS/CA controls, IAM database authentication options, managed backups/PITR, HA and read replicas                                    | Attractive when backend workloads are already on Google Cloud; machine, storage, HA, and network costs require workload-specific comparison.                 |
| Aiven for PostgreSQL                          | Managed service offered across multiple cloud providers/regions; private connectivity depends on provider and plan                              | Managed TLS/CA and backup features; validate identity integration, recovery objectives, and network topology for the selected cloud | Can reduce provider coupling, but introduces another service boundary and may cost more than a cloud-native option at comparable scale.                      |
| Neon                                          | Serverless PostgreSQL with branching-oriented workflows; region and private networking availability depend on current plan/features             | TLS and scaling capabilities; validate enterprise identity, network isolation, backup/PITR guarantees, and workload limits          | Useful to evaluate for ephemeral CI databases and development workflows; confirm production workload fit, service limits, and current pricing.               |

Evaluate region coverage and latency, private networking, PostgreSQL
compatibility, TLS/CA rotation, identity controls, backup/PITR and recovery
objectives, scaling/performance, total price, and operational effort. Provider
pricing and feature availability vary by region and change over time.

**Recommendation:** defer provider selection until the application hosting
cloud, launch regions, recovery objectives, and expected workload are agreed.
Prefer a managed standard-PostgreSQL service in the same cloud/network as the
backend unless measured requirements justify a portable specialist provider.
Keep provider-specific CA injection, private connectivity, IAM authentication,
backup automation, and ephemeral test-database provisioning outside the
domain modules.

---

1. Product Vision

ZIBEN Nova OS is a modular, AI-native Business Operating System designed to help merchants, entrepreneurs, companies, and developers build, manage, automate, and optimize their business operations.

The platform is designed to combine:

- AI-powered business intelligence.
- Intelligent agent orchestration.
- Commerce management.
- Workflow automation.
- Developer integrations and APIs.
- Business analytics and decision support.

ZIBEN Nova is not intended to be a conventional e-commerce website or a simple AI chatbot.

It is designed as an extensible business technology platform.

2. Core Engineering Principles

2.1 AI-Native Architecture

Artificial Intelligence must be integrated into the platform architecture rather than treated as an isolated feature.

2.2 Modular Architecture

Each business capability must be organized into independent modules with clearly defined responsibilities and interfaces.

2.3 Developer-First Design

The platform must support APIs, webhooks, documentation, integrations, and future SDK development.

2.4 Scalability

The architecture must support gradual growth in users, workloads, data, and integrations.

2.5 Security by Design

Authentication, authorization, tenant isolation, input validation, audit logs, and secure configuration must be considered from the beginning.

2.6 Maintainability

All code must remain organized, documented, testable, and understandable.

3. Core Platform Modules

1. ZIBEN Nova Core
1. Commerce OS
1. AI Agent Studio
1. Automation Engine
1. Marketing Intelligence
1. Business Intelligence
1. Developer Platform
1. Identity and Access Management

These modules represent the target product architecture. They will be implemented progressively.

4. Initial Target Market

The initial market is Algerian merchants and digital businesses.

The architecture must remain adaptable to international markets, different currencies, languages, business models, and regulatory requirements.

5. Initial Development Strategy

The project will begin with a Modular Monolith architecture.

The system will initially prioritize:

1. Frontend Foundation.
2. Backend API.
3. PostgreSQL Database.
4. Authentication and Authorization.
5. First complete Commerce Module.
6. AI Agent Integration.
7. Automation Integration.

Microservices will only be considered when justified by measurable technical requirements.

6. Engineering Rule

No major architectural change, dependency installation, file deletion, or automated code rewrite should happen without review, explanation, and testing.

Every implementation phase must produce a working, verifiable result. 7. System Architecture

7.1 Architecture Style

ZIBEN Nova OS will initially use a Modular Monolith architecture.

The backend will be organized into independent business modules with explicit boundaries and controlled communication.

The system may evolve toward distributed services when justified by workload, reliability, or scaling requirements.

7.2 High-Level Architecture Layers

Presentation Layer

Responsible for dashboards, user interfaces, navigation, and user interactions.

API Layer

Responsible for request handling, validation, authentication enforcement, and communication with application services.

Application Layer

Responsible for coordinating business use cases and application workflows.

Domain Layer

Contains core business rules, entities, policies, and domain logic.

Infrastructure Layer

Responsible for database access, external providers, queues, file storage, and integrations.

AI Layer

Responsible for agent orchestration, model provider communication, tool execution, and AI-related workflows.

Automation Layer

Responsible for event-driven workflows, webhooks, scheduled tasks, and external process automation.

7.3 Core Module Responsibilities

ZIBEN Nova Core

- Platform configuration.
- Tenant management.
- Shared events.
- Module registration.
- Cross-module policies.

Identity and Access Management

- User accounts.
- Authentication.
- Roles and permissions.
- Session management.
- Tenant access control.

Commerce OS

- Products.
- Orders.
- Customers.
- Inventory.
- Commerce operations.

AI Agent Studio

- Agent definitions.
- Agent execution.
- Tool permissions.
- Model configuration.
- Execution history.

Automation Engine

- Workflow triggers.
- Workflow execution.
- Webhook integrations.
- External automation connections.

Marketing Intelligence

- Marketing analysis.
- Campaign planning.
- Content generation.
- Performance insights.

Business Intelligence

- Business metrics.
- Reports.
- Analytics.
- Decision support.

Developer Platform

- API documentation.
- API credentials.
- Webhook management.
- Integration registry.
- Developer tools.

7.4 Data Ownership

Each module must own and manage its business data through clearly defined interfaces.

Modules must not directly manipulate another module's internal data structures.

Cross-module communication should happen through application services or explicitly defined events.

7.5 Initial Infrastructure Responsibilities

PostgreSQL

Primary persistent relational database.

Redis

Optional infrastructure for caching, queues, and temporary state when required.

AI Model Providers

External or self-hosted model providers accessed through controlled provider interfaces.

n8n

External workflow automation engine integrated through authenticated webhooks and APIs.

7.6 Architecture Evolution

The platform must prioritize clear module boundaries before introducing distributed infrastructure.

Microservices, Kubernetes, and advanced orchestration platforms are future options, not initial requirements.

8. Architecture Governance

Every new module must define:

1. Purpose and responsibilities.
2. Data ownership.
3. Public interfaces.
4. Dependencies.
5. Security requirements.
6. Testing strategy.
7. Operational requirements.

No module should be introduced without a clear business or technical purpose.
