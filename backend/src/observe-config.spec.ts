import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  APPROVED_OBSERVE_ENDPOINTS,
  loadObserveModule,
  parseObserveConfiguration,
  type ObserveEnvironment,
} from './observe-config.js';

const approvedEndpoint = 'https://collector.example';
const validEnabledEnvironment: ObserveEnvironment = {
  OBSERVE_ENABLED: 'true',
  OBSERVE_APP_KEY: 'test-app-key',
  OBSERVE_APP_SECRET: 'test-app-secret',
  OBSERVE_ENDPOINT: approvedEndpoint,
};

describe('parseObserveConfiguration', () => {
  it('disables telemetry by default without requiring credentials', () => {
    expect(parseObserveConfiguration({})).toEqual({ enabled: false });
  });

  it('keeps telemetry disabled when both credentials are absent', () => {
    expect(parseObserveConfiguration({ OBSERVE_ENABLED: 'false' })).toEqual({
      enabled: false,
    });
  });

  it('accepts a complete credential pair only for an explicitly approved endpoint', () => {
    expect(
      parseObserveConfiguration(validEnabledEnvironment, [approvedEndpoint]),
    ).toEqual({
      enabled: true,
      appKey: 'test-app-key',
      appSecret: 'test-app-secret',
      endpoint: approvedEndpoint,
    });
  });

  it('does not use a built-in or assumed production endpoint', () => {
    expect(APPROVED_OBSERVE_ENDPOINTS).toEqual([]);
    expect(() => parseObserveConfiguration(validEnabledEnvironment)).toThrow(
      /approved destination list/,
    );
  });

  it('rejects invalid configuration before loading Observe', async () => {
    const loadModule = vi.fn(async () => 'initialized');

    await expect(
      loadObserveModule(
        loadModule,
        { ...validEnabledEnvironment, OBSERVE_ENDPOINT: 'http://localhost' },
        [approvedEndpoint],
      ),
    ).rejects.toThrow(/OBSERVE_ENDPOINT/);
    expect(loadModule).not.toHaveBeenCalled();
  });

  it.each([
    [{ OBSERVE_ENABLED: 'true' }, /required/],
    [
      {
        OBSERVE_ENABLED: 'true',
        OBSERVE_APP_KEY: 'test-app-key',
      },
      /configured together/,
    ],
    [
      {
        OBSERVE_ENABLED: 'true',
        OBSERVE_APP_SECRET: 'test-app-secret',
      },
      /configured together/,
    ],
    [
      {
        ...validEnabledEnvironment,
        OBSERVE_APP_KEY: '',
      },
      /non-empty/,
    ],
    [
      {
        ...validEnabledEnvironment,
        OBSERVE_APP_SECRET: '   ',
      },
      /non-empty/,
    ],
    [
      {
        ...validEnabledEnvironment,
        OBSERVE_APP_KEY: 'YOUR_APP_KEY',
      },
      /scaffold placeholders/,
    ],
    [
      {
        ...validEnabledEnvironment,
        OBSERVE_APP_SECRET: 'YOUR_APP_SECRET',
      },
      /scaffold placeholders/,
    ],
  ])(
    'rejects invalid credentials or an incomplete pair',
    (environment, message) => {
      expect(() =>
        parseObserveConfiguration(environment as ObserveEnvironment, [
          approvedEndpoint,
        ]),
      ).toThrow(message);
    },
  );

  it.each([
    ['malformed', 'not a URL'],
    ['untrusted host', 'https://collector.example.attacker.invalid'],
    ['remote HTTP', 'http://collector.example'],
    ['unapproved port', 'https://collector.example:8443'],
    ['path', 'https://collector.example/telemetry'],
    ['userinfo', 'https://user:pass@collector.example'],
    ['query', 'https://collector.example?token=redacted'],
    ['fragment', 'https://collector.example#fragment'],
    ['lookalike host', 'https://collector-example.invalid'],
  ])('rejects an invalid or untrusted endpoint (%s)', (_scenario, endpoint) => {
    expect(() =>
      parseObserveConfiguration(
        { ...validEnabledEnvironment, OBSERVE_ENDPOINT: endpoint },
        [approvedEndpoint],
      ),
    ).toThrow(/OBSERVE_ENDPOINT/);
  });

  it('rejects a non-boolean OBSERVE_ENABLED value', () => {
    expect(() => parseObserveConfiguration({ OBSERVE_ENABLED: 'yes' })).toThrow(
      /OBSERVE_ENABLED/,
    );
  });
});

describe('Observe startup canary', () => {
  it('does not contact a local collector when configuration is invalid', async () => {
    let requestCount = 0;
    const canary = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(204).end();
    });
    canary.listen(0, '127.0.0.1');
    await once(canary, 'listening');

    const address = canary.address();
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve, reject) => {
        canary.close((error) => (error ? reject(error) : resolve()));
      });
      throw new Error('Could not bind the local telemetry canary');
    }

    try {
      const childEnvironment: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NODE_ENV: 'test',
        OBSERVE_ENABLED: 'true',
        OBSERVE_APP_KEY: 'canary-test-key',
        OBSERVE_APP_SECRET: 'canary-test-secret',
        OBSERVE_ENDPOINT: `http://127.0.0.1:${address.port}`,
      };
      const result = await runCanaryChild(childEnvironment);

      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/OBSERVE_ENDPOINT/);
      expect(requestCount).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        canary.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 15_000);
});

function runCanaryChild(
  environment: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        "import { loadObserveModule } from './src/observe-config.ts'; try { await loadObserveModule(async () => fetch(`${process.env.OBSERVE_ENDPOINT}/applications/telemetry`)); } catch (error) { console.error(error.message); process.exitCode = 1; }",
      ],
      {
        cwd: new URL('../', import.meta.url),
        env: environment,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
}
