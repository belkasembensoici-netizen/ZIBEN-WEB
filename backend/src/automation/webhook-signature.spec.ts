import { describe, expect, it } from 'vitest';
import {
  createWebhookSignature,
  WebhookDeliveryService,
  WebhookSignatureService,
  verifyWebhookSignature,
  type WebhookReplayStore,
} from './webhook-signature.js';

const secret = 'secure-test-secret-with-at-least-32-bytes';
const timestamp = '1793725200';
const rawBody = Buffer.from('{"event":"order.created","id":"evt-1"}');
const now = new Date(Number(timestamp) * 1000);

describe('webhook signature verification', () => {
  it('accepts a valid signature for the exact raw payload', () => {
    expect(
      verifyWebhookSignature({
        secret,
        headers: {
          timestamp,
          signature: createWebhookSignature(secret, timestamp, rawBody),
        },
        rawBody,
        now,
      }),
    ).toBe(true);
  });

  describe('WebhookDeliveryService', () => {
    function delivery(
      payload: string = rawBody.toString('utf8'),
      deliveryId = 'delivery-1',
    ) {
      const body = Buffer.from(payload);
      return {
        input: {
          providerId: 'n8n',
          deliveryId,
          headers: {
            timestamp,
            signature: createWebhookSignature(secret, timestamp, body),
          },
          rawBody: body,
        },
        body,
      };
    }

    it('claims a verified delivery and parses its original body', async () => {
      const claim = vi.fn(async () => true);
      const store: WebhookReplayStore = { claim };
      const service = new WebhookDeliveryService(
        new WebhookSignatureService(),
        store,
      );
      const { input } = delivery();

      await expect(service.verifyAndClaim(input, secret, now)).resolves.toEqual(
        {
          duplicate: false,
          payload: { event: 'order.created', id: 'evt-1' },
        },
      );
      expect(claim).toHaveBeenCalledWith(
        'n8n',
        'delivery-1',
        new Date((Number(timestamp) + 300) * 1000),
      );
    });

    it('returns duplicates when the atomic replay store already claimed an id', async () => {
      const service = new WebhookDeliveryService(
        new WebhookSignatureService(),
        { claim: async () => false },
      );
      const { input } = delivery();

      await expect(
        service.verifyAndClaim(input, secret, now),
      ).resolves.toMatchObject({
        duplicate: true,
      });
    });

    it('fails closed without durable replay storage', async () => {
      const service = new WebhookDeliveryService(new WebhookSignatureService());
      const { input } = delivery();

      await expect(
        service.verifyAndClaim(input, secret, now),
      ).rejects.toMatchObject({
        code: 'REPLAY_STORE_UNAVAILABLE',
      });
    });

    it('does not claim invalid signatures or malformed JSON', async () => {
      const claim = vi.fn(async () => true);
      const service = new WebhookDeliveryService(
        new WebhookSignatureService(),
        {
          claim,
        },
      );
      const invalidSignature = delivery();
      invalidSignature.input.headers.signature = 'sha256=' + '0'.repeat(64);
      await expect(
        service.verifyAndClaim(invalidSignature.input, secret, now),
      ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });

      const invalidPayload = delivery('not-json');
      await expect(
        service.verifyAndClaim(invalidPayload.input, secret, now),
      ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
      expect(claim).not.toHaveBeenCalled();
    });

    it('rejects oversized payloads and reports replay-store failures safely', async () => {
      const service = new WebhookDeliveryService(
        new WebhookSignatureService(),
        {
          claim: async () => {
            throw new Error('private storage detail');
          },
        },
      );
      await expect(
        service.verifyAndClaim(
          {
            providerId: 'n8n',
            deliveryId: 'delivery-oversize',
            headers: { timestamp, signature: 'sha256=' + '0'.repeat(64) },
            rawBody: Buffer.alloc(1_048_577),
          },
          secret,
          now,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_DELIVERY' });

      const { input } = delivery();
      await expect(
        service.verifyAndClaim(input, secret, now),
      ).rejects.toMatchObject({ code: 'REPLAY_STORE_UNAVAILABLE' });
    });
  });

  it('rejects modified payloads and signatures', () => {
    const signature = createWebhookSignature(secret, timestamp, rawBody);
    expect(
      verifyWebhookSignature({
        secret,
        headers: { timestamp, signature },
        rawBody: Buffer.from('{"event":"order.created","id":"evt-2"}'),
        now,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        headers: { timestamp, signature: `${signature.slice(0, -1)}0` },
        rawBody,
        now,
      }),
    ).toBe(false);
  });

  it('rejects stale timestamps, malformed headers, and excessive clock skew', () => {
    const signature = createWebhookSignature(secret, timestamp, rawBody);
    expect(
      verifyWebhookSignature({
        secret,
        headers: { timestamp, signature },
        rawBody,
        now: new Date(now.getTime() + 301_000),
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        headers: { timestamp: '1', signature },
        rawBody,
        now,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        headers: { timestamp, signature: 'sha256=invalid' },
        rawBody,
        now,
      }),
    ).toBe(false);
  });

  it('fails closed for missing headers and weak secrets', () => {
    expect(
      verifyWebhookSignature({
        secret,
        headers: { timestamp: undefined, signature: undefined },
        rawBody,
        now,
      }),
    ).toBe(false);
    expect(() =>
      verifyWebhookSignature({
        secret: 'too-short',
        headers: { timestamp, signature: 'sha256=' + '0'.repeat(64) },
        rawBody,
        now,
      }),
    ).toThrow(/at least 32 bytes/);
  });

  it('rejects invalid verifier configuration', () => {
    expect(() =>
      verifyWebhookSignature({
        secret,
        headers: { timestamp, signature: 'sha256=' + '0'.repeat(64) },
        rawBody,
        now,
        toleranceSeconds: 0,
      }),
    ).toThrow(/configuration is invalid/);
  });
});
