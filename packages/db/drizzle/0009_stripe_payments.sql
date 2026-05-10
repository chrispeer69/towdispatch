-- 0009 — Session 11 Stripe payments.
--
-- Hand-authored to add Stripe-specific columns to existing tables and the
-- new `stripe_events` webhook-idempotency ledger. RLS / partial unique
-- indexes / check constraints land in sql/0014_stripe_payments.sql.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_account_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_payouts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "platform_margin_bps" integer DEFAULT 30 NOT NULL;--> statement-breakpoint

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "auto_charge_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "default_payment_method_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "card_last4" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "card_brand" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "card_exp_month" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "card_exp_year" integer;--> statement-breakpoint

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "stripe_charge_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "stripe_refund_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "platform_margin_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "stripe_fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_token" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"type" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
