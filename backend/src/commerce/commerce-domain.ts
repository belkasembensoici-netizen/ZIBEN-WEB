import { Injectable } from '@nestjs/common';

export type OrderStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivery_failed'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type PaymentMethod = 'cash_on_delivery' | 'prepaid';
export type PaymentStatus = 'unpaid' | 'collected' | 'reconciled' | 'refunded';

export interface OrderLine {
  sku: string;
  quantity: number;
  unitAmountMinor: number;
}

export interface OrderTotalsInput {
  currency: string;
  lines: readonly OrderLine[];
  shippingAmountMinor: number;
  discountAmountMinor: number;
}

export interface OrderTotals {
  currency: string;
  subtotalMinor: number;
  shippingAmountMinor: number;
  discountAmountMinor: number;
  totalMinor: number;
}

export interface OrderTransition {
  from: OrderStatus;
  to: OrderStatus;
  at: string;
}

export interface ProductVariant {
  sku: string;
  currency: string;
  unitAmountMinor: number;
  active: boolean;
}

export interface InventoryBalance {
  sku: string;
  available: number;
}

export interface InventoryMovement {
  sku: string;
  quantityDelta: number;
  reason: 'receipt' | 'correction' | 'reservation' | 'release';
  reference: string;
  occurredAt: string;
}

export interface CommerceOrder {
  id: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  collectionReference?: string;
  transitions: readonly OrderTransition[];
}

export class CommerceDomainError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_TOTALS'
      | 'INVALID_TRANSITION'
      | 'INVALID_PAYMENT_STATE'
      | 'INVALID_COLLECTION_PROOF'
      | 'INVALID_PRODUCT'
      | 'INVALID_INVENTORY_MOVEMENT',
  ) {
    super(message);
    this.name = 'CommerceDomainError';
  }
}

const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    pending_confirmation: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered', 'delivery_failed'],
    delivery_failed: ['shipped', 'cancelled'],
    delivered: ['returned'],
    cancelled: [],
    returned: [],
  };

export function validateProductVariant(
  variant: ProductVariant,
): ProductVariant {
  if (
    !variant.sku.trim() ||
    variant.sku.length > 128 ||
    !/^[A-Z]{3}$/.test(variant.currency) ||
    !Number.isSafeInteger(variant.unitAmountMinor) ||
    variant.unitAmountMinor < 0 ||
    typeof variant.active !== 'boolean'
  ) {
    throw new CommerceDomainError(
      'Product variant must have a SKU, ISO currency code, and non-negative integer price',
      'INVALID_PRODUCT',
    );
  }
  return { ...variant, sku: variant.sku.trim() };
}

export function applyInventoryMovement(
  balance: InventoryBalance,
  movement: InventoryMovement,
): { balance: InventoryBalance; movement: InventoryMovement } {
  if (
    !balance.sku.trim() ||
    balance.sku !== movement.sku ||
    !Number.isSafeInteger(balance.available) ||
    balance.available < 0 ||
    !Number.isSafeInteger(movement.quantityDelta) ||
    movement.quantityDelta === 0 ||
    !movement.reference.trim() ||
    !Number.isFinite(Date.parse(movement.occurredAt))
  ) {
    throw new CommerceDomainError(
      'Inventory movement has invalid SKU, quantity, reference, or timestamp',
      'INVALID_INVENTORY_MOVEMENT',
    );
  }

  const reasonMatchesDelta =
    (movement.reason === 'receipt' &&
      Number.isSafeInteger(movement.quantityDelta) &&
      movement.quantityDelta > 0) ||
    (movement.reason !== 'receipt' &&
      Number.isSafeInteger(movement.quantityDelta) &&
      movement.quantityDelta < 0);
  if (!reasonMatchesDelta) {
    throw new CommerceDomainError(
      'Inventory movement quantity does not match its reason',
      'INVALID_INVENTORY_MOVEMENT',
    );
  }

  const available = balance.available + movement.quantityDelta;
  if (!Number.isSafeInteger(available) || available < 0) {
    throw new CommerceDomainError(
      'Inventory movement cannot reduce available stock below zero',
      'INVALID_INVENTORY_MOVEMENT',
    );
  }

  return {
    balance: { sku: balance.sku, available },
    movement: { ...movement, reference: movement.reference.trim() },
  };
}

function assertMinorAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CommerceDomainError(
      'Order amounts must be non-negative integer minor units',
      'INVALID_TOTALS',
    );
  }
}

export function calculateOrderTotals(input: OrderTotalsInput): OrderTotals {
  if (!/^[A-Z]{3}$/.test(input.currency) || input.lines.length === 0) {
    throw new CommerceDomainError(
      'Currency code and at least one order line are required',
      'INVALID_TOTALS',
    );
  }

  const subtotalMinor = input.lines.reduce((total, line) => {
    if (
      !line.sku.trim() ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1
    ) {
      throw new CommerceDomainError(
        'Each order line requires a SKU and positive integer quantity',
        'INVALID_TOTALS',
      );
    }
    assertMinorAmount(line.unitAmountMinor);
    const lineTotal = line.quantity * line.unitAmountMinor;
    const nextTotal = total + lineTotal;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(nextTotal)) {
      throw new CommerceDomainError(
        'Order subtotal exceeds the supported integer range',
        'INVALID_TOTALS',
      );
    }
    return nextTotal;
  }, 0);

  assertMinorAmount(input.shippingAmountMinor);
  assertMinorAmount(input.discountAmountMinor);
  if (input.discountAmountMinor > subtotalMinor) {
    throw new CommerceDomainError(
      'Discount cannot exceed the item subtotal',
      'INVALID_TOTALS',
    );
  }

  const totalMinor =
    subtotalMinor + input.shippingAmountMinor - input.discountAmountMinor;
  if (!Number.isSafeInteger(totalMinor)) {
    throw new CommerceDomainError(
      'Order total exceeds the supported integer range',
      'INVALID_TOTALS',
    );
  }

  return {
    currency: input.currency,
    subtotalMinor,
    shippingAmountMinor: input.shippingAmountMinor,
    discountAmountMinor: input.discountAmountMinor,
    totalMinor,
  };
}

export function transitionOrder(
  order: CommerceOrder,
  nextStatus: OrderStatus,
  at: Date = new Date(),
): CommerceOrder {
  const allowedTransitions = ORDER_TRANSITIONS[order.status];
  if (
    !Number.isFinite(at.getTime()) ||
    !allowedTransitions ||
    !allowedTransitions.includes(nextStatus)
  ) {
    throw new CommerceDomainError(
      `Order cannot transition from ${order.status} to ${nextStatus}`,
      'INVALID_TRANSITION',
    );
  }
  if (order.paymentStatus === 'reconciled' && nextStatus === 'cancelled') {
    throw new CommerceDomainError(
      'A reconciled payment cannot be cancelled without a refund workflow',
      'INVALID_PAYMENT_STATE',
    );
  }
  if (nextStatus === 'returned' && order.paymentStatus !== 'unpaid') {
    throw new CommerceDomainError(
      'A paid order requires an explicit refund workflow before return',
      'INVALID_PAYMENT_STATE',
    );
  }

  return {
    ...order,
    status: nextStatus,
    transitions: [
      ...order.transitions,
      {
        from: order.status,
        to: nextStatus,
        at: at.toISOString(),
      },
    ],
  };
}

export function recordCashCollection(
  order: CommerceOrder,
  collectionReference: string,
): CommerceOrder {
  if (!collectionReference.trim()) {
    throw new CommerceDomainError(
      'A collection reference is required',
      'INVALID_COLLECTION_PROOF',
    );
  }
  if (
    order.paymentMethod !== 'cash_on_delivery' ||
    order.status !== 'delivered' ||
    order.paymentStatus !== 'unpaid'
  ) {
    throw new CommerceDomainError(
      'Cash can only be collected once for a delivered COD order',
      'INVALID_PAYMENT_STATE',
    );
  }

  return {
    ...order,
    paymentStatus: 'collected',
    collectionReference: collectionReference.trim(),
  };
}

export function reconcileCashCollection(order: CommerceOrder): CommerceOrder {
  if (
    order.paymentMethod !== 'cash_on_delivery' ||
    order.paymentStatus !== 'collected' ||
    !order.collectionReference?.trim()
  ) {
    throw new CommerceDomainError(
      'Only collected COD payments can be reconciled',
      'INVALID_PAYMENT_STATE',
    );
  }
  return { ...order, paymentStatus: 'reconciled' };
}

@Injectable()
export class CommerceDomainService {
  validateVariant(variant: ProductVariant): ProductVariant {
    return validateProductVariant(variant);
  }

  applyInventoryMovement(
    balance: InventoryBalance,
    movement: InventoryMovement,
  ): { balance: InventoryBalance; movement: InventoryMovement } {
    return applyInventoryMovement(balance, movement);
  }

  calculateTotals(input: OrderTotalsInput): OrderTotals {
    return calculateOrderTotals(input);
  }

  transition(
    order: CommerceOrder,
    nextStatus: OrderStatus,
    at?: Date,
  ): CommerceOrder {
    return transitionOrder(order, nextStatus, at);
  }

  recordCashCollection(
    order: CommerceOrder,
    collectionReference: string,
  ): CommerceOrder {
    return recordCashCollection(order, collectionReference);
  }

  reconcileCashCollection(order: CommerceOrder): CommerceOrder {
    return reconcileCashCollection(order);
  }
}
