import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it, vi } from 'vitest';
import { applyMigrationBatch } from './migrate.ts';

const migrationsFolder = fileURLToPath(
  new URL('./migrations', import.meta.url),
);
const migrations = readMigrationFiles({ migrationsFolder });

describe('applyMigrationBatch', () => {
  it('executes migration statements before recording the migration', async () => {
    const calls: string[] = [];
    const executeStatement = vi.fn(async (statement: string) => {
      calls.push(statement);
    });
    const recordMigration = vi.fn(async (hash: string, createdAt: number) => {
      calls.push(`record:${hash}:${createdAt}`);
    });

    await expect(
      applyMigrationBatch(
        migrations,
        undefined,
        executeStatement,
        recordMigration,
      ),
    ).resolves.toBe(migrations.length);

    expect(executeStatement).toHaveBeenCalledTimes(
      migrations.reduce(
        (count, migration) => count + migration.sql.length + 2,
        0,
      ),
    );
    expect(calls[0]).toBe('SET LOCAL ROLE schema_owner');
    expect(calls.at(-2)).toBe('RESET ROLE');
    expect(recordMigration).toHaveBeenCalledTimes(migrations.length);
    expect(recordMigration).toHaveBeenNthCalledWith(
      migrations.length,
      migrations.at(-1)?.hash,
      migrations.at(-1)?.folderMillis,
    );
    expect(calls.at(-1)).toBe(
      `record:${migrations.at(-1)?.hash}:${migrations.at(-1)?.folderMillis}`,
    );
  });

  it('does not reapply a migration already present in the ledger', async () => {
    const executeStatement = vi.fn(async () => undefined);
    const recordMigration = vi.fn(async () => undefined);

    await expect(
      applyMigrationBatch(
        migrations,
        migrations.at(-1)?.folderMillis,
        executeStatement,
        recordMigration,
      ),
    ).resolves.toBe(0);

    expect(executeStatement).not.toHaveBeenCalled();
    expect(recordMigration).not.toHaveBeenCalled();
  });

  it('does not record a migration when one of its statements fails', async () => {
    const failure = new Error('migration statement failed');
    const executeStatement = vi
      .fn<(statement: string) => Promise<unknown>>()
      .mockRejectedValueOnce(failure);
    const recordMigration = vi.fn(async () => undefined);

    await expect(
      applyMigrationBatch(
        migrations,
        undefined,
        executeStatement,
        recordMigration,
      ),
    ).rejects.toBe(failure);
    expect(recordMigration).not.toHaveBeenCalled();
  });
});
