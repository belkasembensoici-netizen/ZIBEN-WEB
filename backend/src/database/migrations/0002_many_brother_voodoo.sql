ALTER TABLE "app"."agent_execution_steps" DROP CONSTRAINT "agent_execution_steps_execution_id_agent_executions_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."agent_executions" DROP CONSTRAINT "agent_executions_agent_id_agent_definitions_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."automation_executions" DROP CONSTRAINT "automation_executions_automation_id_automation_definitions_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."cod_collections" DROP CONSTRAINT "cod_collections_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."inventory" DROP CONSTRAINT "inventory_variant_id_product_variants_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."order_items" DROP CONSTRAINT "order_items_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."order_items" DROP CONSTRAINT "order_items_variant_id_product_variants_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."orders" DROP CONSTRAINT "orders_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."product_variants" DROP CONSTRAINT "product_variants_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."products" DROP CONSTRAINT "products_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."stock_movements" DROP CONSTRAINT "stock_movements_variant_id_product_variants_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_tenant_id_uq" ON "app"."categories" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "app"."agent_execution_steps" ADD CONSTRAINT "agent_execution_steps_tenant_execution_fk" FOREIGN KEY ("tenant_id","execution_id") REFERENCES "app"."agent_executions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_executions" ADD CONSTRAINT "agent_executions_tenant_agent_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "app"."agent_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."automation_executions" ADD CONSTRAINT "automation_executions_tenant_definition_fk" FOREIGN KEY ("tenant_id","automation_id") REFERENCES "app"."automation_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."categories" ADD CONSTRAINT "categories_tenant_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "app"."categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cod_collections" ADD CONSTRAINT "cod_collections_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "app"."orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory" ADD CONSTRAINT "inventory_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "app"."product_variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "app"."orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "app"."product_variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "app"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_variants" ADD CONSTRAINT "product_variants_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_tenant_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "app"."categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "app"."product_variants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_definitions" ADD CONSTRAINT "agent_definitions_version_positive_ck" CHECK (version > 0 AND jsonb_typeof(allowed_tool_ids) = 'array');--> statement-breakpoint
ALTER TABLE "app"."agent_executions" ADD CONSTRAINT "agent_executions_usage_nonnegative_ck" CHECK (input_tokens >= 0 AND output_tokens >= 0 AND agent_version > 0);--> statement-breakpoint
ALTER TABLE "app"."cod_collections" ADD CONSTRAINT "cod_collections_amount_positive_ck" CHECK (amount_minor > 0);--> statement-breakpoint
ALTER TABLE "app"."inventory" ADD CONSTRAINT "inventory_quantity_nonnegative_ck" CHECK (quantity >= 0);--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_values_positive_ck" CHECK (quantity > 0 AND unit_price_minor >= 0);--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_amounts_nonnegative_ck" CHECK (subtotal_minor >= 0 AND shipping_minor >= 0 AND total_minor >= 0);--> statement-breakpoint
ALTER TABLE "app"."product_variants" ADD CONSTRAINT "product_variants_price_nonnegative_ck" CHECK (price_minor >= 0);--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_delta_nonzero_ck" CHECK (quantity_delta <> 0);
--> statement-breakpoint
ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.tenants
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users FORCE ROW LEVEL SECURITY;
CREATE POLICY verified_identity_scope ON app.users
  USING (
    identity_issuer = nullif(current_setting('app.identity_issuer', true), '')
    AND identity_subject = nullif(current_setting('app.identity_subject', true), '')
  )
  WITH CHECK (
    identity_issuer = nullif(current_setting('app.identity_issuer', true), '')
    AND identity_subject = nullif(current_setting('app.identity_subject', true), '')
  );
--> statement-breakpoint
ALTER TABLE app.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_membership_scope ON app.tenant_memberships
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND (
      user_id = nullif(current_setting('app.user_id', true), '')::uuid
      OR EXISTS (
        SELECT 1
        FROM app.users identity_user
        WHERE identity_user.id = tenant_memberships.user_id
          AND identity_user.identity_issuer = nullif(current_setting('app.identity_issuer', true), '')
          AND identity_user.identity_subject = nullif(current_setting('app.identity_subject', true), '')
      )
    )
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE app.tenant_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_role_permission_scope ON app.tenant_role_permissions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.categories
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.products
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.product_variants
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.inventory
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.stock_movements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.customers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.orders
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.order_items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.cod_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cod_collections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.cod_collections
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.agent_definitions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.agent_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.agent_executions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.agent_execution_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_execution_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.agent_execution_steps
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.automation_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.automation_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.automation_definitions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.automation_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.automation_executions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.market_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.market_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.market_evidence
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.audit_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
INSERT INTO app.permissions (key, description) VALUES
  ('products:read', 'View product catalog'),
  ('products:write', 'Manage products and variants'),
  ('inventory:read', 'View inventory and stock movements'),
  ('inventory:write', 'Adjust inventory'),
  ('customers:read', 'View customer records'),
  ('customers:write', 'Manage customer records'),
  ('orders:read', 'View orders and COD records'),
  ('orders:write', 'Manage orders and COD records'),
  ('agents:manage', 'Manage and execute AI agents'),
  ('automation:manage', 'Manage automations and executions'),
  ('market-intelligence:read', 'View market intelligence evidence'),
  ('audit:read', 'View tenant audit events'),
  ('tenant:manage', 'Manage tenant membership and role grants')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
GRANT USAGE ON TYPE app.tenant_role TO app_runtime, app_test_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime, app_test_runtime;
REVOKE INSERT, UPDATE, DELETE ON app.permissions FROM app_runtime, app_test_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime, app_test_runtime;
--> statement-breakpoint