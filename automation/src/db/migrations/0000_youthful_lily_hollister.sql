CREATE TABLE IF NOT EXISTS "fee_profile_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"best_offer_id" text NOT NULL,
	"item_id" text NOT NULL,
	"buyer_user_id" text,
	"quantity" integer NOT NULL,
	"currency" text NOT NULL,
	"gross_offer" numeric(12, 2) NOT NULL,
	"gross_bin" numeric(12, 2),
	"fee_profile_snapshot" jsonb NOT NULL,
	"fvf_raw" numeric(12, 4) NOT NULL,
	"fvf_after_trs" numeric(12, 4) NOT NULL,
	"fixed_fee" numeric(12, 4) NOT NULL,
	"estimated_net" numeric(12, 2) NOT NULL,
	"rule_set_version" integer NOT NULL,
	"matched_rule_id" text,
	"decision" text NOT NULL,
	"counter_price" numeric(12, 2),
	"counter_quantity" integer,
	"dry_run" boolean DEFAULT false NOT NULL,
	"ack" text,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pause_switch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rule_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"rules" jsonb NOT NULL,
	"fee_profile" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_decision_best_offer_id_idx" ON "offer_decision" USING btree ("best_offer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_decision_item_id_idx" ON "offer_decision" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_decision_received_at_idx" ON "offer_decision" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_decision_rule_version_idx" ON "offer_decision" USING btree ("rule_set_version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pause_switch_scope_idx" ON "pause_switch" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rule_set_version_idx" ON "rule_set" USING btree ("version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rule_set_status_idx" ON "rule_set" USING btree ("status");