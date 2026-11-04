import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const app = pgSchema('app');
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const recordId = () => uuid('id').primaryKey().defaultRandom();
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const tenantRole = app.enum('tenant_role', ['owner', 'admin', 'member']);

export const tenants = app.table(
  'tenants',
  {
    id: recordId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('active'),
    defaultCurrency: text('default_currency').notNull().default('DZD'),
    defaultLocale: text('default_locale').notNull().default('en'),
    timeZone: text('time_zone').notNull().default('Africa/Algiers'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('tenants_slug_uq').on(table.slug)],
);

export const users = app.table(
  'users',
  {
    id: recordId(),
    identityIssuer: text('identity_issuer').notNull(),
    identitySubject: text('identity_subject').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_identity_uq').on(
      table.identityIssuer,
      table.identitySubject,
    ),
  ],
);

export const tenantMemberships = app.table(
  'tenant_memberships',
  {
    id: recordId(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: tenantRole('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('tenant_memberships_tenant_user_uq').on(
      table.tenantId,
      table.userId,
    ),
    index('tenant_memberships_user_idx').on(table.userId),
  ],
);

export const permissions = app.table(
  'permissions',
  {
    id: recordId(),
    key: text('key').notNull(),
    description: text('description').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('permissions_key_uq').on(table.key)],
);

export const tenantRolePermissions = app.table(
  'tenant_role_permissions',
  {
    id: recordId(),
    tenantId: tenantId(),
    role: tenantRole('role').notNull(),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('tenant_role_permissions_scope_uq').on(
      table.tenantId,
      table.role,
      table.permissionId,
    ),
    index('tenant_role_permissions_tenant_role_idx').on(
      table.tenantId,
      table.role,
    ),
  ],
);

export const categories = app.table(
  'categories',
  {
    id: recordId(),
    tenantId: tenantId(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('categories_tenant_slug_uq').on(table.tenantId, table.slug),
    uniqueIndex('categories_tenant_id_uq').on(table.tenantId, table.id),
    index('categories_tenant_parent_idx').on(table.tenantId, table.parentId),
    foreignKey({
      name: 'categories_tenant_parent_fk',
      columns: [table.tenantId, table.parentId],
      foreignColumns: [table.tenantId, table.id],
    }),
  ],
);

export const products = app.table(
  'products',
  {
    id: recordId(),
    tenantId: tenantId(),
    categoryId: uuid('category_id'),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('products_tenant_id_uq').on(table.tenantId, table.id),
    index('products_tenant_status_idx').on(table.tenantId, table.status),
    foreignKey({
      name: 'products_tenant_category_fk',
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [categories.tenantId, categories.id],
    }),
  ],
);

export const productVariants = app.table(
  'product_variants',
  {
    id: recordId(),
    tenantId: tenantId(),
    productId: uuid('product_id').notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    priceMinor: integer('price_minor').notNull(),
    currency: text('currency').notNull(),
    attributes: jsonb('attributes')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('product_variants_tenant_sku_uq').on(table.tenantId, table.sku),
    uniqueIndex('product_variants_tenant_id_uq').on(table.tenantId, table.id),
    index('product_variants_tenant_product_idx').on(
      table.tenantId,
      table.productId,
    ),
    check('product_variants_price_nonnegative_ck', sql`price_minor >= 0`),
    foreignKey({
      name: 'product_variants_tenant_product_fk',
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
    }),
  ],
);

export const inventory = app.table(
  'inventory',
  {
    id: recordId(),
    tenantId: tenantId(),
    variantId: uuid('variant_id').notNull(),
    quantity: integer('quantity').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('inventory_tenant_variant_uq').on(
      table.tenantId,
      table.variantId,
    ),
    check('inventory_quantity_nonnegative_ck', sql`quantity >= 0`),
    foreignKey({
      name: 'inventory_tenant_variant_fk',
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
    }),
  ],
);

export const stockMovements = app.table(
  'stock_movements',
  {
    id: recordId(),
    tenantId: tenantId(),
    variantId: uuid('variant_id').notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    reason: text('reason').notNull(),
    reference: text('reference'),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index('stock_movements_tenant_variant_created_idx').on(
      table.tenantId,
      table.variantId,
      table.createdAt,
    ),
    check('stock_movements_delta_nonzero_ck', sql`quantity_delta <> 0`),
    foreignKey({
      name: 'stock_movements_tenant_variant_fk',
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
    }),
  ],
);

export const customers = app.table(
  'customers',
  {
    id: recordId(),
    tenantId: tenantId(),
    displayName: text('display_name').notNull(),
    phone: text('phone'),
    email: text('email'),
    address: jsonb('address').$type<Record<string, string>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('customers_tenant_id_uq').on(table.tenantId, table.id),
    index('customers_tenant_phone_idx').on(table.tenantId, table.phone),
  ],
);

export const orders = app.table(
  'orders',
  {
    id: recordId(),
    tenantId: tenantId(),
    customerId: uuid('customer_id').notNull(),
    status: text('status').notNull().default('pending'),
    paymentMethod: text('payment_method').notNull().default('cod'),
    currency: text('currency').notNull(),
    subtotalMinor: integer('subtotal_minor').notNull(),
    shippingMinor: integer('shipping_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('orders_tenant_id_uq').on(table.tenantId, table.id),
    index('orders_tenant_status_created_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    check(
      'orders_amounts_nonnegative_ck',
      sql`subtotal_minor >= 0 AND shipping_minor >= 0 AND total_minor >= 0`,
    ),
    foreignKey({
      name: 'orders_tenant_customer_fk',
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
  ],
);

export const orderItems = app.table(
  'order_items',
  {
    id: recordId(),
    tenantId: tenantId(),
    orderId: uuid('order_id').notNull(),
    variantId: uuid('variant_id'),
    skuSnapshot: text('sku_snapshot').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('order_items_tenant_order_idx').on(table.tenantId, table.orderId),
    check(
      'order_items_values_positive_ck',
      sql`quantity > 0 AND unit_price_minor >= 0`,
    ),
    foreignKey({
      name: 'order_items_tenant_order_fk',
      columns: [table.tenantId, table.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }),
    foreignKey({
      name: 'order_items_tenant_variant_fk',
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
    }),
  ],
);

export const codCollections = app.table(
  'cod_collections',
  {
    id: recordId(),
    tenantId: tenantId(),
    orderId: uuid('order_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    collectionReference: text('collection_reference').notNull(),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('cod_collections_tenant_reference_uq').on(
      table.tenantId,
      table.collectionReference,
    ),
    index('cod_collections_tenant_order_idx').on(table.tenantId, table.orderId),
    check('cod_collections_amount_positive_ck', sql`amount_minor > 0`),
    foreignKey({
      name: 'cod_collections_tenant_order_fk',
      columns: [table.tenantId, table.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }),
  ],
);

export const agentDefinitions = app.table(
  'agent_definitions',
  {
    id: recordId(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    allowedToolIds: jsonb('allowed_tool_ids').$type<string[]>().notNull(),
    configuration: jsonb('configuration')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('agent_definitions_tenant_name_version_uq').on(
      table.tenantId,
      table.name,
      table.version,
    ),
    uniqueIndex('agent_definitions_tenant_id_uq').on(table.tenantId, table.id),
    check(
      'agent_definitions_version_positive_ck',
      sql`version > 0 AND jsonb_typeof(allowed_tool_ids) = 'array'`,
    ),
  ],
);

export const agentExecutions = app.table(
  'agent_executions',
  {
    id: recordId(),
    tenantId: tenantId(),
    agentId: uuid('agent_id').notNull(),
    agentVersion: integer('agent_version').notNull(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('running'),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    failureCode: text('failure_code'),
    startedAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('agent_executions_tenant_id_uq').on(table.tenantId, table.id),
    index('agent_executions_tenant_started_idx').on(
      table.tenantId,
      table.startedAt,
    ),
    check(
      'agent_executions_usage_nonnegative_ck',
      sql`input_tokens >= 0 AND output_tokens >= 0 AND agent_version > 0`,
    ),
    foreignKey({
      name: 'agent_executions_tenant_agent_fk',
      columns: [table.tenantId, table.agentId],
      foreignColumns: [agentDefinitions.tenantId, agentDefinitions.id],
    }),
  ],
);

export const agentExecutionSteps = app.table(
  'agent_execution_steps',
  {
    id: recordId(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    toolId: text('tool_id').notNull(),
    status: text('status').notNull(),
    input: jsonb('input').$type<unknown>(),
    output: jsonb('output').$type<unknown>(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('agent_execution_steps_tenant_execution_index_uq').on(
      table.tenantId,
      table.executionId,
      table.stepIndex,
    ),
    foreignKey({
      name: 'agent_execution_steps_tenant_execution_fk',
      columns: [table.tenantId, table.executionId],
      foreignColumns: [agentExecutions.tenantId, agentExecutions.id],
    }),
  ],
);

export const automationDefinitions = app.table(
  'automation_definitions',
  {
    id: recordId(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    provider: text('provider').notNull().default('internal'),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('automation_definitions_tenant_id_uq').on(
      table.tenantId,
      table.id,
    ),
  ],
);

export const automationExecutions = app.table(
  'automation_executions',
  {
    id: recordId(),
    tenantId: tenantId(),
    automationId: uuid('automation_id').notNull(),
    status: text('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('automation_executions_tenant_key_uq').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    uniqueIndex('automation_executions_tenant_id_uq').on(
      table.tenantId,
      table.id,
    ),
    index('automation_executions_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: 'automation_executions_tenant_definition_fk',
      columns: [table.tenantId, table.automationId],
      foreignColumns: [
        automationDefinitions.tenantId,
        automationDefinitions.id,
      ],
    }),
  ],
);

export const marketEvidence = app.table(
  'market_evidence',
  {
    id: recordId(),
    tenantId: tenantId(),
    sourceUri: text('source_uri').notNull(),
    sourceName: text('source_name').notNull(),
    countryCode: text('country_code').notNull(),
    regionCode: text('region_code'),
    language: text('language').notNull(),
    evidenceType: text('evidence_type').notNull(),
    claim: text('claim').notNull(),
    confidence: integer('confidence').notNull(),
    verificationStatus: text('verification_status')
      .notNull()
      .default('unverified'),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index('market_evidence_tenant_country_region_idx').on(
      table.tenantId,
      table.countryCode,
      table.regionCode,
    ),
    index('market_evidence_tenant_collected_idx').on(
      table.tenantId,
      table.collectedAt,
    ),
  ],
);

export const auditEvents = app.table(
  'audit_events',
  {
    id: recordId(),
    tenantId: tenantId(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome').notNull(),
    requestId: text('request_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_events_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    index('audit_events_tenant_actor_idx').on(
      table.tenantId,
      table.actorUserId,
    ),
  ],
);

export const schema = {
  tenants,
  users,
  tenantMemberships,
  permissions,
  tenantRolePermissions,
  categories,
  products,
  productVariants,
  inventory,
  stockMovements,
  customers,
  orders,
  orderItems,
  codCollections,
  agentDefinitions,
  agentExecutions,
  agentExecutionSteps,
  automationDefinitions,
  automationExecutions,
  marketEvidence,
  auditEvents,
};
