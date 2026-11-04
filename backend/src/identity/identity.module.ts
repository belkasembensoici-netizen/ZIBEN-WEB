import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import {
  IDENTITY_VERIFIER,
  TENANT_MEMBERSHIP_READER,
  TENANT_PERMISSION_READER,
  TenantAuthorizationService,
} from './tenant-authorization.js';
import { createOidcIdentityVerifier } from './oidc-identity-verifier.js';
import { TenantMembershipRepository } from './tenant-membership.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    TenantAuthorizationService,
    TenantMembershipRepository,
    {
      provide: TENANT_MEMBERSHIP_READER,
      useExisting: TenantMembershipRepository,
    },
    {
      provide: TENANT_PERMISSION_READER,
      useExisting: TenantMembershipRepository,
    },
    {
      provide: IDENTITY_VERIFIER,
      useFactory: () => createOidcIdentityVerifier(process.env),
    },
  ],
  exports: [TenantAuthorizationService],
})
export class IdentityModule {}
