CREATE TABLE IF NOT EXISTS "drivers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"employee_number" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"email" text,
	"cdl_class" text DEFAULT 'none' NOT NULL,
	"cdl_expires_at" date,
	"hired_at" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trucks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_number" text NOT NULL,
	"truck_type" text DEFAULT 'light_duty' NOT NULL,
	"year" text,
	"make" text,
	"model" text,
	"plate" text,
	"plate_state" text,
	"vin" text,
	"in_service" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"truck_id" uuid,
	"status" text DEFAULT 'available' NOT NULL,
	"current_job_id" uuid,
	"last_lat" text,
	"last_lng" text,
	"last_position_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_status_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "assigned_driver_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "assigned_truck_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "assigned_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drivers" ADD CONSTRAINT "drivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drivers" ADD CONSTRAINT "drivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trucks" ADD CONSTRAINT "trucks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trucks" ADD CONSTRAINT "trucks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_status_transitions" ADD CONSTRAINT "job_status_transitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_status_transitions" ADD CONSTRAINT "job_status_transitions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_status_transitions" ADD CONSTRAINT "job_status_transitions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_driver_id_drivers_id_fk" FOREIGN KEY ("assigned_driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_truck_id_trucks_id_fk" FOREIGN KEY ("assigned_truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_shift_id_driver_shifts_id_fk" FOREIGN KEY ("assigned_shift_id") REFERENCES "public"."driver_shifts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drivers_tenant_active_idx" ON "drivers" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drivers_tenant_name_idx" ON "drivers" USING btree ("tenant_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drivers_tenant_user_idx" ON "drivers" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drivers_tenant_employee_number_unique" ON "drivers" USING btree ("tenant_id","employee_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trucks_tenant_unit_number_unique" ON "trucks" USING btree ("tenant_id","unit_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trucks_tenant_type_idx" ON "trucks" USING btree ("tenant_id","truck_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trucks_tenant_in_service_idx" ON "trucks" USING btree ("tenant_id","in_service");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_shifts_tenant_driver_idx" ON "driver_shifts" USING btree ("tenant_id","driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_shifts_tenant_truck_idx" ON "driver_shifts" USING btree ("tenant_id","truck_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_shifts_tenant_ended_idx" ON "driver_shifts" USING btree ("tenant_id","ended_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_shifts_tenant_status_idx" ON "driver_shifts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_shifts_tenant_current_job_idx" ON "driver_shifts" USING btree ("tenant_id","current_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_status_transitions_tenant_job_idx" ON "job_status_transitions" USING btree ("tenant_id","job_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_tenant_assigned_driver_idx" ON "jobs" USING btree ("tenant_id","assigned_driver_id");
