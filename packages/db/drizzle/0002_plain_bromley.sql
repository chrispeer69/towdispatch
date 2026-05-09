CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_number" text,
	"billing_terms" text DEFAULT 'net_30' NOT NULL,
	"credit_limit" numeric(12, 2),
	"credit_used" numeric(12, 2) DEFAULT '0' NOT NULL,
	"billing_address" jsonb,
	"billing_email" text,
	"billing_phone" text,
	"ap_contact_name" text,
	"ap_contact_email" text,
	"coi_required" boolean DEFAULT false NOT NULL,
	"coi_expires_at" date,
	"coi_document_url" text,
	"default_rate_sheet_id" uuid,
	"is_motor_club" boolean DEFAULT false NOT NULL,
	"motor_club_network_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text DEFAULT 'cash' NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"billing_address" jsonb,
	"account_id" uuid,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"tax_exempt_certificate_url" text,
	"notes" text,
	"default_rate_sheet_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vin" char(17),
	"plate" text,
	"plate_state" char(2),
	"year" smallint,
	"make" text,
	"model" text,
	"trim" text,
	"color" text,
	"body_class" text,
	"vehicle_class" text DEFAULT 'unknown' NOT NULL,
	"drivetrain" text DEFAULT 'unknown' NOT NULL,
	"is_electric" boolean DEFAULT false NOT NULL,
	"is_low_clearance" boolean DEFAULT false NOT NULL,
	"special_instructions" text,
	"default_customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"relationship" text DEFAULT 'owner' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customers" ADD CONSTRAINT "customers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_default_customer_id_customers_id_fk" FOREIGN KEY ("default_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_tenant_name_unique" ON "accounts" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_tenant_active_idx" ON "accounts" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_motor_club_idx" ON "accounts" USING btree ("tenant_id","is_motor_club");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_tenant_name_idx" ON "customers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_tenant_phone_idx" ON "customers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_tenant_email_idx" ON "customers" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_tenant_account_idx" ON "customers" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_tenant_type_idx" ON "customers" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_tenant_vin_idx" ON "vehicles" USING btree ("tenant_id","vin");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_tenant_plate_idx" ON "vehicles" USING btree ("tenant_id","plate","plate_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_tenant_ymm_idx" ON "vehicles" USING btree ("tenant_id","make","model","year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_tenant_class_idx" ON "vehicles" USING btree ("tenant_id","vehicle_class");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_vehicles_tenant_customer_idx" ON "customer_vehicles" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_vehicles_tenant_vehicle_idx" ON "customer_vehicles" USING btree ("tenant_id","vehicle_id");