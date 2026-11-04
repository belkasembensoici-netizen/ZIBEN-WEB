import { X509Certificate } from 'node:crypto';

export interface DatabaseEnvironment {
  DATABASE_URL?: string;
  DATABASE_MIGRATION_URL?: string;
  DATABASE_POOL_MAX?: string;
  DATABASE_IDLE_TIMEOUT_MS?: string;
  DATABASE_CONNECTION_TIMEOUT_MS?: string;
  DATABASE_SSL?: string;
  DATABASE_SSL_CA?: string;
  DATABASE_ALLOW_INSECURE_LOCAL?: string;
}

export interface DatabaseConfiguration {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl: false | { rejectUnauthorized: true; ca?: string };
}

export type DatabaseRole = 'app_runtime' | 'app_test_runtime' | 'db_migrator';

const DEFAULT_POOL_MAX = 10;
const MAX_POOL_MAX = 50;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ALLOWED_DATABASE_ROLES = new Set([
  'app_runtime',
  'app_test_runtime',
  'db_migrator',
]);

export function parsePostgresConnectionString(
  value: string | undefined,
  variableName = 'DATABASE_URL',
): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${variableName} is required`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${variableName} must be a valid PostgreSQL connection URL`,
    );
  }

  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname === '' ||
    url.pathname.length < 2 ||
    url.username === '' ||
    url.password === '' ||
    url.hash !== ''
  ) {
    throw new Error(
      `${variableName} must be a valid PostgreSQL connection URL`,
    );
  }

  if (url.search !== '') {
    throw new Error(
      `${variableName} must not set connection options in its query string; configure them with environment variables`,
    );
  }

  return value;
}

function parseBoundedInteger(
  value: string | undefined,
  variableName: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${variableName} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${variableName} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return parsed;
}

export function parseDatabaseSsl(
  environment: DatabaseEnvironment = process.env,
  hostname?: string,
): DatabaseConfiguration['ssl'] {
  const sslMode = environment.DATABASE_SSL?.trim() ?? 'verify-full';
  const ca = environment.DATABASE_SSL_CA;

  if (sslMode !== 'disable' && sslMode !== 'verify-full') {
    throw new Error('DATABASE_SSL must be either "disable" or "verify-full"');
  }

  if (sslMode === 'disable') {
    if (
      environment.DATABASE_ALLOW_INSECURE_LOCAL !== 'true' ||
      hostname === undefined ||
      !LOCAL_DATABASE_HOSTS.has(hostname.toLowerCase().replace(/^\[|\]$/g, ''))
    ) {
      throw new Error(
        'Disabling database TLS requires DATABASE_ALLOW_INSECURE_LOCAL=true and a loopback database host',
      );
    }
    if (ca !== undefined) {
      throw new Error('DATABASE_SSL_CA requires verified database TLS');
    }
    return false;
  }

  if (environment.DATABASE_ALLOW_INSECURE_LOCAL === 'true') {
    throw new Error(
      'DATABASE_ALLOW_INSECURE_LOCAL=true is only valid with DATABASE_SSL=disable',
    );
  }

  if (ca !== undefined) {
    if (
      ca.trim() === '' ||
      !ca.includes('-----BEGIN CERTIFICATE-----') ||
      !ca.includes('-----END CERTIFICATE-----')
    ) {
      throw new Error('DATABASE_SSL_CA must contain a PEM-encoded certificate');
    }
    try {
      new X509Certificate(ca);
    } catch {
      throw new Error('DATABASE_SSL_CA must contain a valid PEM certificate');
    }
  }

  return ca === undefined
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: true, ca };
}

export function parseDatabaseConfiguration(
  environment: DatabaseEnvironment = process.env,
  options: {
    connectionStringVariable?: 'DATABASE_URL' | 'DATABASE_MIGRATION_URL';
    expectedRole?: DatabaseRole;
  } = {},
): DatabaseConfiguration {
  const connectionString = parsePostgresConnectionString(
    options.connectionStringVariable === undefined
      ? environment.DATABASE_URL
      : environment[options.connectionStringVariable],
    options.connectionStringVariable ?? 'DATABASE_URL',
  );
  const url = new URL(connectionString);
  const expectedRole = options.expectedRole ?? 'app_runtime';
  if (
    !ALLOWED_DATABASE_ROLES.has(expectedRole) ||
    decodeURIComponent(url.username) !== expectedRole
  ) {
    throw new Error(
      `${options.connectionStringVariable ?? 'DATABASE_URL'} must use the expected restricted database role`,
    );
  }

  return {
    connectionString,
    max: parseBoundedInteger(
      environment.DATABASE_POOL_MAX,
      'DATABASE_POOL_MAX',
      DEFAULT_POOL_MAX,
      1,
      MAX_POOL_MAX,
    ),
    idleTimeoutMillis: parseBoundedInteger(
      environment.DATABASE_IDLE_TIMEOUT_MS,
      'DATABASE_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
      1_000,
      300_000,
    ),
    connectionTimeoutMillis: parseBoundedInteger(
      environment.DATABASE_CONNECTION_TIMEOUT_MS,
      'DATABASE_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
      1_000,
      60_000,
    ),
    ssl: parseDatabaseSsl(environment, url.hostname),
  };
}
