CREATE TABLE IF NOT EXISTS "rate_sheets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_default_rate_sheets" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"rate_sheet_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_number_sequences" (
	"tenant_id" uuid NOT NULL,
	"day_key" text NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_number_sequences_tenant_id_day_key_pk" PRIMARY KEY("tenant_id","day_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_number" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"service_type" text NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"account_id" uuid,
	"pickup_address" text NOT NULL,
	"pickup_lat" text,
	"pickup_lng" text,
	"dropoff_address" text,
	"dropoff_lat" text,
	"dropoff_lng" text,
	"authorized_by" text NOT NULL,
	"authorized_by_name" text,
	"rate_quoted_cents" bigint DEFAULT 0 NOT NULL,
	"rate_breakdown" jsonb,
	"notes" text,
	"cancelled_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_sheets" ADD CONSTRAINT "rate_sheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_sheets" ADD CONSTRAINT "rate_sheets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_default_rate_sheets" ADD CONSTRAINT "tenant_default_rate_sheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_default_rate_sheets" ADD CONSTRAINT "tenant_default_rate_sheets_rate_sheet_id_rate_sheets_id_fk" FOREIGN KEY ("rate_sheet_id") REFERENCES "public"."rate_sheets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_default_rate_sheets" ADD CONSTRAINT "tenant_default_rate_sheets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_number_sequences" ADD CONSTRAINT "job_number_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_sheets_tenant_name_idx" ON "rate_sheets" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_sheets_tenant_active_idx" ON "rate_sheets" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_tenant_status_idx" ON "jobs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_tenant_created_idx" ON "jobs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_tenant_job_number_unique" ON "jobs" USING btree ("tenant_id","job_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_tenant_customer_idx" ON "jobs" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_tenant_vehicle_idx" ON "jobs" USING btree ("tenant_id","vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_tenant_account_idx" ON "jobs" USING btree ("tenant_id","account_id");