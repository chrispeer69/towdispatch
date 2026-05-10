-- 0006 — fleet support tables: driver_truck_assignments, documents, dvirs,
-- maintenance_schedules, maintenance_records.
--
-- Decision (documented in commit): the drivers/trucks Session-5 base table
-- shape from 0005 already absorbs the Session 8 extension columns, so we
-- don't need an ALTER pass here. Splitting "base" from "extensions" only
-- buys us a clean rebase if Session 5 lands first; the COO accepts that
-- cost on rebase rather than carrying two near-identical migrations.

CREATE TABLE IF NOT EXISTS "driver_truck_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dvirs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"type" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"odometer_reading" bigint,
	"defects" jsonb DEFAULT '[]' NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"schedule_type" text NOT NULL,
	"service_type" text NOT NULL,
	"custom_label" text,
	"interval_miles" integer,
	"interval_days" integer,
	"last_serviced_at" date,
	"last_serviced_miles" bigint,
	"next_due_at" date,
	"next_due_miles" bigint,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"schedule_id" uuid,
	"performed_at" date NOT NULL,
	"performed_miles" bigint,
	"service_type" text NOT NULL,
	"custom_label" text,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"vendor" text,
	"notes" text,
	"document_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_truck_assignments" ADD CONSTRAINT "dta_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_truck_assignments" ADD CONSTRAINT "dta_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_truck_assignments" ADD CONSTRAINT "dta_truck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_truck_assignments" ADD CONSTRAINT "dta_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dvirs" ADD CONSTRAINT "dvirs_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dvirs" ADD CONSTRAINT "dvirs_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dvirs" ADD CONSTRAINT "dvirs_truck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dvirs" ADD CONSTRAINT "dvirs_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maint_sched_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maint_sched_truck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maint_sched_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_records" ADD CONSTRAINT "maint_rec_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_records" ADD CONSTRAINT "maint_rec_truck_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_records" ADD CONSTRAINT "maint_rec_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."maintenance_schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_records" ADD CONSTRAINT "maint_rec_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_truck_assignments_tenant_driver_idx" ON "driver_truck_assignments" USING btree ("tenant_id","driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_truck_assignments_tenant_truck_idx" ON "driver_truck_assignments" USING btree ("tenant_id","truck_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_tenant_owner_idx" ON "documents" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_tenant_doc_type_idx" ON "documents" USING btree ("tenant_id","doc_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_tenant_expires_idx" ON "documents" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dvirs_tenant_driver_idx" ON "dvirs" USING btree ("tenant_id","driver_id","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dvirs_tenant_truck_idx" ON "dvirs" USING btree ("tenant_id","truck_id","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dvirs_tenant_status_idx" ON "dvirs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maint_sched_tenant_truck_idx" ON "maintenance_schedules" USING btree ("tenant_id","truck_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maint_sched_tenant_status_idx" ON "maintenance_schedules" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maint_sched_tenant_due_at_idx" ON "maintenance_schedules" USING btree ("tenant_id","next_due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maint_rec_tenant_truck_idx" ON "maintenance_records" USING btree ("tenant_id","truck_id","performed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maint_rec_tenant_sched_idx" ON "maintenance_records" USING btree ("tenant_id","schedule_id");
