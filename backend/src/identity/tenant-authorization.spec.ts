import { describe, expect, it, vi } from 'vitest';
import {
  TenantAuthorizationError,
  TenantAuthorizationService,
  isVerifiedTenantContext,
  type IdentityVerifier,
  type TenantMembershipReader,
  type TenantMembership,
  type VerifiedIdentity,
} from './tenant-authorization.js';

const identity = { subject: 'user-1', issuer: 'https://identity.example.test' };
const membership = {
  tenantId: 'tenant-1',
  userId: '00000000-0000-4000-8000-000000000001',
  role: 'admin' as const,
  status: 'active' as const,
};

function createService(
  tokenResult: VerifiedIdentity | null = identity,
  membershipResult: TenantMembership | null = membership,
) {
  const verifyBearerToken = vi.fn(async () => tokenResult);
  const findMembership = vi.fn(async () => membershipResult);
  const identityVerifier: IdentityVerifier = { verifyBearerToken };
  const membershipReader: TenantMembershipReader = { findMembership };
  return {
    service: new TenantAuthorizationService(identityVerifier, membershipReader),
    verifyBearerToken,
    findMembership,
  };
}

describe('TenantAuthorizationService', () => {
  it('creates an immutable tenant context only after identity and membership verification', async () => {
    const { service, findMembership } = createService();
    const context = await service.authorize(
      'signed-token',
      'tenant-1',
      'admin',
    );

    expect(context).toMatchObject({
      userId: membership.userId,
      tenantId: 'tenant-1',
      role: 'admin',
      issuer: 'https://identity.example.test',
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(isVerifiedTenantContext(context)).toBe(true);
    expect(findMembership).toHaveBeenCalledWith(identity, 'tenant-1');
  });

  it('rejects missing credentials before attempting tenant membership lookup', async () => {
    const { service, verifyBearerToken, findMembership } = createService();
    await expect(service.authorize(' ', 'tenant-1')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(verifyBearerToken).not.toHaveBeenCalled();
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('does not resolve membership for an unverified token', async () => {
    const { service, findMembership } = createService(null);
    await expect(
      service.authorize('invalid-token', 'tenant-1'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(findMembership).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...membership, status: 'suspended' as const },
    { ...membership, userId: ' ' },
    { ...membership, tenantId: 'another-tenant' },
  ])('denies absent, inactive, or mismatched membership %#', async (result) => {
    const { service } = createService(identity, result);
    await expect(
      service.authorize('signed-token', 'tenant-1'),
    ).rejects.toMatchObject({ code: 'TENANT_ACCESS_DENIED' });
  });

  it('enforces minimum roles without trusting the requested tenant id', async () => {
    const { service } = createService(identity, {
      ...membership,
      role: 'member',
    });
    await expect(
      service.authorize('signed-token', 'tenant-1', 'admin'),
    ).rejects.toMatchObject({ code: 'TENANT_ACCESS_DENIED' });
    await expect(
      service.authorize('signed-token', 'tenant-2', 'member'),
    ).rejects.toBeInstanceOf(TenantAuthorizationError);
  });

  it('defaults to denying access when identity or membership adapters are unconfigured', async () => {
    const service = new TenantAuthorizationService();
    await expect(
      service.authorize('any-token', 'tenant-1'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('does not recognize a caller-created object as verified context', () => {
    expect(
      isVerifiedTenantContext({
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'owner',
        issuer: 'https://identity.example.test',
      }),
    ).toBe(false);
  });

  it('requires a persisted permission grant after identity and membership checks', async () => {
    const membershipReader = { findMembership: vi.fn(async () => membership) };
    const permissionReader = {
      hasPermission: vi.fn(
        async (_context: unknown, key: string) => key === 'products:read',
      ),
    };
    const service = new TenantAuthorizationService(
      { verifyBearerToken: async () => identity },
      membershipReader,
      permissionReader,
    );

    await expect(
      service.authorizePermission('signed-token', 'tenant-1', 'products:read'),
    ).resolves.toMatchObject({ tenantId: 'tenant-1' });
    await expect(
      service.authorizePermission('signed-token', 'tenant-1', 'orders:write'),
    ).rejects.toMatchObject({ code: 'TENANT_ACCESS_DENIED' });
    expect(permissionReader.hasPermission).toHaveBeenCalledTimes(2);
  });
});
