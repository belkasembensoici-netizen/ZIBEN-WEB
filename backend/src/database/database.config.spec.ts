import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';
import {
  parseDatabaseConfiguration,
  parsePostgresConnectionString,
} from './database.config.js';

const runtimeConnectionString =
  'postgres://app_runtime:unit-test@db.example.test:5432/nova';

describe('parsePostgresConnectionString', () => {
  it('requires a PostgreSQL connection URL without exposing its value', () => {
    expect(() => parsePostgresConnectionString(undefined)).toThrow(
      'DATABASE_URL is required',
    );

    const invalidUrl = 'not-a-database-url';
    try {
      parsePostgresConnectionString(invalidUrl);
      throw new Error('Expected the invalid URL to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).toContain('DATABASE_URL');
        expect(error.message).not.toContain('not-a-database-url');
      }
    }
  });

  it.each([
    'https://database.example/db',
    'postgres://database.example',
    'postgres://database.example/',
    'not a URL',
    'postgres://app_runtime:unit-test@database.example/nova#fragment',
  ])('rejects invalid connection URL %j', (connectionString) => {
    expect(() => parsePostgresConnectionString(connectionString)).toThrow();
  });

  it('rejects connection options embedded in the database URL', () => {
    expect(() =>
      parsePostgresConnectionString(
        'postgres://app_runtime:unit-test@database.example/nova?sslmode=disable',
      ),
    ).toThrow('must not set connection options');
  });

  it('accepts a PostgreSQL URL without modifying it', () => {
    expect(parsePostgresConnectionString(runtimeConnectionString)).toBe(
      runtimeConnectionString,
    );
  });
});

describe('parseDatabaseConfiguration', () => {
  it('keeps Drizzle Kit configuration generation-only', () => {
    const drizzleConfig = readFileSync(
      new URL('../../drizzle.config.ts', import.meta.url),
      'utf8',
    );
    const packageJson = readFileSync(
      new URL('../../package.json', import.meta.url),
      'utf8',
    );

    expect(drizzleConfig).not.toMatch(/dbCredentials|DATABASE_MIGRATION_URL/);
    expect(packageJson).toContain(
      '"db:migrate": "node --experimental-strip-types src/database/migrate.ts"',
    );
    expect(packageJson).not.toContain('"db:migrate": "drizzle-kit migrate"');
  });

  it('applies bounded defaults with verified TLS independent of NODE_ENV', () => {
    expect(
      parseDatabaseConfiguration({
        DATABASE_URL: runtimeConnectionString,
      }),
    ).toEqual({
      connectionString: runtimeConnectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it('loads the checked-in migration journal and reviewed SQL without connecting', () => {
    const migrations = readMigrationFiles({
      migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
    });

    expect(migrations).toHaveLength(4);
    expect(migrations[0]?.sql).toEqual(
      expect.arrayContaining([
        expect.stringContaining('SET LOCAL ROLE schema_owner'),
        expect.stringContaining('GRANT USAGE ON SCHEMA app'),
      ]),
    );
    expect(migrations[3]?.sql.join('\n')).toContain(
      'REVOKE ALL PRIVILEGES ON SCHEMA app FROM app_runtime',
    );
    expect(migrations[0]?.sql.join('\n')).not.toContain('CREATE SCHEMA');
  });

  it('parses explicit pool bounds and verified TLS', () => {
    expect(
      parseDatabaseConfiguration({
        DATABASE_URL: runtimeConnectionString,
        DATABASE_POOL_MAX: '4',
        DATABASE_IDLE_TIMEOUT_MS: '10000',
        DATABASE_CONNECTION_TIMEOUT_MS: '2000',
        DATABASE_SSL: 'verify-full',
      }),
    ).toEqual({
      connectionString: runtimeConnectionString,
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 2_000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it.each([
    ['DATABASE_POOL_MAX', '', 1, 50],
    ['DATABASE_POOL_MAX', '51', 1, 50],
    ['DATABASE_IDLE_TIMEOUT_MS', '999', 1_000, 300_000],
    ['DATABASE_CONNECTION_TIMEOUT_MS', '60001', 1_000, 60_000],
  ])('rejects invalid %s', (name, value, minimum, maximum) => {
    expect(() =>
      parseDatabaseConfiguration({
        DATABASE_URL: runtimeConnectionString,
        [name]: value,
      }),
    ).toThrow(`${name} must be an integer between ${minimum} and ${maximum}`);
  });

  it('rejects unrecognized TLS modes', () => {
    expect(() =>
      parseDatabaseConfiguration({
        DATABASE_URL: runtimeConnectionString,
        DATABASE_SSL: 'prefer',
      }),
    ).toThrow('DATABASE_SSL must be either "disable" or "verify-full"');
  });

  it('rejects a migration URL as the runtime identity', () => {
    expect(() =>
      parseDatabaseConfiguration({
        DATABASE_URL:
          'postgres://db_migrator:unit-test@db.example.test:5432/nova',
      }),
    ).toThrow('DATABASE_URL must use the expected restricted database role');
  });

  it('accepts the test runtime identity only when explicitly selected', () => {
    const connectionString =
      'postgres://app_test_runtime:unit-test@db.example.test:5432/nova_test';

    expect(() =>
      parseDatabaseConfiguration({ DATABASE_URL: connectionString }),
    ).toThrow('DATABASE_URL must use the expected restricted database role');

    expect(
      parseDatabaseConfiguration(
        { DATABASE_URL: connectionString },
        { expectedRole: 'app_test_runtime' },
      ).connectionString,
    ).toBe(connectionString);
  });

  it('allows insecure TLS only with an explicit loopback development opt-in', () => {
    expect(() =>
      parseDatabaseConfiguration({
        DATABASE_URL: runtimeConnectionString,
        DATABASE_SSL: 'disable',
        DATABASE_ALLOW_INSECURE_LOCAL: 'true',
      }),
    ).toThrow('loopback database host');

    expect(
      parseDatabaseConfiguration({
        DATABASE_URL: 'postgres://app_runtime:unit-test@127.0.0.1:5432/nova',
        DATABASE_SSL: 'disable',
        DATABASE_ALLOW_INSECURE_LOCAL: 'true',
      }).ssl,
    ).toBe(false);
  });

  it('rejects disabled TLS without explicit opt-in', () => {
    expect(() =>
      parseDatabaseConfiguration({
        DATABASE_URL: 'postgres://app_runtime:unit-test@127.0.0.1:5432/nova',
        DATABASE_SSL: 'disable',
      }),
    ).toThrow('DATABASE_ALLOW_INSECURE_LOCAL=true');
  });

  it('rejects invalid CA certificate content without echoing it', () => {
    expect(() =>
      parseDatabaseConfiguration({
        DATABASE_URL: runtimeConnectionString,
        DATABASE_SSL_CA:
          '-----BEGIN CERTIFICATE-----invalid-----END CERTIFICATE-----',
      }),
    ).toThrow('DATABASE_SSL_CA must contain a valid PEM certificate');
  });

  it('passes a valid supplied CA to the TLS client while retaining verification', () => {
    const certificate = rootCertificates[0];
    expect(certificate).toBeDefined();

    expect(
      parseDatabaseConfiguration({
        DATABASE_URL: runtimeConnectionString,
        DATABASE_SSL_CA: certificate,
      }).ssl,
    ).toEqual({ rejectUnauthorized: true, ca: certificate });
  });
});
