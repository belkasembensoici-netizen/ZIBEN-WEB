import { createPublicKey, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import type {
  IdentityVerifier,
  VerifiedIdentity,
} from './tenant-authorization.js';

const MAX_TOKEN_LENGTH = 8_192;
const MAX_DOCUMENT_LENGTH = 256_000;
const CLOCK_SKEW_SECONDS = 60;
const JWKS_CACHE_MS = 5 * 60_000;
const UNKNOWN_KEY_REFRESH_MS = 30_000;
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

export interface OidcEnvironment {
  OIDC_ISSUER?: string;
  OIDC_AUDIENCE?: string;
}

export interface OidcIdentityConfiguration {
  readonly issuer: string;
  readonly audience: string;
}

interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly jwks_uri: string;
}

interface JwksDocument {
  readonly keys: readonly unknown[];
}

interface ProviderJwk {
  readonly [key: string]: unknown;
  readonly alg?: string;
  readonly crv?: string;
  readonly key_ops?: readonly string[];
  readonly kid: string;
  readonly kty: string;
  readonly n?: string;
  readonly use?: string;
  readonly x?: string;
  readonly y?: string;
}

interface JwtHeader {
  readonly alg: 'RS256' | 'ES256';
  readonly b64?: boolean;
  readonly crit?: readonly string[];
  readonly kid: string;
}

interface JwtClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly iat: number;
  readonly nbf?: number;
  readonly azp?: string;
}

interface CachedKeys {
  readonly keys: readonly ProviderJwk[];
  readonly expiresAt: number;
}

export function parseOidcIdentityConfiguration(
  environment: OidcEnvironment,
): OidcIdentityConfiguration | null {
  const issuer = environment.OIDC_ISSUER?.trim();
  const audience = environment.OIDC_AUDIENCE?.trim();

  if (!issuer && !audience) return null;
  if (!issuer || !audience) {
    throw new Error(
      'OIDC_ISSUER and OIDC_AUDIENCE must be configured together',
    );
  }
  if (audience.length > 512) {
    throw new Error('OIDC_AUDIENCE must not exceed 512 characters');
  }

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error('OIDC_ISSUER must be a valid HTTPS issuer URL');
  }

  if (
    issuerUrl.protocol !== 'https:' ||
    !issuerUrl.hostname ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash
  ) {
    throw new Error('OIDC_ISSUER must be a valid HTTPS issuer URL');
  }

  return Object.freeze({ issuer: issuerUrl.href.replace(/\/$/, ''), audience });
}

export class OidcIdentityVerifier implements IdentityVerifier {
  private discovery: OidcDiscoveryDocument | undefined;
  private discoveryExpiresAt = 0;
  private cachedKeys: CachedKeys | undefined;
  private lastUnknownKeyRefreshAt = 0;

  constructor(
    private readonly configuration: OidcIdentityConfiguration,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async verifyBearerToken(token: string): Promise<VerifiedIdentity | null> {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH)
      return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = decodeJson<JwtHeader>(parts[0]);
    const claims = decodeJson<JwtClaims>(parts[1]);
    const signature = decodeBase64Url(parts[2]);
    if (!header || !claims || !signature || !isValidHeader(header)) return null;
    if (!this.hasValidClaims(claims)) return null;

    const keys = await this.getKeys();
    let matchingKeys = keys.filter(
      (key) =>
        key.kid === header.kid &&
        (key.use === undefined || key.use === 'sig') &&
        (!key.key_ops || key.key_ops.includes('verify')) &&
        (!key.alg || key.alg === header.alg) &&
        isKeyCompatible(key, header.alg),
    );

    if (matchingKeys.length !== 1 && this.canRefreshUnknownKey()) {
      this.lastUnknownKeyRefreshAt = this.now();
      matchingKeys = await this.getKeys(true).then((refreshed) =>
        refreshed.filter(
          (key) =>
            key.kid === header.kid &&
            (key.use === undefined || key.use === 'sig') &&
            (!key.key_ops || key.key_ops.includes('verify')) &&
            (!key.alg || key.alg === header.alg) &&
            isKeyCompatible(key, header.alg),
        ),
      );
    }

    if (matchingKeys.length !== 1) return null;
    let publicKey;
    try {
      publicKey = createPublicKey({
        key: matchingKeys[0] as JsonWebKey,
        format: 'jwk',
      });
    } catch {
      throw new Error(
        'The configured OIDC provider returned an invalid signing key',
      );
    }
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii');
    const verified = verify(
      'sha256',
      signingInput,
      header.alg === 'ES256'
        ? { key: publicKey, dsaEncoding: 'ieee-p1363' }
        : publicKey,
      signature,
    );
    if (!verified) return null;

    return Object.freeze({ issuer: claims.iss, subject: claims.sub });
  }

  private hasValidClaims(claims: JwtClaims): boolean {
    if (
      claims.iss !== this.configuration.issuer ||
      typeof claims.sub !== 'string' ||
      claims.sub.trim().length === 0 ||
      claims.sub.length > 512 ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp)
    ) {
      return false;
    }

    const audiences =
      typeof claims.aud === 'string'
        ? [claims.aud]
        : Array.isArray(claims.aud)
          ? claims.aud
          : [];
    if (
      !audiences.every(
        (value) => typeof value === 'string' && value.length > 0,
      ) ||
      !audiences.includes(this.configuration.audience)
    ) {
      return false;
    }
    if (audiences.length > 1 && claims.azp !== this.configuration.audience) {
      return false;
    }

    const nowSeconds = Math.floor(this.now() / 1_000);
    if (claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) return false;
    if (
      claims.nbf !== undefined &&
      (typeof claims.nbf !== 'number' ||
        !Number.isFinite(claims.nbf) ||
        claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS)
    ) {
      return false;
    }
    if (
      typeof claims.iat !== 'number' ||
      !Number.isFinite(claims.iat) ||
      claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS
    ) {
      return false;
    }
    return true;
  }

  private async getKeys(forceRefresh = false): Promise<readonly ProviderJwk[]> {
    const now = this.now();
    if (!forceRefresh && this.cachedKeys && this.cachedKeys.expiresAt > now) {
      return this.cachedKeys.keys;
    }

    const discovery = await this.getDiscovery(forceRefresh);
    const jwks = await this.fetchJson<JwksDocument>(discovery.jwks_uri);
    if (
      !jwks ||
      !Array.isArray(jwks.keys) ||
      jwks.keys.length === 0 ||
      jwks.keys.length > 100
    ) {
      throw new Error('The configured OIDC provider returned an invalid JWKS');
    }

    this.cachedKeys = {
      keys: jwks.keys.filter(isJsonWebKey),
      expiresAt: now + JWKS_CACHE_MS,
    };
    if (this.cachedKeys.keys.length === 0) {
      throw new Error(
        'The configured OIDC provider returned no usable signing keys',
      );
    }
    return this.cachedKeys.keys;
  }

  private async getDiscovery(
    forceRefresh = false,
  ): Promise<OidcDiscoveryDocument> {
    if (
      !forceRefresh &&
      this.discovery &&
      this.discoveryExpiresAt > this.now()
    ) {
      return this.discovery;
    }

    const issuerPath = this.configuration.issuer.replace(/\/+$/, '');
    const discoveryUrl = new URL(
      `${issuerPath}/.well-known/openid-configuration`,
    );
    const document = await this.fetchJson<OidcDiscoveryDocument>(
      discoveryUrl.href,
    );
    if (
      !document ||
      document.issuer !== this.configuration.issuer ||
      !isSecureProviderUrl(document.jwks_uri)
    ) {
      throw new Error(
        'The configured OIDC issuer returned invalid discovery metadata',
      );
    }

    this.discovery = Object.freeze({
      issuer: document.issuer,
      jwks_uri: document.jwks_uri,
    });
    this.discoveryExpiresAt = this.now() + JWKS_CACHE_MS;
    return this.discovery;
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await this.fetcher(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.ok || response.status >= 300) {
        throw new Error(
          `OIDC provider request failed with status ${response.status}`,
        );
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > MAX_DOCUMENT_LENGTH) {
        throw new Error(
          'The configured OIDC provider document exceeds the size limit',
        );
      }
      const text = await readBoundedBody(response, MAX_DOCUMENT_LENGTH);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error('The configured OIDC provider returned invalid JSON');
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private canRefreshUnknownKey(): boolean {
    return this.now() - this.lastUnknownKeyRefreshAt >= UNKNOWN_KEY_REFRESH_MS;
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(
        'The configured OIDC provider document exceeds the size limit',
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function isValidHeader(header: JwtHeader): boolean {
  return (
    typeof header.kid === 'string' &&
    header.kid.length > 0 &&
    header.kid.length <= 256 &&
    header.b64 !== false &&
    (header.crit === undefined || header.crit.length === 0) &&
    (header.alg === 'RS256' || header.alg === 'ES256')
  );
}

function isKeyCompatible(
  key: ProviderJwk,
  algorithm: JwtHeader['alg'],
): boolean {
  if (algorithm === 'RS256')
    return key.kty === 'RSA' && typeof key.n === 'string';
  return (
    key.kty === 'EC' &&
    key.crv === 'P-256' &&
    typeof key.x === 'string' &&
    typeof key.y === 'string'
  );
}

function isJsonWebKey(value: unknown): value is ProviderJwk {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const key = value as Partial<ProviderJwk>;
  return (
    typeof key.kty === 'string' &&
    typeof key.kid === 'string' &&
    key.kid.length > 0 &&
    key.kid.length <= 256 &&
    !['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((name) => name in key) &&
    (key.alg === undefined || typeof key.alg === 'string') &&
    (key.use === undefined || typeof key.use === 'string') &&
    (key.key_ops === undefined ||
      (Array.isArray(key.key_ops) &&
        key.key_ops.every((operation) => typeof operation === 'string')))
  );
}

function isSecureProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function decodeJson<T>(value: string): T | null {
  const decoded = decodeBase64Url(value);
  if (!decoded || decoded.length > MAX_DOCUMENT_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(decoded.toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return Buffer.from(value, 'base64url');
}

export function createOidcIdentityVerifier(
  environment: OidcEnvironment,
): IdentityVerifier {
  const configuration = parseOidcIdentityConfiguration(environment);
  return configuration
    ? new OidcIdentityVerifier(configuration)
    : { verifyBearerToken: async () => null };
}
