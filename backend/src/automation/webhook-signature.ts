import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_REPLAY_STORE = Symbol('WEBHOOK_REPLAY_STORE');
export const WEBHOOK_TOLERANCE_SECONDS = Symbol('WEBHOOK_TOLERANCE_SECONDS');

export interface WebhookSignatureHeaders {
  timestamp: string | undefined;
  signature: string | undefined;
}

export interface WebhookVerificationOptions {
  secret: string;
  headers: WebhookSignatureHeaders;
  rawBody: Buffer;
  now?: Date;
  toleranceSeconds?: number;
}

export interface WebhookReplayStore {
  claim(
    providerId: string,
    deliveryId: string,
    expiresAt: Date,
  ): Promise<boolean>;
}

export interface WebhookDeliveryInput {
  providerId: string;
  deliveryId: string | undefined;
  headers: WebhookSignatureHeaders;
  rawBody: Buffer;
}

export interface WebhookDeliveryResult {
  duplicate: boolean;
  payload: unknown;
}

export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_DELIVERY'
      | 'INVALID_SIGNATURE'
      | 'INVALID_PAYLOAD'
      | 'REPLAY_STORE_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'WebhookDeliveryError';
  }
}

const DEFAULT_TOLERANCE_SECONDS = 300;
const MIN_SECRET_BYTES = 32;
const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

export function createWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
): string {
  return `sha256=${createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest('hex')}`;
}

export function verifyWebhookSignature(
  options: WebhookVerificationOptions,
): boolean {
  const {
    secret,
    headers,
    rawBody,
    now = new Date(),
    toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  } = options;

  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error('Webhook secret must contain at least 32 bytes');
  }
  if (
    !Number.isSafeInteger(toleranceSeconds) ||
    toleranceSeconds < 1 ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error('Webhook verification time configuration is invalid');
  }
  if (
    !headers.timestamp ||
    !/^\d{10}$/.test(headers.timestamp) ||
    !headers.signature ||
    !/^sha256=[a-f0-9]{64}$/.test(headers.signature)
  ) {
    return false;
  }

  const timestamp = Number(headers.timestamp);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = Buffer.from(
    createWebhookSignature(secret, headers.timestamp, rawBody),
    'utf8',
  );
  const supplied = Buffer.from(headers.signature, 'utf8');
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

@Injectable()
export class WebhookSignatureService {
  create(secret: string, timestamp: string, rawBody: Buffer): string {
    return createWebhookSignature(secret, timestamp, rawBody);
  }

  verify(options: WebhookVerificationOptions): boolean {
    return verifyWebhookSignature(options);
  }
}

@Injectable()
export class WebhookDeliveryService {
  constructor(
    private readonly signatureService: WebhookSignatureService,
    @Optional()
    @Inject(WEBHOOK_REPLAY_STORE)
    private readonly replayStore: WebhookReplayStore = {
      claim: async () => {
        throw new WebhookDeliveryError(
          'Durable replay storage is not configured',
          'REPLAY_STORE_UNAVAILABLE',
        );
      },
    },
    @Optional()
    @Inject(WEBHOOK_TOLERANCE_SECONDS)
    private readonly toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  ) {}

  async verifyAndClaim(
    input: WebhookDeliveryInput,
    secret: string,
    now: Date = new Date(),
  ): Promise<WebhookDeliveryResult> {
    if (
      !input.providerId.trim() ||
      !input.deliveryId?.trim() ||
      input.deliveryId.length > 256 ||
      input.rawBody.byteLength === 0 ||
      input.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES
    ) {
      throw new WebhookDeliveryError(
        'Webhook delivery metadata or payload size is invalid',
        'INVALID_DELIVERY',
      );
    }

    if (
      !this.signatureService.verify({
        secret,
        headers: input.headers,
        rawBody: input.rawBody,
        now,
        toleranceSeconds: this.toleranceSeconds,
      })
    ) {
      throw new WebhookDeliveryError(
        'Webhook signature is invalid or expired',
        'INVALID_SIGNATURE',
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw new WebhookDeliveryError(
        'Webhook payload must be valid JSON',
        'INVALID_PAYLOAD',
      );
    }

    const timestamp = Number(input.headers.timestamp);
    const expiresAt = new Date((timestamp + this.toleranceSeconds) * 1000);
    let claimed: boolean;
    try {
      claimed = await this.replayStore.claim(
        input.providerId,
        input.deliveryId,
        expiresAt,
      );
    } catch {
      throw new WebhookDeliveryError(
        'Durable webhook replay storage is unavailable',
        'REPLAY_STORE_UNAVAILABLE',
      );
    }

    return { duplicate: !claimed, payload };
  }
}
