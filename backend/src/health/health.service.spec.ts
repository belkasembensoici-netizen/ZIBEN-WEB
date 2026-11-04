import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { DRIZZLE_DATABASE } from '../database/database.tokens.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  async function createService(database: {
    execute: ReturnType<typeof vi.fn>;
  }) {
    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DRIZZLE_DATABASE, useValue: database },
      ],
    }).compile();

    return { service: module.get(HealthService), close: () => module.close() };
  }

  it('reports liveness without checking dependencies', async () => {
    const database = { execute: vi.fn() };
    const { service, close } = await createService(database);

    expect(service.getLiveness()).toEqual({ status: 'alive' });
    expect(database.execute).not.toHaveBeenCalled();
    await close();
  });

  it('reports readiness when PostgreSQL accepts a query', async () => {
    const database = {
      execute: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };
    const { service, close } = await createService(database);

    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ready',
      checks: { database: 'available' },
    });
    expect(database.execute).toHaveBeenCalledOnce();
    await close();
  });

  it('returns a sanitized unavailable response when PostgreSQL cannot be reached', async () => {
    const database = {
      execute: vi
        .fn()
        .mockRejectedValue(
          new Error('connection password must not be exposed'),
        ),
    };
    const { service, close } = await createService(database);

    try {
      await service.getReadiness();
      throw new Error('Expected readiness to fail');
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) {
        throw error;
      }
      expect(JSON.stringify(error.getResponse())).not.toContain(
        'connection password must not be exposed',
      );
      expect(error.getStatus()).toBe(503);
    } finally {
      await close();
    }
  });
});
