-- 0011 — Session 15 notifications backbone.
--
-- Hand-authored to add the eight notification tables that unify push, SMS,
-- email, in-app, and webhook delivery for the entire platform:
--
--   * notifications              — one row per accepted dispatch request
--   * notification_deliveries    — one row per channel attempt + retry state
--   * notification_preferences   — per-user × event-category × channel matrix
--   * notification_quiet_hours   — per-user quiet hours + override list
--   * notification_templates     — system + tenant Handlebars templates
--   * webhook_subscriptions      — outbound HMAC-signed endpoints
--   * webhook_deliveries         — outbound webhook attempt log
--   * notification_dead_letters  — exhausted-retry parking lot
--   * notification_device_tokens — FCM/APNs tokens, tenant-scoped
--
-- Strict additive migration: no changes to existing columns/tables. RLS,
-- partial uniques, audit triggers land in sql/0038_notifications.sql.

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_user_id" uuid,
	"recipient_role_scope" text,
	"event_type" text NOT NULL,
	"template_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_channels" jsonb,
	"idempotency_key" text,
	"idempotency_expires_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_tenant_created_idx" ON "notifications" ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_tenant_recipient_idx" ON "notifications" ("tenant_id","recipient_user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_tenant_event_idx" ON "notifications" ("tenant_id","event_type");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient_user_id" uuid,
	"target_address" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"provider_message_id" text,
	"provider_name" text,
	"rendered_subject" text,
	"rendered_body" text,
	"last_error" text,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_tenant_status_idx" ON "notification_deliveries" ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_notification_idx" ON "notification_deliveries" ("notification_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_tenant_channel_idx" ON "notification_deliveries" ("tenant_id","channel","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_tenant_recipient_unread_idx" ON "notification_deliveries" ("tenant_id","recipient_user_id","read_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_provider_lookup_idx" ON "notification_deliveries" ("provider_name","provider_message_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"event_category" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_preferences_tenant_user_idx" ON "notification_preferences" ("tenant_id","user_id","event_category");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_quiet_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"start_local" text DEFAULT '22:00' NOT NULL,
	"end_local" text DEFAULT '07:00' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"override_event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_quiet_hours" ADD CONSTRAINT "notification_quiet_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_quiet_hours" ADD CONSTRAINT "notification_quiet_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_quiet_hours_tenant_user_unique" ON "notification_quiet_hours" ("tenant_id","user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"template_key" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"body_plain" text,
	"variables_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_templates_lookup_idx" ON "notification_templates" ("tenant_id","template_key","channel");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"endpoint_url" text NOT NULL,
	"secret" text NOT NULL,
	"event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_tenant_active_idx" ON "webhook_subscriptions" ("tenant_id","active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"notification_id" uuid,
	"event_type" text NOT NULL,
	"request_body" jsonb NOT NULL,
	"signature" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"response_code" integer,
	"response_body" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_tenant_status_idx" ON "webhook_deliveries" ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_subscription_idx" ON "webhook_deliveries" ("subscription_id","created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_dead_letters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notification_id" uuid,
	"delivery_id" uuid,
	"channel" text NOT NULL,
	"payload_snapshot" jsonb NOT NULL,
	"failure_reason" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"retried_at" timestamp with time zone,
	"retried_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_dead_letters" ADD CONSTRAINT "notification_dead_letters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_dead_letters" ADD CONSTRAINT "notification_dead_letters_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_dead_letters" ADD CONSTRAINT "notification_dead_letters_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_dead_letters" ADD CONSTRAINT "notification_dead_letters_retried_by_user_id_users_id_fk" FOREIGN KEY ("retried_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_dead_letters_tenant_created_idx" ON "notification_dead_letters" ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_dead_letters_tenant_channel_idx" ON "notification_dead_letters" ("tenant_id","channel");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_device_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"device_id" text NOT NULL,
	"app_version" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_device_tokens" ADD CONSTRAINT "notification_device_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_device_tokens" ADD CONSTRAINT "notification_device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_device_tokens_tenant_user_idx" ON "notification_device_tokens" ("tenant_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_device_tokens_tenant_token_unique" ON "notification_device_tokens" ("tenant_id","token");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_device_tokens_tenant_user_device_unique" ON "notification_device_tokens" ("tenant_id","user_id","device_id");
