REVOKE ALL PRIVILEGES ON SCHEMA app FROM app_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA app FROM app_runtime;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app FROM app_runtime;
--> statement-breakpoint
REVOKE USAGE ON TYPE app.tenant_role FROM app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE schema_owner IN SCHEMA app
  REVOKE ALL PRIVILEGES ON TABLES FROM app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE schema_owner IN SCHEMA app
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM app_runtime;
