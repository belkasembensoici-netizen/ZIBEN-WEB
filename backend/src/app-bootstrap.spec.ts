import { describe, expect, it } from 'vitest';
import { parseCorsOrigins, parsePort } from './app-bootstrap.js';

describe('parsePort', () => {
  it('defaults to the development port when unset', () => {
    expect(parsePort(undefined)).toBe(3000);
  });

  it('accepts valid TCP ports', () => {
    expect(parsePort(' 8080 ')).toBe(8080);
    expect(parsePort('65535')).toBe(65535);
  });

  it.each(['', 'abc', '1.5', '0', '65536', '-1'])(
    'rejects invalid port %j',
    (value) => {
      expect(() => parsePort(value)).toThrow(
        'PORT must be an integer between 1 and 65535',
      );
    },
  );
});

describe('parseCorsOrigins', () => {
  it('disables CORS when no origins are configured', () => {
    expect(parseCorsOrigins(undefined)).toBe(false);
    expect(parseCorsOrigins('  ')).toBe(false);
  });

  it('trims, normalizes, and deduplicates HTTP(S) origins', () => {
    expect(
      parseCorsOrigins(
        ' https://example.com/ , http://localhost:3000, https://example.com ',
      ),
    ).toEqual(['https://example.com', 'http://localhost:3000']);
  });

  it.each([
    'not-an-origin',
    '*',
    'https://example.com/path',
    'https://example.com,',
  ])('rejects invalid CORS_ORIGIN value %j', (value) => {
    expect(() => parseCorsOrigins(value)).toThrow(/CORS_ORIGIN/);
  });
});
