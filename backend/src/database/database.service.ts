import { Inject, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from './database.tokens.js';
import type { Database, DatabaseTransaction } from './database.types.js';
import {
  isVerifiedIdentity,
  isVerifiedTenantContext,
  type VerifiedIdentity,
  type VerifiedTenantContext,
} from '../identity/tenant-authorization.js';

@Injectable()
export class DatabaseService {
  private readonly transactionContext = new AsyncLocalStorage<boolean>();

  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: Database) {}

  async transaction<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.transactionContext.getStore()) {
      throw new Error(
        'Nested database transactions are not supported; pass the current transaction to collaborators',
      );
    }

    return this.transactionContext.run(true, () =>
      this.database.transaction(work),
    );
  }

  async identityTransaction<T>(
    identity: VerifiedIdentity,
    tenantId: string,
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    if (!isVerifiedIdentity(identity)) {
      throw new Error('A verified identity is required for database access');
    }
    if (!tenantId.trim()) {
      throw new Error('Transaction tenantId must not be empty');
    }
    return this.withTransactionContext(async (transaction) => {
      await transaction.execute(sql`
        select
          set_config('app.tenant_id', ${tenantId}, true),
          set_config('app.identity_issuer', ${identity.issuer}, true),
          set_config('app.identity_subject', ${identity.subject}, true)
      `);
      return work(transaction);
    });
  }

  async tenantTransaction<T>(
    context: VerifiedTenantContext,
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    if (!isVerifiedTenantContext(context)) {
      throw new Error(
        'A verified tenant context is required for database access',
      );
    }
    return this.withTransactionContext(async (transaction) => {
      await transaction.execute(sql`
        select
          set_config('app.tenant_id', ${context.tenantId}, true),
          set_config('app.user_id', ${context.userId}, true),
          set_config('app.identity_issuer', ${context.issuer}, true),
          set_config('app.identity_subject', ${context.subject}, true)
      `);
      return work(transaction);
    });
  }

  private async withTransactionContext<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.transactionContext.getStore()) {
      throw new Error(
        'Nested database transactions are not supported; pass the current transaction to collaborators',
      );
    }
    return this.transactionContext.run(true, () =>
      this.database.transaction(work),
    );
  }
}
