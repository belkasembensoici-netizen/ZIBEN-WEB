import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseTransaction } from './database.types.js';
import { DatabaseService } from './database.service.js';
import { DRIZZLE_DATABASE } from './database.tokens.js';
import { TenantAuthorizationService } from '../identity/tenant-authorization.js';

describe('DatabaseService', () => {
  async function createService() {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const transaction = vi.fn(
      async (work: (tx: DatabaseTransaction) => Promise<unknown>) =>
        Reflect.apply(work, undefined, [{ execute }]),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: DRIZZLE_DATABASE,
          useValue: { transaction },
        },
      ],
    }).compile();

    return {
      service: module.get(DatabaseService),
      transaction,
      execute,
      close: () => module.close(),
    };
  }

  it('propagates callback errors to the Drizzle transaction', async () => {
    const database = await createService();
    const failure = new Error('transaction failed');

    await expect(
      database.service.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(database.transaction).toHaveBeenCalledOnce();
    await database.close();
  });

  it('sets transaction-local identity and tenant context only from verified identity', async () => {
    const database = await createService();
    let verifiedIdentity:
      Parameters<DatabaseService['identityTransaction']>[0] | undefined;
    const authorization = new TenantAuthorizationService(
      {
        verifyBearerToken: async () => ({
          subject: 'subject-1',
          issuer: 'issuer-1',
        }),
      },
      {
        findMembership: async (identity) => {
          verifiedIdentity = identity;
          return {
            tenantId: 'tenant-fixture',
            userId: '00000000-0000-4000-8000-000000000001',
            role: 'owner',
            status: 'active',
          };
        },
      },
    );
    const context = await authorization.authorize(
      'valid-token',
      'tenant-fixture',
    );

    expect(verifiedIdentity).toBeDefined();
    await database.service.identityTransaction(
      verifiedIdentity!,
      context.tenantId,
      async () => 'done',
    );

    expect(database.execute).toHaveBeenCalledOnce();
    await database.close();
  });

  it('rejects arbitrary tenant IDs and caller-created tenant contexts', async () => {
    const database = await createService();
    await expect(
      database.service.identityTransaction(
        { subject: 'user', issuer: 'issuer' },
        'tenant-fixture',
        async () => 'unused',
      ),
    ).rejects.toThrow('A verified identity is required');
    await expect(
      database.service.tenantTransaction(
        {
          userId: 'user',
          tenantId: 'tenant-fixture',
          role: 'owner',
          issuer: 'issuer',
        } as Parameters<DatabaseService['tenantTransaction']>[0],
        async () => 'unused',
      ),
    ).rejects.toThrow('A verified tenant context is required');
    expect(database.transaction).not.toHaveBeenCalled();
    await database.close();
  });

  it('rejects implicit nested transactions', async () => {
    const database = await createService();

    await expect(
      database.service.transaction(() =>
        database.service.transaction(async () => 'nested'),
      ),
    ).rejects.toThrow('Nested database transactions are not supported');
    await database.close();
  });

  it('rejects an empty tenant context before opening a transaction', async () => {
    const database = await createService();
    let verifiedIdentity:
      Parameters<DatabaseService['identityTransaction']>[0] | undefined;
    const authorization = new TenantAuthorizationService(
      {
        verifyBearerToken: async () => ({
          subject: 'subject-1',
          issuer: 'issuer-1',
        }),
      },
      {
        findMembership: async (identity) => {
          verifiedIdentity = identity;
          return {
            tenantId: 'tenant-fixture',
            userId: '00000000-0000-4000-8000-000000000001',
            role: 'owner',
            status: 'active',
          };
        },
      },
    );
    await authorization.authorize('valid-token', 'tenant-fixture');

    await expect(
      database.service.identityTransaction(
        verifiedIdentity!,
        '  ',
        async () => 'unused',
      ),
    ).rejects.toThrow('Transaction tenantId must not be empty');
    expect(database.transaction).not.toHaveBeenCalled();
    await database.close();
  });
});
