import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  permissions,
  tenantMemberships,
  tenantRolePermissions,
  users,
} from '../database/schema/index.js';
import type {
  TenantMembership,
  TenantPermissionReader,
  TenantMembershipReader,
  TenantRole,
  VerifiedIdentity,
  VerifiedTenantContext,
} from './tenant-authorization.js';

const tenantRoles = new Set<TenantRole>(['owner', 'admin', 'member']);
const membershipStatuses = new Set<TenantMembership['status']>([
  'active',
  'suspended',
  'revoked',
]);

@Injectable()
export class TenantMembershipRepository
  implements TenantMembershipReader, TenantPermissionReader
{
  constructor(private readonly database: DatabaseService) {}

  async findMembership(
    identity: VerifiedIdentity,
    tenantId: string,
  ): Promise<TenantMembership | null> {
    const tenantUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!tenantUuid.test(tenantId)) return null;

    const rows = await this.database.identityTransaction(
      identity,
      tenantId,
      (transaction) =>
        transaction
          .select({
            tenantId: tenantMemberships.tenantId,
            userId: tenantMemberships.userId,
            role: tenantMemberships.role,
            status: tenantMemberships.status,
          })
          .from(tenantMemberships)
          .innerJoin(users, eq(users.id, tenantMemberships.userId))
          .where(
            and(
              eq(tenantMemberships.tenantId, tenantId),
              eq(users.identityIssuer, identity.issuer),
              eq(users.identitySubject, identity.subject),
            ),
          )
          .limit(1),
    );
    const membership = rows[0];
    if (
      !membership ||
      !tenantRoles.has(membership.role) ||
      !membershipStatuses.has(membership.status as TenantMembership['status'])
    ) {
      return null;
    }

    return {
      ...membership,
      role: membership.role,
      status: membership.status as TenantMembership['status'],
    };
  }

  async hasPermission(
    context: VerifiedTenantContext,
    permission: string,
  ): Promise<boolean> {
    const rows = await this.database.tenantTransaction(context, (transaction) =>
      transaction
        .select({ id: permissions.id })
        .from(tenantRolePermissions)
        .innerJoin(
          permissions,
          eq(permissions.id, tenantRolePermissions.permissionId),
        )
        .where(
          and(
            eq(tenantRolePermissions.tenantId, context.tenantId),
            eq(tenantRolePermissions.role, context.role),
            eq(permissions.key, permission),
          ),
        )
        .limit(1),
    );
    return rows.length > 0;
  }
}
