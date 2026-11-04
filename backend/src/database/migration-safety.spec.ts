import { describe, expect, it, vi } from 'vitest';
import {
  assertDatabaseTarget,
  assertMigrationDatabaseIdentity,
  parseMigrationTarget,
  parseTestDatabaseTarget,
  withMigrationAdvisoryLock,
} from './migration-safety.js';

const migrationUrl =
  'postgres://db_migrator:unit-test@postgres.example.test:5432/nova_stage';

const migrationEnvironment: NodeJS.ProcessEnv = {
  DATABASE_MIGRATION_URL: migrationUrl,
  DATABASE_MIGRATION_TARGET_ENV: 'staging',
  DATABASE_MIGRATION_EXPECTED_HOST: 'postgres.example.test',
  DATABASE_MIGRATION_EXPECTED_PORT: '5432',
  DATABASE_MIGRATION_EXPECTED_DATABASE: 'nova_stage',
};

const validIdentity = {
  role: 'db_migrator',
  database: 'nova_stage',
  roleCanLogin: true,
  isSuperuser: false,
  canCreateDatabases: false,
  canCreateRoles: false,
  canCreateDatabaseSchemas: false,
  bypassesRls: false,
  canCreateLedgerObjects: true,
  canAssumeSchemaOwner: true,
  schemaOwnerCanCreateObjects: true,
  schemaOwnerRestricted: true,
  ssl: true,
  appSchemaOwner: 'schema_owner',
  ledgerSchemaOwner: 'db_migrator',
  ledgerTableOwner: null,
};

describe('migration target safeguards', () => {
  it('requires explicit environment and target identity and binds the URL to them', () => {
    expect(parseMigrationTarget(migrationEnvironment)).toEqual({
      host: 'postgres.example.test',
      port: 5432,
      database: 'nova_stage',
      role: 'db_migrator',
      environment: 'staging',
    });

    expect(() =>
      parseMigrationTarget({
        ...migrationEnvironment,
        DATABASE_MIGRATION_EXPECTED_HOST: undefined,
      }),
    ).toThrow('DATABASE_MIGRATION_EXPECTED_HOST');

    expect(() =>
      parseMigrationTarget({
        ...migrationEnvironment,
        DATABASE_MIGRATION_URL:
          'postgres://db_migrator:unit-test@unrelated.example.test:5432/nova_stage',
      }),
    ).toThrow('does not match the explicitly approved');
  });

  it('requires a separate production approval signal', () => {
    const productionEnvironment = {
      ...migrationEnvironment,
      DATABASE_MIGRATION_TARGET_ENV: 'production',
    };

    expect(() => parseMigrationTarget(productionEnvironment)).toThrow(
      'DATABASE_MIGRATION_PRODUCTION_APPROVED=true',
    );
    expect(() =>
      parseMigrationTarget({
        ...productionEnvironment,
        DATABASE_MIGRATION_PRODUCTION_APPROVED: 'true',
      }),
    ).not.toThrow();
  });

  it.each([
    ['wrong role', { role: 'app_runtime' }],
    ['wrong database', { database: 'nova_prod' }],
    ['non-login migration role', { roleCanLogin: false }],
    ['superuser', { isSuperuser: true }],
    ['CREATEDB', { canCreateDatabases: true }],
    ['CREATEROLE', { canCreateRoles: true }],
    ['database-level CREATE', { canCreateDatabaseSchemas: true }],
    ['BYPASSRLS', { bypassesRls: true }],
    ['missing ledger schema CREATE', { canCreateLedgerObjects: false }],
    ['missing owner membership', { canAssumeSchemaOwner: false }],
    ['missing schema-owner CREATE', { schemaOwnerCanCreateObjects: false }],
    [
      'login-capable or elevated schema owner',
      { schemaOwnerRestricted: false },
    ],
    ['unencrypted connection', { ssl: false }],
    ['missing or wrong app schema owner', { appSchemaOwner: null }],
    ['wrong app schema owner', { appSchemaOwner: 'db_migrator' }],
    ['wrong ledger owner', { ledgerSchemaOwner: 'postgres' }],
    ['wrong ledger table owner', { ledgerTableOwner: 'postgres' }],
  ])('rejects migration identity with %s', (_case, overrides) => {
    expect(() =>
      assertMigrationDatabaseIdentity(
        { ...validIdentity, ...overrides },
        parseMigrationTarget(migrationEnvironment),
      ),
    ).toThrow();
  });

  it('accepts a restricted migration role with expected schema ownership', () => {
    expect(() =>
      assertMigrationDatabaseIdentity(
        {
          ...validIdentity,
          ledgerTableOwner: 'db_migrator',
        },
        parseMigrationTarget(migrationEnvironment),
      ),
    ).not.toThrow();
  });

  it('requires exact cloud test endpoint, database, and role', () => {
    const target = parseTestDatabaseTarget({
      TEST_DATABASE_HOST: 'ci-postgres.example.test',
      TEST_DATABASE_PORT: '6432',
      TEST_DATABASE_NAME: 'nova_ci_test',
    });
    const connection =
      'postgres://app_test_runtime:unit-test@ci-postgres.example.test:6432/nova_ci_test';

    expect(
      assertDatabaseTarget(connection, target, 'TEST_DATABASE_URL', '_test'),
    ).toBe(connection);

    expect(() =>
      assertDatabaseTarget(
        connection,
        { ...target, host: 'production.example.test' },
        'TEST_DATABASE_URL',
      ),
    ).toThrow('does not match the explicitly approved');
    expect(() =>
      parseTestDatabaseTarget({
        TEST_DATABASE_HOST: 'ci-postgres.example.test',
        TEST_DATABASE_PORT: '5432',
        TEST_DATABASE_NAME: 'nova_production',
      }),
    ).toThrow('ending in "_test"');
    expect(() =>
      parseTestDatabaseTarget({
        TEST_DATABASE_HOST: '127.0.0.1',
        TEST_DATABASE_PORT: '5432',
        TEST_DATABASE_NAME: 'nova_ci_test',
      }),
    ).toThrow('not a local loopback host');
  });

  it('releases the advisory lock after success and failure', async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined) };
    const operation = vi.fn().mockResolvedValue('migrated');

    await expect(withMigrationAdvisoryLock(client, operation)).resolves.toBe(
      'migrated',
    );
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_lock($1, $2)',
      [1_385_249_104, 1],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock($1, $2)',
      [1_385_249_104, 1],
    );

    client.query.mockClear();
    const failure = new Error('test failure');
    await expect(
      withMigrationAdvisoryLock(client, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});
