import { Test, TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDatabaseConfiguration } from './../src/database/database.config.js';
import { DatabaseModule } from './../src/database/database.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { TenantAuthorizationService } from './../src/identity/tenant-authorization.js';
import { TenantMembershipRepository } from './../src/identity/tenant-membership.repository.js';
import {
  applyPendingMigrations,
  verifySchemaOwnerMembership,
} from './../src/database/migrate.ts';
import {
  assertDatabaseTarget,
  assertMigrationDatabaseIdentity,
  migrationTargetForTest,
  parseTestDatabaseTarget,
  withMigrationAdvisoryLock,
} from './../src/database/migration-safety.js';
import {
  DATABASE_CONFIGURATION,
  DRIZZLE_DATABASE,
} from './../src/database/database.tokens.js';
import type { Database } from './../src/database/database.types.js';

const integrationEnabled = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const testUrl = process.env.TEST_DATABASE_URL;
const testMigrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;

if (integrationEnabled && (!testUrl || !testMigrationUrl)) {
  throw new Error(
    'Database integration tests require TEST_DATABASE_URL and TEST_DATABASE_MIGRATION_URL',
  );
}

if (integrationEnabled) {
  const testTarget = parseTestDatabaseTarget(process.env);
  assertDatabaseTarget(testUrl, testTarget, 'TEST_DATABASE_URL', '_test');
  assertDatabaseTarget(
    testMigrationUrl,
    migrationTargetForTest(testTarget),
    'TEST_DATABASE_MIGRATION_URL',
    '_test',
  );
}

describe.skipIf(!integrationEnabled)('PostgreSQL database integration', () => {
  let module: TestingModule;
  let database: Database;
  let service: DatabaseService;
  let migrationIdentity:
    | {
        role: string;
        database: string;
        roleCanLogin: boolean;
        isSuperuser: boolean;
        canCreateDatabases: boolean;
        canCreateRoles: boolean;
        canCreateDatabaseSchemas: boolean;
        bypassesRls: boolean;
        canCreateLedgerObjects: boolean;
        canAssumeSchemaOwner: boolean;
        schemaOwnerCanCreateObjects: boolean;
        schemaOwnerRestricted: boolean;
        ssl: boolean;
        appSchemaOwner: string | null;
        ledgerSchemaOwner: string | null;
        ledgerTableOwner: string | null;
      }
    | undefined;
  const originalEnvironment = new Map<string, string | undefined>(
    ['DATABASE_URL', 'DATABASE_POOL_MAX'].map((name) => [
      name,
      process.env[name],
    ]),
  );

  beforeAll(async () => {
    const testTarget = parseTestDatabaseTarget(process.env);
    const migrationTarget = migrationTargetForTest(testTarget);
    const runtimeUrl = assertDatabaseTarget(
      testUrl,
      testTarget,
      'TEST_DATABASE_URL',
      '_test',
    );
    const migrationUrl = assertDatabaseTarget(
      testMigrationUrl,
      migrationTarget,
      'TEST_DATABASE_MIGRATION_URL',
      '_test',
    );
    const migrationConfiguration = parseDatabaseConfiguration(
      {
        ...process.env,
        DATABASE_MIGRATION_URL: migrationUrl,
        DATABASE_POOL_MAX: '2',
      },
      {
        connectionStringVariable: 'DATABASE_MIGRATION_URL',
        expectedRole: migrationTarget.role,
      },
    );
    const migrationPool = new Pool({
      connectionString: migrationConfiguration.connectionString,
      max: Math.max(migrationConfiguration.max, 2),
      idleTimeoutMillis: migrationConfiguration.idleTimeoutMillis,
      connectionTimeoutMillis: migrationConfiguration.connectionTimeoutMillis,
      ssl: migrationConfiguration.ssl,
      application_name: 'ziben-nova-db-integration-migrator',
    });

    let migrationClient: PoolClient | undefined;
    try {
      const connectedClient = await migrationPool.connect();
      migrationClient = connectedClient;
      const identityResult = await connectedClient.query<
        NonNullable<typeof migrationIdentity>
      >(`
        select current_user as role,
          current_database() as database,
          role_info.rolcanlogin as "roleCanLogin",
          role_info.rolsuper as "isSuperuser",
          role_info.rolcreatedb as "canCreateDatabases",
          role_info.rolcreaterole as "canCreateRoles",
          has_database_privilege(current_user, current_database(), 'CREATE') as "canCreateDatabaseSchemas",
          role_info.rolbypassrls as "bypassesRls",
          coalesce((
            select has_schema_privilege(current_user, schema_info.oid, 'CREATE')
            from pg_namespace as schema_info
            where schema_info.nspname = 'drizzle'
          ), false) as "canCreateLedgerObjects",
          coalesce((
            select pg_has_role(current_user, owner_role.oid, 'MEMBER')
            from pg_roles as owner_role
            where owner_role.rolname = 'schema_owner'
          ), false) as "canAssumeSchemaOwner",
          coalesce((
            select has_schema_privilege(owner_role.oid, schema_info.oid, 'CREATE')
            from pg_roles as owner_role
            join pg_namespace as schema_info on schema_info.nspname = 'app'
            where owner_role.rolname = 'schema_owner'
          ), false) as "schemaOwnerCanCreateObjects",
          coalesce((
            select not owner_role.rolcanlogin
              and not owner_role.rolsuper
              and not owner_role.rolbypassrls
              and not owner_role.rolcreatedb
              and not owner_role.rolcreaterole
              and not has_database_privilege(owner_role.oid, current_database(), 'CREATE')
            from pg_roles as owner_role
            where owner_role.rolname = 'schema_owner'
          ), false) as "schemaOwnerRestricted",
          coalesce((
            select ssl from pg_stat_ssl where pid = pg_backend_pid()
          ), false) as ssl,
          (
            select pg_get_userbyid(nspowner)
            from pg_namespace where nspname = 'app'
          ) as "appSchemaOwner",
          (
            select pg_get_userbyid(nspowner)
            from pg_namespace where nspname = 'drizzle'
          ) as "ledgerSchemaOwner",
          (
            select tableowner::text
            from pg_tables
            where schemaname = 'drizzle'
              and tablename = '__drizzle_migrations'
          ) as "ledgerTableOwner"
        from pg_roles as role_info
        where role_info.rolname = current_user
      `);
      migrationIdentity = identityResult.rows[0];
      if (!migrationIdentity) {
        throw new Error('Unable to verify the migration database identity');
      }
      assertMigrationDatabaseIdentity(migrationIdentity, migrationTarget);
      await verifySchemaOwnerMembership(connectedClient);

      await withMigrationAdvisoryLock(connectedClient, () =>
        applyPendingMigrations(
          connectedClient,
          fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
        ),
      );
    } finally {
      migrationClient?.release();
      await migrationPool.end();
    }

    const runtimeConfiguration = parseDatabaseConfiguration(
      {
        ...process.env,
        DATABASE_URL: runtimeUrl,
        DATABASE_POOL_MAX: '1',
      },
      { expectedRole: testTarget.role },
    );
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_POOL_MAX = '1';

    try {
      module = await Test.createTestingModule({
        imports: [DatabaseModule],
      })
        .overrideProvider(DATABASE_CONFIGURATION)
        .useValue(runtimeConfiguration)
        .compile();
      await module.init();
      database = module.get<Database>(DRIZZLE_DATABASE);
      service = module.get(DatabaseService);
      await database.execute(sql`select 1`);
    } catch (error) {
      if (module) {
        await module.close();
      }
      throw error;
    }
  });

  afterAll(async () => {
    try {
      if (module) {
        await module.close();
      }
    } finally {
      for (const [name, value] of originalEnvironment) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it('uses a non-superuser migration role without BYPASSRLS', () => {
    expect(migrationIdentity).toMatchObject({
      role: 'db_migrator',
      database: process.env.TEST_DATABASE_NAME,
      isSuperuser: false,
      bypassesRls: false,
      canCreateDatabases: false,
      canCreateRoles: false,
      canCreateDatabaseSchemas: false,
      canCreateLedgerObjects: true,
      canAssumeSchemaOwner: true,
      schemaOwnerCanCreateObjects: true,
      schemaOwnerRestricted: true,
      ssl: true,
    });
  });

  it('applies the reviewed migration using the migration role', async () => {
    const result = await database.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );

    expect(Number(result.rows[0]?.count)).toBeGreaterThan(0);
  });

  it('keeps runtime credentials out of schema ownership and DDL privileges', async () => {
    const result = await database.execute(sql`
      select current_user as role_name,
        current_database() as database_name,
        has_database_privilege(current_user, current_database(), 'CREATE') as can_create_schema,
        has_database_privilege(current_user, current_database(), 'TEMP') as can_create_temp,
        has_schema_privilege(current_user, 'app', 'CREATE') as can_create_objects,
        has_schema_privilege(current_user, 'app', 'USAGE') as can_use_schema,
        has_schema_privilege(current_user, 'drizzle', 'USAGE') as can_use_ledger,
        has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'SELECT') as can_read_ledger,
        (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl,
        (select rolsuper from pg_roles where rolname = current_user) as is_superuser,
        (select rolbypassrls from pg_roles where rolname = current_user) as bypasses_rls
    `);

    expect(result.rows[0]).toMatchObject({
      role_name: 'app_test_runtime',
      database_name: process.env.TEST_DATABASE_NAME,
      can_create_schema: false,
      can_create_temp: true,
      can_create_objects: false,
      can_use_schema: true,
      can_use_ledger: true,
      can_read_ledger: true,
      ssl: true,
      is_superuser: false,
      bypasses_rls: false,
    });
  });

  it('denies the production runtime role access to tenant data until a trusted database context is configured', async () => {
    const result = await database.execute(sql`
      select
        has_schema_privilege('app_runtime', 'app', 'USAGE') as can_use_app_schema,
        has_table_privilege('app_runtime', 'app.tenants', 'SELECT') as can_read_tenants,
        has_table_privilege('app_runtime', 'app.products', 'INSERT') as can_insert_products,
        has_table_privilege('app_runtime', 'app.orders', 'UPDATE') as can_update_orders
    `);

    expect(result.rows[0]).toEqual({
      can_use_app_schema: false,
      can_read_tenants: false,
      can_insert_products: false,
      can_update_orders: false,
    });
  });

  it('commits transactions, rolls back failures, and releases the connection', async () => {
    await service.transaction(async (transaction) => {
      await transaction.execute(
        sql`create temporary table phase1d_commit_probe (value text)`,
      );
    });

    const committed = await database.execute(
      sql`select to_regclass('pg_temp.phase1d_commit_probe') as table_name`,
    );
    expect(committed.rows[0]?.table_name).toBe('phase1d_commit_probe');

    const failure = new Error('rollback probe');
    await expect(
      service.transaction(async (transaction) => {
        await transaction.execute(
          sql`create temporary table phase1d_rollback_probe (value text)`,
        );
        throw failure;
      }),
    ).rejects.toBe(failure);

    const rolledBack = await database.execute(
      sql`select to_regclass('pg_temp.phase1d_rollback_probe') as table_name`,
    );
    expect(rolledBack.rows[0]?.table_name).toBeNull();
  });

  it('clears transaction-local tenant context before a pooled connection is reused', async () => {
    const authorization = new TenantAuthorizationService(
      {
        verifyBearerToken: async () => ({
          subject: 'integration-subject',
          issuer: 'integration-issuer',
        }),
      },
      {
        findMembership: async () => ({
          tenantId: 'integration-tenant',
          userId: '00000000-0000-4000-8000-000000000001',
          role: 'owner',
          status: 'active',
        }),
      },
    );
    const verifiedContext = await authorization.authorize(
      'integration-token',
      'integration-tenant',
    );
    const context = await service.tenantTransaction(
      verifiedContext,
      async (transaction) =>
        transaction.execute(
          sql`select current_setting('app.tenant_id', true) as tenant_id`,
        ),
    );

    expect(context.rows[0]?.tenant_id).toBe('integration-tenant');

    const outsideTransaction = await database.execute(
      sql`select current_setting('app.tenant_id', true) as tenant_id`,
    );
    expect(outsideTransaction.rows[0]?.tenant_id).toBeNull();
  });

  it('forces RLS on every tenant-owned table', async () => {
    const result = await database.execute(sql`
      select count(*)::int as count
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relkind = 'r'
        and relation.relname <> 'permissions'
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    `);

    expect(Number(result.rows[0]?.count)).toBe(20);
  });

  it('denies cross-tenant reads and writes and cross-tenant foreign keys', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userId = randomUUID();
    const issuer = `integration-${randomUUID()}`;
    const subject = `subject-${randomUUID()}`;
    let verifiedIdentity:
      Parameters<DatabaseService['identityTransaction']>[0] | undefined;
    const authorization = new TenantAuthorizationService(
      { verifyBearerToken: async () => ({ subject, issuer }) },
      {
        findMembership: async (identity, tenantId) => {
          verifiedIdentity = identity;
          return {
            tenantId,
            userId,
            role: 'owner',
            status: 'active',
          };
        },
      },
    );
    const contextA = await authorization.authorize(
      'integration-token',
      tenantA,
    );
    const identityA = verifiedIdentity;
    const contextB = await authorization.authorize(
      'integration-token',
      tenantB,
    );
    if (!identityA) throw new Error('Verified test identity was not created');

    await service.tenantTransaction(contextA, (transaction) =>
      transaction.execute(
        sql`insert into app.tenants (id, name, slug) values (${tenantA}::uuid, 'Tenant A', ${tenantA})`,
      ),
    );
    await service.tenantTransaction(contextB, (transaction) =>
      transaction.execute(
        sql`insert into app.tenants (id, name, slug) values (${tenantB}::uuid, 'Tenant B', ${tenantB})`,
      ),
    );
    await service.identityTransaction(identityA, tenantA, (transaction) =>
      transaction.execute(
        sql`insert into app.users (id, identity_issuer, identity_subject) values (${userId}::uuid, ${issuer}, ${subject})`,
      ),
    );
    await service.tenantTransaction(contextA, (transaction) =>
      transaction.execute(
        sql`insert into app.tenant_memberships (tenant_id, user_id, role) values (${tenantA}::uuid, ${userId}::uuid, 'owner')`,
      ),
    );
    await service.tenantTransaction(contextB, (transaction) =>
      transaction.execute(
        sql`insert into app.tenant_memberships (tenant_id, user_id, role) values (${tenantB}::uuid, ${userId}::uuid, 'owner')`,
      ),
    );
    const membershipRepository = new TenantMembershipRepository(service);
    await expect(
      membershipRepository.findMembership(identityA, tenantA),
    ).resolves.toMatchObject({
      tenantId: tenantA,
      userId,
      role: 'owner',
      status: 'active',
    });
    await expect(
      membershipRepository.hasPermission(contextA, 'products:read'),
    ).resolves.toBe(false);
    await service.tenantTransaction(contextA, (transaction) =>
      transaction.execute(sql`
        insert into app.tenant_role_permissions (tenant_id, role, permission_id)
        select ${tenantA}::uuid, 'owner', id
        from app.permissions
        where key = 'products:read'
      `),
    );
    await expect(
      membershipRepository.hasPermission(contextA, 'products:read'),
    ).resolves.toBe(true);

    const customerB = randomUUID();
    await service.tenantTransaction(contextB, (transaction) =>
      transaction.execute(
        sql`insert into app.customers (id, tenant_id, display_name) values (${customerB}::uuid, ${tenantB}::uuid, 'Tenant B customer')`,
      ),
    );

    const hiddenCustomer = await service.tenantTransaction(
      contextA,
      (transaction) =>
        transaction.execute(
          sql`select id from app.customers where id = ${customerB}::uuid`,
        ),
    );
    expect(hiddenCustomer.rows).toHaveLength(0);

    const hiddenMembership = await service.tenantTransaction(
      contextA,
      (transaction) =>
        transaction.execute(
          sql`select id from app.tenant_memberships where tenant_id = ${tenantB}::uuid`,
        ),
    );
    expect(hiddenMembership.rows).toHaveLength(0);

    await expect(
      service.tenantTransaction(contextA, (transaction) =>
        transaction.execute(
          sql`insert into app.customers (tenant_id, display_name) values (${tenantB}::uuid, 'Cross-tenant write')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const customerA = randomUUID();
    const orderId = randomUUID();
    await service.tenantTransaction(contextA, (transaction) =>
      transaction.execute(
        sql`insert into app.customers (id, tenant_id, display_name) values (${customerA}::uuid, ${tenantA}::uuid, 'Tenant A customer')`,
      ),
    );
    await expect(
      service.tenantTransaction(contextA, (transaction) =>
        transaction.execute(
          sql`insert into app.orders (id, tenant_id, customer_id, currency, subtotal_minor, total_minor) values (${orderId}::uuid, ${tenantA}::uuid, ${customerB}::uuid, 'DZD', 100, 100)`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const withoutContext = await database.execute(
      sql`select id from app.customers where tenant_id = ${tenantB}::uuid`,
    );
    expect(withoutContext.rows).toHaveLength(0);
  });
});
