# ADR 0001: Enterprise identity and tenant-context boundary

- **Status:** Proposed; provider and database trust mechanism not selected
- **Date:** 2026-11-04
- **Scope:** ZIBEN identity-provider boundary, tenant authorization, and the
  condition for restoring production database access

## Context

ZIBEN needs managed authentication but must own its internal user IDs,
organization memberships, role permissions, and application authorization.
The existing identity module has a verifier port and server-side membership
reader. Phase 1F adds an optional OIDC JWT verifier that validates asymmetric
signatures, issuer, API audience, expiry, issue/not-before times, authorized
party, and provider key rotation. It is not enabled unless both
`OIDC_ISSUER` and `OIDC_AUDIENCE` are configured.

The current PostgreSQL RLS predicates trust transaction-local settings that
the application database role can set. This is not a trusted security
boundary. Migration `0003_runtime_tenant_access_lockdown` revokes
`app_runtime` access to the application schema, but has not been applied.
There are no authenticated business routes. The lockout must remain until a
replacement database trust boundary is approved, deployed, and verified.

## Decision

1. **Do not select a hosted identity vendor in this ADR.** Keep the backend
   boundary standards-based OIDC and implement provider-specific behavior only
   behind the existing `IdentityVerifier` contract. Run a time-bounded vendor
   evaluation before configuring production.
2. **Shortlist Auth0 and Clerk for a launch evaluation.** Auth0 is the first
   candidate for an enterprise B2B proof of concept because the backend can
   validate API access tokens directly through OIDC without replacing the
   current vanilla frontend. Clerk is the alternative if its organization,
   session, and UI capabilities reduce product delivery time enough to justify
   provider-owned organization context and its retained-user pricing model.
   Neither product's organization identifier or role is authoritative for
   ZIBEN data access.
3. Keep a ZIBEN-owned internal user UUID and resolve provider `(issuer,
   subject)` values through a separate provider-identity link to that user.
   Tenant IDs supplied by the browser are selectors only; every request must
   resolve active membership and permissions from ZIBEN's server-side store.
   Provider migration must link identities to the same internal user rather
   than silently creating a new principal.
4. Do not restore `app_runtime` application-schema privileges based only on
   TypeScript branding or transaction-local settings. Approve a database
   context design only after a provider-supported cryptographic verification
   mechanism and key lifecycle are demonstrated against the selected managed
   PostgreSQL service. The integration suite must prove forged settings cannot
   switch RLS identity and verify pooling, revoked memberships, role grants,
   and privilege boundaries. Otherwise keep business data access disabled.
5. Authentication uses API access tokens, never ID tokens. Enforce exact
   issuer and API audience, signature validation against HTTPS OIDC discovery
   and JWKS, expiry and time claims, an explicit algorithm allowlist, and
   bounded key caching. The application authorizes each internal tenant
   independently of provider organization claims.

## Provider comparison

| Criterion | Auth0 | Clerk | ZIBEN implication |
|---|---|---|---|
| Standards and backend fit | OIDC/JWT verification, issuer metadata and signing keys; broad application integration options | OIDC/JWT-compatible sessions and organization features; SDK-oriented integration | Both can fit the verifier port. Validate the exact API access-token format, audience, algorithms, and key rotation in a spike. |
| B2B / enterprise | B2B plans include organization-focused features; enterprise connections and support are plan-dependent | Organizations provide memberships and role/permission features; SSO and directory-sync capabilities are plan-dependent | Keep ZIBEN memberships and permission grants authoritative. Compare SAML/SCIM requirements, audit exports, support SLAs, and admin roles contractually. |
| Frontend integration | Backend-focused OIDC leaves the current HTML/CSS/JavaScript shell intact; sign-in UI and session handling need a deliberate integration | Prebuilt components and organization switcher can accelerate supported frontend stacks | The repository is framework-free vanilla JS. Measure a secure integration without adding a frontend framework solely to adopt a vendor UI. |
| Pricing model | Official pricing is use-case/MAU and plan based, with paid B2B starting tiers and enterprise quotes; feature availability is tier-specific | Official pricing uses retained-user pricing and plan/add-on tiers; organization and SSO usage can affect cost | Model 12/24-month cost using expected active users, tenants, enterprise connections, support, audit retention, and SMS. Recheck official quotes before procurement. |
| Region, residency, and operations | Available tenant regions, data residency scope, support access, logs, backups, and sub-processors require confirmation for the intended deployment | Production instance, domain, and environment setup are documented; residency, logs, backups, and support scope require confirmation | No residency or regional-availability claim is assumed. Require written region and data-flow answers for Algeria and target expansion regions. |
| Portability and lock-in | Provider tenant, connection, claims, actions, and management APIs are vendor-specific | Organization IDs, session behavior, organization APIs, and frontend components are vendor-specific | Persist only stable internal user IDs and external issuer/subject links; keep provider claims out of domain ownership and role decisions. Export and account-recovery procedures are required. |

Pricing and plan details change. Review the current vendor contract and
availability for launch regions; this comparison is architectural, not a
procurement quote or compliance assessment.

## Independent ZIBEN identity model

- `app.users.id` remains the internal, stable principal identifier.
- A provider-identity link owns unique `(issuer, subject)` external identifiers
  and references one internal user. Email and provider organization claims are
  attributes, not principal keys or tenant authorization.
- `app.tenants` and `app.tenant_memberships` remain ZIBEN-owned. Membership
  status and tenant status are checked on each authorization decision.
- Tenant roles and explicit tenant permission grants remain server-side.
  Provider-side roles may be mapped only by an explicit, audited provisioning
  workflow; they never grant data access directly.
- HTTP authentication validates the bearer access token, then resolves the
  requested tenant against active ZIBEN membership. Organization switching
  changes only the requested context; it does not carry authority by itself.
- Database access receives a separately verified tenant assertion/context on
  the same transaction and connection as the protected query. Jobs must
  reauthorize their actor and tenant when they execute.

The existing user table keys identity directly by issuer/subject. A reviewed
migration to a provider-identity link table is required before provider
replacement is supported; do not claim provider-switch capability before that
migration and user-linking flow are implemented and tested.

## Consequences

- No vendor SDK or secret is added, and no provider is contacted by default.
- `OIDC_ISSUER` and `OIDC_AUDIENCE` must be provided together. Configuring
  either without the other is a startup configuration error. Missing both
  leaves the verifier fail-closed.
- OIDC verification proves who issued the token; it does not establish ZIBEN
  tenant membership or database isolation.
- Membership lookup currently relies on the production database role whose
  application-schema access is being locked down. It cannot provide usable
  authenticated business access until the new database context boundary is
  deployed and PostgreSQL integration tests pass.
- Do not add business controllers, enable data routes, or remove the runtime
  lockout as part of provider evaluation.

## Acceptance criteria before production identity/data access

1. Select the vendor after checking region/data-flow, security evidence,
   enterprise features, contract, pricing, support, and migration/export.
2. Provision production and test instances without putting credentials in
   source control; configure HTTPS issuer and API audience.
3. Test valid and invalid signatures, unsupported algorithms, wrong issuer and
   audience, expiry, not-before, future/long-lived tokens, key rotation, and
   provider/network failure handling using the actual provider's access tokens.
4. Add provider-identity link schema and migration with unique issuer/subject,
   internal-user foreign keys, linking policy, and auditable account recovery.
5. Approve, implement, and test the database tenant-context trust mechanism
   against the selected managed PostgreSQL product. Prove a forged
   `app.tenant_id` or identity setting cannot read or write another tenant.
6. Only after the preceding evidence: apply the guarded runtime lockdown
   migration in each environment, provision least-privilege roles, and expose
   tenant-scoped business APIs.

## References

- [Auth0 JWT documentation](https://auth0.com/docs/secure/tokens/json-web-tokens)
- [Auth0 pricing](https://auth0.com/pricing)
- [Clerk Organizations](https://clerk.com/docs/guides/organizations/overview)
- [Clerk production deployment](https://clerk.com/docs/guides/development/deployment/production)
- [Clerk pricing](https://clerk.com/pricing)
