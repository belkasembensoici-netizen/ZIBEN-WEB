import { Inject, Injectable, Optional } from '@nestjs/common';

export const IDENTITY_VERIFIER = Symbol('IDENTITY_VERIFIER');
export const TENANT_MEMBERSHIP_READER = Symbol('TENANT_MEMBERSHIP_READER');
export const TENANT_PERMISSION_READER = Symbol('TENANT_PERMISSION_READER');
const tenantContextBrand: unique symbol = Symbol('VERIFIED_TENANT_CONTEXT');

export type TenantRole = 'owner' | 'admin' | 'member';

export interface VerifiedIdentity {
  readonly subject: string;
  readonly issuer: string;
}

const verifiedIdentities = new WeakSet<object>();

export function isVerifiedIdentity(value: unknown): value is VerifiedIdentity {
  return (
    typeof value === 'object' && value !== null && verifiedIdentities.has(value)
  );
}

export interface TenantMembership {
  tenantId: string;
  userId: string;
  role: TenantRole;
  status: 'active' | 'suspended' | 'revoked';
}

export interface IdentityVerifier {
  verifyBearerToken(token: string): Promise<VerifiedIdentity | null>;
}

export interface TenantMembershipReader {
  findMembership(
    identity: VerifiedIdentity,
    tenantId: string,
  ): Promise<TenantMembership | null>;
}

export interface TenantPermissionReader {
  hasPermission(
    context: VerifiedTenantContext,
    permission: string,
  ): Promise<boolean>;
}

export interface VerifiedTenantContext {
  readonly [tenantContextBrand]: true;
  readonly userId: string;
  readonly tenantId: string;
  readonly role: TenantRole;
  readonly issuer: string;
  readonly subject: string;
}

export function isVerifiedTenantContext(
  value: unknown,
): value is VerifiedTenantContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    tenantContextBrand in value &&
    value[tenantContextBrand] === true
  );
}

export class TenantAuthorizationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_CREDENTIALS'
      | 'INVALID_TENANT_SELECTION'
      | 'TENANT_ACCESS_DENIED',
  ) {
    super(message);
    this.name = 'TenantAuthorizationError';
  }
}

const ROLE_LEVEL: Readonly<Record<TenantRole, number>> = {
  member: 1,
  admin: 2,
  owner: 3,
};

function assertRole(value: unknown): value is TenantRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

@Injectable()
export class TenantAuthorizationService {
  constructor(
    @Optional()
    @Inject(IDENTITY_VERIFIER)
    private readonly identityVerifier: IdentityVerifier = {
      verifyBearerToken: async () => null,
    },
    @Optional()
    @Inject(TENANT_MEMBERSHIP_READER)
    private readonly membershipReader: TenantMembershipReader = {
      findMembership: async () => null,
    },
    @Optional()
    @Inject(TENANT_PERMISSION_READER)
    private readonly permissionReader: TenantPermissionReader = {
      hasPermission: async () => false,
    },
  ) {}

  async authorize(
    bearerToken: string,
    requestedTenantId: string,
    minimumRole: TenantRole = 'member',
  ): Promise<VerifiedTenantContext> {
    const token = bearerToken.trim();
    const tenantId = requestedTenantId.trim();
    if (!token || token.length > 8_192) {
      throw new TenantAuthorizationError(
        'A verified bearer credential is required',
        'INVALID_CREDENTIALS',
      );
    }
    if (!tenantId || tenantId.length > 256) {
      throw new TenantAuthorizationError(
        'A tenant selection is required',
        'INVALID_TENANT_SELECTION',
      );
    }

    const assertedIdentity =
      await this.identityVerifier.verifyBearerToken(token);
    if (
      !assertedIdentity ||
      typeof assertedIdentity.subject !== 'string' ||
      !assertedIdentity.subject.trim() ||
      assertedIdentity.subject.length > 512 ||
      typeof assertedIdentity.issuer !== 'string' ||
      !assertedIdentity.issuer.trim() ||
      assertedIdentity.issuer.length > 2_048
    ) {
      throw new TenantAuthorizationError(
        'The bearer credential could not be verified',
        'INVALID_CREDENTIALS',
      );
    }

    const identity = Object.freeze({
      subject: assertedIdentity.subject,
      issuer: assertedIdentity.issuer,
    });
    verifiedIdentities.add(identity);
    const membership = await this.membershipReader.findMembership(
      identity,
      tenantId,
    );
    const membershipRoleLevel = membership
      ? assertRole(membership.role)
        ? ROLE_LEVEL[membership.role]
        : undefined
      : undefined;
    const minimumRoleLevel = ROLE_LEVEL[minimumRole];
    if (
      !membership ||
      membership.status !== 'active' ||
      typeof membership.userId !== 'string' ||
      !membership.userId.trim() ||
      membership.tenantId !== tenantId ||
      !membershipRoleLevel ||
      !minimumRoleLevel ||
      membershipRoleLevel < minimumRoleLevel
    ) {
      throw new TenantAuthorizationError(
        'The verified identity is not authorized for this tenant',
        'TENANT_ACCESS_DENIED',
      );
    }

    return Object.freeze({
      [tenantContextBrand]: true as const,
      userId: membership.userId,
      tenantId: membership.tenantId,
      role: membership.role,
      issuer: identity.issuer,
      subject: identity.subject,
    });
  }

  async authorizePermission(
    bearerToken: string,
    requestedTenantId: string,
    permission: string,
  ): Promise<VerifiedTenantContext> {
    const normalizedPermission = permission.trim();
    if (!normalizedPermission || normalizedPermission.length > 256) {
      throw new TenantAuthorizationError(
        'A valid permission is required',
        'TENANT_ACCESS_DENIED',
      );
    }
    const context = await this.authorize(
      bearerToken,
      requestedTenantId,
      'member',
    );
    if (
      !(await this.permissionReader.hasPermission(
        context,
        normalizedPermission,
      ))
    ) {
      throw new TenantAuthorizationError(
        'The tenant membership does not have the required permission',
        'TENANT_ACCESS_DENIED',
      );
    }
    return context;
  }
}
