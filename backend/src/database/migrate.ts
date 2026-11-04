import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { parseDatabaseConfiguration } from './database.config.ts';
import {
  assertMigrationDatabaseIdentity,
  parseMigrationTarget,
  withMigrationAdvisoryLock,
} from './migration-safety.ts';

interface MigrationIdentityRow {
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

type MigrationFile = ReturnType<typeof readMigrationFiles>[number];

export async function applyMigrationBatch(
  migrations: readonly MigrationFile[],
  lastAppliedAt: number | undefined,
  executeStatement: (statement: string) => Promise<unknown>,
  recordMigration: (hash: string, createdAt: number) => Promise<unknown>,
): Promise<number> {
  let appliedCount = 0;
  for (const migration of migrations) {
    if (
      lastAppliedAt !== undefined &&
      lastAppliedAt >= migration.folderMillis
    ) {
      continue;
    }

    await executeStatement('SET LOCAL ROLE schema_owner');
    for (const statement of migration.sql) {
      await executeStatement(statement);
    }
    await executeStatement('RESET ROLE');
    await recordMigration(migration.hash, migration.folderMillis);
    appliedCount += 1;
  }
  return appliedCount;
}

export async function applyPendingMigrations(
  client: PoolClient,
  migrationsFolder: string,
): Promise<number> {
  const migrations = readMigrationFiles({ migrationsFolder });
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  const ledger = await client.query<{ created_at: string | null }>(`
    SELECT created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const lastMigration = ledger.rows[0];
  if (lastMigration?.created_at === null) {
    throw new Error('Drizzle migration ledger contains an invalid timestamp');
  }
  const lastAppliedAt =
    lastMigration === undefined ? undefined : Number(lastMigration.created_at);
  if (
    lastAppliedAt !== undefined &&
    (!Number.isSafeInteger(lastAppliedAt) || lastAppliedAt < 0)
  ) {
    throw new Error('Drizzle migration ledger contains an invalid timestamp');
  }

  await client.query('BEGIN');
  try {
    const appliedCount = await applyMigrationBatch(
      migrations,
      lastAppliedAt,
      (statement) => client.query(statement),
      (hash, createdAt) =>
        client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
           VALUES ($1, $2)`,
          [hash, createdAt],
        ),
    );
    await client.query('COMMIT');
    return appliedCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function verifySchemaOwnerMembership(
  client: PoolClient,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE schema_owner');
    const result = await client.query<{ role: string }>(
      'SELECT current_user AS role',
    );
    if (result.rows[0]?.role !== 'schema_owner') {
      throw new Error('Migration role cannot assume schema_owner');
    }
  } finally {
    await client.query('ROLLBACK');
  }
}

async function runMigrations(): Promise<void> {
  const target = parseMigrationTarget();
  const configuration = parseDatabaseConfiguration(process.env, {
    connectionStringVariable: 'DATABASE_MIGRATION_URL',
    expectedRole: target.role,
  });
  const pool = new Pool({
    connectionString: configuration.connectionString,
    max: Math.max(configuration.max, 2),
    idleTimeoutMillis: configuration.idleTimeoutMillis,
    connectionTimeoutMillis: configuration.connectionTimeoutMillis,
    ssl: configuration.ssl,
    application_name: 'ziben-nova-migration-runner',
  });

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const result = await client.query<MigrationIdentityRow>(`
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
          select ssl
          from pg_stat_ssl
          where pid = pg_backend_pid()
        ), false) as ssl,
        (
          select pg_get_userbyid(nspowner)
          from pg_namespace
          where nspname = 'app'
        ) as "appSchemaOwner",
        (
          select pg_get_userbyid(nspowner)
          from pg_namespace
          where nspname = 'drizzle'
        ) as "ledgerSchemaOwner",
        (
          select pg_get_userbyid(table_info.tableowner::regrole::oid)
          from pg_tables as table_info
          where schemaname = 'drizzle'
            and tablename = '__drizzle_migrations'
        ) as "ledgerTableOwner"
      from pg_roles as role_info
      where role_info.rolname = current_user
    `);
    const identity = result.rows[0];
    if (!identity) {
      throw new Error('Unable to verify the connected migration identity');
    }

    assertMigrationDatabaseIdentity(identity, target);
    await verifySchemaOwnerMembership(client);

    const connectedClient = client;
    const appliedCount = await withMigrationAdvisoryLock(connectedClient, () =>
      applyPendingMigrations(
        connectedClient,
        fileURLToPath(new URL('./migrations', import.meta.url)),
      ),
    );
    console.info(
      `Database migrations completed (${appliedCount} applied) for ${target.environment}/${target.database}`,
    );
  } finally {
    client?.release();
    await pool.end();
  }
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runMigrations().catch((error: unknown) => {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z0-9]+$/.test(error.code)
        ? ` (code ${error.code})`
        : '';
    console.error(
      `Database migration failed${code}; detailed errors are withheld to protect connection secrets.`,
    );
    process.exitCode = 1;
  });
}
