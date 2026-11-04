import { createSign, generateKeyPairSync } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createOidcIdentityVerifier,
  OidcIdentityVerifier,
  parseOidcIdentityConfiguration,
} from './oidc-identity-verifier.js';

const issuer = 'https://identity.example.test';
const audience = 'ziben-api';
const now = 1_800_000_000_000;

function createRsaFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    privateKey,
    jwk: {
      ...publicKey.export({ format: 'jwk' }),
      kid: 'rsa-key',
      alg: 'RS256',
    },
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signToken(
  privateKey: KeyObject,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = { alg: 'RS256', kid: 'rsa-key' },
): string {
  const payload = {
    iss: issuer,
    sub: 'provider-user-123',
    aud: audience,
    iat: Math.floor(now / 1_000),
    exp: Math.floor(now / 1_000) + 600,
    ...claims,
  };
  const input = `${encode(header)}.${encode(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey).toString('base64url')}`;
}

function createFetcher(keys: readonly JsonWebKey[]) {
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const body = url.includes('.well-known')
      ? { issuer, jwks_uri: `${issuer}/jwks` }
      : { keys };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('parseOidcIdentityConfiguration', () => {
  it('keeps identity verification deny-by-default when configuration is absent', async () => {
    const verifier = createOidcIdentityVerifier({});
    await expect(verifier.verifyBearerToken('token')).resolves.toBeNull();
    expect(parseOidcIdentityConfiguration({})).toBeNull();
  });

  it('requires an HTTPS issuer and audience together', () => {
    expect(() =>
      parseOidcIdentityConfiguration({ OIDC_ISSUER: issuer }),
    ).toThrow('must be configured together');
    expect(() =>
      parseOidcIdentityConfiguration({
        OIDC_ISSUER: 'http://identity.example.test',
        OIDC_AUDIENCE: audience,
      }),
    ).toThrow('HTTPS issuer');
  });
});

describe('OidcIdentityVerifier', () => {
  it('verifies a signed token and returns only its issuer and subject', async () => {
    const key = createRsaFixture();
    const fetcher = createFetcher([key.jwk]);
    const verifier = new OidcIdentityVerifier(
      { issuer, audience },
      fetcher,
      () => now,
    );

    await expect(
      verifier.verifyBearerToken(signToken(key.privateKey)),
    ).resolves.toEqual({
      issuer,
      subject: 'provider-user-123',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('verifies ES256 signatures using the provider public key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const jwk = {
      ...publicKey.export({ format: 'jwk' }),
      kid: 'ec-key',
      alg: 'ES256',
    };
    const input = `${encode({ alg: 'ES256', kid: 'ec-key' })}.${encode({
      iss: issuer,
      sub: 'provider-user-123',
      aud: audience,
      iat: Math.floor(now / 1_000),
      exp: Math.floor(now / 1_000) + 600,
    })}`;
    const signature = createSign('SHA256')
      .update(input)
      .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
    const verifier = new OidcIdentityVerifier(
      { issuer, audience },
      createFetcher([jwk]),
      () => now,
    );

    await expect(
      verifier.verifyBearerToken(`${input}.${signature.toString('base64url')}`),
    ).resolves.toMatchObject({ subject: 'provider-user-123' });
  });

  it.each([
    ['wrong issuer', { iss: 'https://other.example.test' }],
    ['wrong audience', { aud: 'another-api' }],
    ['unapproved authorized party', { aud: [audience, 'another-api'] }],
    ['expired token', { exp: Math.floor(now / 1_000) - 120 }],
    ['not-yet-valid token', { nbf: Math.floor(now / 1_000) + 120 }],
    ['excessive lifetime', { exp: Math.floor(now / 1_000) + 90_000 }],
  ])(
    'rejects a token with %s',
    async (_label, claims) => {
      const key = createRsaFixture();
      const verifier = new OidcIdentityVerifier(
        { issuer, audience },
        createFetcher([key.jwk]),
        () => now,
      );

      await expect(
        verifier.verifyBearerToken(signToken(key.privateKey, claims)),
      ).resolves.toBeNull();
    },
    15_000,
  );

  it('rejects unsigned, disallowed-algorithm, malformed, and forged tokens', async () => {
    const key = createRsaFixture();
    const verifier = new OidcIdentityVerifier(
      { issuer, audience },
      createFetcher([key.jwk]),
      () => now,
    );

    await expect(verifier.verifyBearerToken('not-a-jwt')).resolves.toBeNull();
    await expect(
      verifier.verifyBearerToken(
        signToken(key.privateKey, {}, { alg: 'none', kid: 'rsa-key' }),
      ),
    ).resolves.toBeNull();
    const [header, , signature] = signToken(key.privateKey).split('.');
    const altered = `${header}.${encode({
      iss: issuer,
      sub: 'attacker',
      aud: audience,
      iat: Math.floor(now / 1_000),
      exp: Math.floor(now / 1_000) + 600,
    })}.${signature}`;
    await expect(verifier.verifyBearerToken(altered)).resolves.toBeNull();
  });

  it('rejects mismatched discovery issuer and insecure JWKS locations', async () => {
    const key = createRsaFixture();
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            issuer: 'https://attacker.example.test',
            jwks_uri: 'http://attacker.example.test/keys',
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const verifier = new OidcIdentityVerifier(
      { issuer, audience },
      fetcher,
      () => now,
    );

    await expect(
      verifier.verifyBearerToken(signToken(key.privateKey)),
    ).rejects.toThrow('invalid discovery metadata');
  });

  it('rejects private signing material in provider JWKS', async () => {
    const key = createRsaFixture();
    key.jwk.d = 'private-material';
    const verifier = new OidcIdentityVerifier(
      { issuer, audience },
      createFetcher([key.jwk]),
      () => now,
    );

    await expect(
      verifier.verifyBearerToken(signToken(key.privateKey)),
    ).rejects.toThrow('no usable signing keys');
  });

  it('bounds provider document reads even without content-length', async () => {
    const key = createRsaFixture();
    const oversizedBody = 'x'.repeat(256_001);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return new Response(
        url.includes('.well-known')
          ? JSON.stringify({
              issuer,
              jwks_uri: `${issuer}/jwks`,
            })
          : oversizedBody,
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const verifier = new OidcIdentityVerifier(
      { issuer, audience },
      fetcher,
      () => now,
    );

    await expect(
      verifier.verifyBearerToken(signToken(key.privateKey)),
    ).rejects.toThrow('exceeds the size limit');
  });

  it('refreshes keys for a newly rotated provider signing key', async () => {
    const oldKey = createRsaFixture();
    const newKey = createRsaFixture();
    newKey.jwk.kid = 'rotated-key';
    let jwksRequestCount = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes('.well-known')) {
        return new Response(
          JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }),
          { status: 200 },
        );
      }
      jwksRequestCount += 1;
      return new Response(
        JSON.stringify({
          keys: jwksRequestCount === 1 ? [oldKey.jwk] : [newKey.jwk],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const verifier = new OidcIdentityVerifier(
      { issuer, audience },
      fetcher,
      () => now,
    );

    await expect(
      verifier.verifyBearerToken(signToken(oldKey.privateKey)),
    ).resolves.toMatchObject({ subject: 'provider-user-123' });
    const rotatedToken = signToken(
      newKey.privateKey,
      {},
      {
        alg: 'RS256',
        kid: 'rotated-key',
      },
    );
    await expect(
      verifier.verifyBearerToken(rotatedToken),
    ).resolves.toMatchObject({ subject: 'provider-user-123' });
  });
});
