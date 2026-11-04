import { describe, expect, it } from 'vitest';
import {
  calculateOrderTotals,
  applyInventoryMovement,
  CommerceDomainError,
  reconcileCashCollection,
  recordCashCollection,
  transitionOrder,
  validateProductVariant,
  type CommerceOrder,
} from './commerce-domain.js';

const codOrder: CommerceOrder = {
  id: 'order-1',
  paymentMethod: 'cash_on_delivery',
  paymentStatus: 'unpaid',
  status: 'pending_confirmation',
  transitions: [],
};

describe('commerce domain', () => {
  it('validates product SKU, currency, and integer pricing', () => {
    expect(
      validateProductVariant({
        sku: ' item-1 ',
        currency: 'DZD',
        unitAmountMinor: 1250,
        active: true,
      }),
    ).toEqual({
      sku: 'item-1',
      currency: 'DZD',
      unitAmountMinor: 1250,
      active: true,
    });
    expect(() =>
      validateProductVariant({
        sku: 'item-1',
        currency: 'DZD',
        unitAmountMinor: 12.5,
        active: true,
      }),
    ).toThrow(/non-negative integer price/);
  });

  it('applies inventory movements without permitting negative balances', () => {
    expect(
      applyInventoryMovement(
        { sku: 'sku-1', available: 2 },
        {
          sku: 'sku-1',
          quantityDelta: -1,
          reason: 'reservation',
          reference: 'order-1',
          occurredAt: '2026-11-03T17:00:00Z',
        },
      ).balance,
    ).toEqual({ sku: 'sku-1', available: 1 });
    expect(() =>
      applyInventoryMovement(
        { sku: 'sku-1', available: 0 },
        {
          sku: 'sku-1',
          quantityDelta: -1,
          reason: 'reservation',
          reference: 'order-2',
          occurredAt: '2026-11-03T17:00:00Z',
        },
      ),
    ).toThrow(/below zero/);
  });

  it('requires inventory reason and signed quantity to agree', () => {
    expect(() =>
      applyInventoryMovement(
        { sku: 'sku-1', available: 0 },
        {
          sku: 'sku-1',
          quantityDelta: -1,
          reason: 'receipt',
          reference: 'receipt-1',
          occurredAt: '2026-11-03T17:00:00Z',
        },
      ),
    ).toThrow(/does not match its reason/);
  });

  it('calculates currency amounts using integer minor units', () => {
    expect(
      calculateOrderTotals({
        currency: 'DZD',
        lines: [
          { sku: 'sku-1', quantity: 2, unitAmountMinor: 1250 },
          { sku: 'sku-2', quantity: 1, unitAmountMinor: 500 },
        ],
        shippingAmountMinor: 300,
        discountAmountMinor: 250,
      }),
    ).toEqual({
      currency: 'DZD',
      subtotalMinor: 3000,
      shippingAmountMinor: 300,
      discountAmountMinor: 250,
      totalMinor: 3050,
    });
  });

  it('rejects invalid quantities, unsafe numbers and excessive discounts', () => {
    expect(() =>
      calculateOrderTotals({
        currency: 'DZD',
        lines: [{ sku: 'sku-1', quantity: 0, unitAmountMinor: 200 }],
        shippingAmountMinor: 0,
        discountAmountMinor: 0,
      }),
    ).toThrow(CommerceDomainError);

    expect(() =>
      calculateOrderTotals({
        currency: 'DZD',
        lines: [{ sku: 'sku-1', quantity: 1, unitAmountMinor: 100 }],
        shippingAmountMinor: 0,
        discountAmountMinor: 101,
      }),
    ).toThrow(/cannot exceed/);
  });

  it('enforces explicit order status transitions and preserves history', () => {
    const confirmed = transitionOrder(
      codOrder,
      'confirmed',
      new Date('2026-11-03T17:00:00Z'),
    );
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.transitions).toEqual([
      {
        from: 'pending_confirmation',
        to: 'confirmed',
        at: '2026-11-03T17:00:00.000Z',
      },
    ]);
    expect(() => transitionOrder(codOrder, 'delivered')).toThrow(
      /cannot transition/,
    );
  });

  it('does not mark COD payment as collected before delivery', () => {
    expect(() => recordCashCollection(codOrder, 'delivery-receipt-1')).toThrow(
      /delivered COD order/,
    );
  });

  it('requires collection proof and reconciles COD collection separately', () => {
    const delivered: CommerceOrder = {
      ...codOrder,
      status: 'delivered',
    };
    expect(() => recordCashCollection(delivered, '  ')).toThrow(
      /reference is required/,
    );

    const collected = recordCashCollection(delivered, 'delivery-receipt-1');
    expect(collected.paymentStatus).toBe('collected');
    expect(collected.collectionReference).toBe('delivery-receipt-1');
    expect(reconcileCashCollection(collected).paymentStatus).toBe('reconciled');
    expect(() => recordCashCollection(collected, 'delivery-receipt-2')).toThrow(
      /collected once/,
    );
  });

  it('blocks cancellation after COD payment reconciliation', () => {
    const reconciled: CommerceOrder = {
      ...codOrder,
      status: 'processing',
      paymentStatus: 'reconciled',
    };
    expect(() => transitionOrder(reconciled, 'cancelled')).toThrow(
      /refund workflow/,
    );
  });

  it('requires an explicit refund flow before a paid order is returned', () => {
    const paid: CommerceOrder = {
      ...codOrder,
      status: 'delivered',
      paymentStatus: 'collected',
      collectionReference: 'delivery-receipt-1',
    };
    expect(() => transitionOrder(paid, 'returned')).toThrow(/refund workflow/);
  });
});
