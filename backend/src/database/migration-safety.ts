import { isIP } from 'node:net';
import {
  parsePostgresConnectionString,
  type DatabaseRole,
} from './database.config.ts';

export interface DatabaseTarget {
  host: string;
  port: number;
  database: string;
  role: DatabaseRole;
}

export interface MigrationTarget extends DatabaseTarget {
  environment: 'development' | 'staging' | 'production' | 'test';
}

export interface MigrationDatabaseIdentity {
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

export interface AdvisoryLockClient {
  query(query: string, values: number[]): Promise<unknown>;
}

const MIGRATION_LOCK_CLASS = 1_385_249_104;
const MIGRATION_LOCK_ID = 1;
const MIGRATION_ENVIRONMENTS = new Set([
  'development',
  'staging',
  'production',
]);

function normalizedHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizedHost(host);
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    (isIP(normalized) === 4 && normalized.startsWith('127.'))
  );
}

function parseExpectedPort(
  value: string | undefined,
  variable: string,
): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) {
    throw new Error(`${variable} must be a port between 1 and 65535`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variable} must be a port between 1 and 65535`);
  }
  return port;
}

export function assertDatabaseTarget(
  connectionString: string | undefined,
  target: DatabaseTarget,
  variableName: string,
  requiredDatabaseSuffix?: string,
): string {
  const connection = parsePostgresConnectionString(
    connectionString,
    variableName,
  );
  const url = new URL(connection);
  const database = decodeURIComponent(url.pathname.slice(1));
  const port = url.port === '' ? 5432 : Number(url.port);

  if (
    normalizedHost(url.hostname) !== normalizedHost(target.host) ||
    port !== target.port ||
    database !== target.database ||
    decodeURIComponent(url.username) !== target.role
  ) {
    throw new Error(
      `${variableName} does not match the explicitly approved database host, port, database, and role`,
    );
  }

  if (requiredDatabaseSuffix && !database.endsWith(requiredDatabaseSuffix)) {
    throw new Error(
      `${variableName} must target a database ending in "${requiredDatabaseSuffix}"`,
    );
  }

  return connection;
}

export function parseMigrationTarget(
  environment: NodeJS.ProcessEnv = process.env,
): MigrationTarget {
  const targetEnvironment = environment.DATABASE_MIGRATION_TARGET_ENV;
  if (
    targetEnvironment === undefined ||
    !MIGRATION_ENVIRONMENTS.has(targetEnvironment)
  ) {
    throw new Error(
      'DATABASE_MIGRATION_TARGET_ENV must be development, staging, or production',
    );
  }

  const host = environment.DATABASE_MIGRATION_EXPECTED_HOST?.trim();
  const database = environment.DATABASE_MIGRATION_EXPECTED_DATABASE?.trim();
  if (!host || !database) {
    throw new Error(
      'DATABASE_MIGRATION_EXPECTED_HOST and DATABASE_MIGRATION_EXPECTED_DATABASE are required',
    );
  }

  const port = parseExpectedPort(
    environment.DATABASE_MIGRATION_EXPECTED_PORT,
    'DATABASE_MIGRATION_EXPECTED_PORT',
  );

  if (
    targetEnvironment === 'production' &&
    environment.DATABASE_MIGRATION_PRODUCTION_APPROVED !== 'true'
  ) {
    throw new Error(
      'Production migrations require DATABASE_MIGRATION_PRODUCTION_APPROVED=true from a protected deployment environment',
    );
  }

  const target: MigrationTarget = {
    host,
    port,
    database,
    role: 'db_migrator',
    environment: targetEnvironment as MigrationTarget['environment'],
  };
  assertDatabaseTarget(
    environment.DATABASE_MIGRATION_URL,
    target,
    'DATABASE_MIGRATION_URL',
  );
  return target;
}

export function assertMigrationDatabaseIdentity(
  identity: MigrationDatabaseIdentity,
  target: MigrationTarget,
): void {
  if (identity.role !== target.role || identity.database !== target.database) {
    throw new Error(
      'Connected PostgreSQL role or database does not match the approved migration target',
    );
  }
  if (identity.isSuperuser || identity.bypassesRls) {
    throw new Error('Migration role must not be superuser or bypass RLS');
  }
  if (
    !identity.roleCanLogin ||
    identity.canCreateDatabases ||
    identity.canCreateRoles ||
    identity.canCreateDatabaseSchemas
  ) {
    throw new Error(
      'Migration role must be login-capable without CREATEDB, CREATEROLE, or database-level CREATE',
    );
  }
  if (
    !identity.canCreateLedgerObjects ||
    !identity.canAssumeSchemaOwner ||
    !identity.schemaOwnerCanCreateObjects ||
    !identity.schemaOwnerRestricted
  ) {
    throw new Error(
      'Migration role requires CREATE on the pre-provisioned drizzle schema, restricted schema_owner membership, and CREATE on app for schema_owner without elevated role attributes',
    );
  }
  if (!identity.ssl) {
    throw new Error('Migration connection must use verified TLS');
  }
  if (identity.appSchemaOwner !== 'schema_owner') {
    throw new Error('Existing app schema must be owned by schema_owner');
  }
  if (identity.ledgerSchemaOwner !== 'db_migrator') {
    throw new Error(
      'Existing Drizzle ledger schema must be owned by db_migrator',
    );
  }
  if (
    identity.ledgerTableOwner !== null &&
    identity.ledgerTableOwner !== 'db_migrator'
  ) {
    throw new Error(
      'Existing Drizzle migration ledger must be owned by db_migrator',
    );
  }
}

export async function withMigrationAdvisoryLock<T>(
  client: AdvisoryLockClient,
  migrate: () => Promise<T>,
): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1, $2)', [
    MIGRATION_LOCK_CLASS,
    MIGRATION_LOCK_ID,
  ]);
  try {
    return await migrate();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [
      MIGRATION_LOCK_CLASS,
      MIGRATION_LOCK_ID,
    ]);
  }
}

export function parseTestDatabaseTarget(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseTarget {
  const host = environment.TEST_DATABASE_HOST?.trim();
  const database = environment.TEST_DATABASE_NAME?.trim();
  if (!host || !database || !database.endsWith('_test')) {
    throw new Error(
      'TEST_DATABASE_HOST and TEST_DATABASE_NAME ending in "_test" are required',
    );
  }
  if (isLoopbackHost(host)) {
    throw new Error(
      'Integration tests require a dedicated cloud database endpoint, not a local loopback host',
    );
  }
  const port = parseExpectedPort(
    environment.TEST_DATABASE_PORT,
    'TEST_DATABASE_PORT',
  );
  return { host, port, database, role: 'app_test_runtime' };
}

export function migrationTargetForTest(
  target: DatabaseTarget,
): MigrationTarget {
  return { ...target, role: 'db_migrator', environment: 'test' };
}
