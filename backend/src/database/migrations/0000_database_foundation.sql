SET LOCAL ROLE schema_owner;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO app_runtime, app_test_runtime;
--> statement-breakpoint
RESET ROLE;
