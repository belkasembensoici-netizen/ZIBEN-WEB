import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { configureApplication } from './../src/app-bootstrap.js';
import { DRIZZLE_DATABASE } from './../src/database/database.tokens.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const observeEnvironment = [
    'OBSERVE_ENABLED',
    'OBSERVE_APP_KEY',
    'OBSERVE_APP_SECRET',
    'OBSERVE_ENDPOINT',
    'DATABASE_URL',
  ] as const;
  const originalObserveEnvironment = new Map(
    observeEnvironment.map((name) => [name, process.env[name]]),
  );

  beforeAll(async () => {
    for (const name of observeEnvironment) {
      delete process.env[name];
    }
    vi.stubEnv('OBSERVE_ENABLED', 'false');
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://app_runtime:integration-test@127.0.0.1:65432/nova_test',
    );

    const { AppModule, ObserveInstrument } =
      await import('./../src/app.module.js');
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DATABASE)
      .useValue({
        execute: vi
          .fn()
          .mockRejectedValue(
            new Error('test database password must not be exposed'),
          ),
      })
      .compile();
    const moduleRef = await builder;
    app = moduleRef.createNestApplication({
      instrument: ObserveInstrument,
      logger: false,
    });
    configureApplication(app, {});
    await app.init();
  });

  it('/api/v1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect('Hello World!');
  });

  it('/api/v1/capabilities (GET) reports module implementation states', () => {
    return request(app.getHttpServer())
      .get('/api/v1/capabilities')
      .expect(200)
      .expect({
        modules: [
          { id: 'command-center', status: 'partial' },
          { id: 'commerce', status: 'partial' },
          { id: 'ai-studio', status: 'partial' },
          { id: 'ai-agents', status: 'partial' },
          { id: 'market-intelligence', status: 'partial' },
          { id: 'automation', status: 'partial' },
          { id: 'identity', status: 'partial' },
        ],
      });
  });

  it('/api/v1/health/live (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'alive' });
  });

  it('/api/v1/health/ready (GET) does not disclose database errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { database: 'unavailable' },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'test database password must not be exposed',
    );
  });

  afterAll(async () => {
    try {
      if (app) {
        await app.close();
      }
    } finally {
      vi.unstubAllEnvs();
      for (const [name, value] of originalObserveEnvironment) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});
